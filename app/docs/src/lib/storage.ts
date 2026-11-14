import type { Document } from "../types/index.ts";
import {
  ApiRequestError,
  createApiClient,
  type ApiClientScope,
} from "../../../shared/lib/api-client.ts";
import { nextEntityRevision } from "../../../shared/lib/entity-revision.ts";
import { ScopedRevisionWriteQueues } from "../../../shared/lib/revision-write-queue.ts";

const api = createApiClient("/api/documents", "takos-docs-documents", {
  onClear: invalidateWrites,
});
const queues = new ScopedRevisionWriteQueues();
const epochs = new Map<string, number>();
type PendingWrite = {
  revision?: string;
  state: "draft" | "pending" | "failed" | "conflict";
  hasDraft?: true;
};
const epoch = (scope: ApiClientScope) => epochs.get(scope.cacheKey) ?? 0;
const journalKey = (scope: ApiClientScope) =>
  `${scope.cacheKey}:pending-writes`;

function journal(scope: ApiClientScope): Record<string, PendingWrite> {
  const raw = localStorage.getItem(journalKey(scope));
  if (!raw) return Object.create(null);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid pending document writes");
  return Object.assign(Object.create(null), parsed);
}

function mark(scope: ApiClientScope, id: string, state?: PendingWrite): void {
  const entries = journal(scope);
  if (state) entries[id] = state;
  else delete entries[id];
  if (Object.keys(entries).length)
    localStorage.setItem(journalKey(scope), JSON.stringify(entries));
  else localStorage.removeItem(journalKey(scope));
}

function invalidateWrites(scope: ApiClientScope): void {
  epochs.set(scope.cacheKey, epoch(scope) + 1);
  queues.clear(scope.cacheKey);
  localStorage.removeItem(journalKey(scope));
}

export function clearDocumentsCache(): void {
  api.clearCache();
}

/** A genuine server CAS refusal; the local draft is retained. */
export class DocumentConflictError extends Error {
  constructor(public readonly current: Document) {
    super("Document was modified elsewhere");
    this.name = "DocumentConflictError";
  }
}

function loadAt(key: string): Document[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as Document[];
  } catch {
    return [];
  }
}
function saveAt(key: string, docs: Document[]): void {
  localStorage.setItem(key, JSON.stringify(docs));
}
export function loadDocuments(): Document[] {
  return loadAt(api.cacheKey());
}
export function saveDocuments(docs: Document[]): void {
  saveAt(api.cacheKey(), docs);
}
export function getDocument(id: string): Document | undefined {
  return loadDocuments().find((doc) => doc.id === id);
}

function protectedDraft(scope: ApiClientScope, id: string): boolean {
  return (
    queues.find(scope.cacheKey, id)?.protected === true ||
    journal(scope)[id] !== undefined
  );
}

export function getDocumentSaveState(
  id: string,
): "clean" | "draft" | "pending" | "failed" | "conflict" {
  const scope = api.capture();
  const pending = journal(scope)[id];
  if (!pending) return "clean";
  // A persisted pending marker without an active request is an unknown ACK
  // after reload, never proof that the write failed or may be replayed.
  return pending.state === "pending" && !queues.find(scope.cacheKey, id)?.busy
    ? "failed"
    : pending.state;
}

function requestDocument(
  scope: ApiClientScope,
  id: string,
  signal?: AbortSignal,
): Promise<Document> {
  return scope.requestJson<Document>(
    `${api.apiPath}/${encodeURIComponent(id)}`,
    signal ? { signal } : undefined,
  );
}

async function syncDocument(
  scope: ApiClientScope,
  doc: Document,
  revision?: string,
): Promise<Document> {
  const response = await scope.request(
    `${api.apiPath}/${encodeURIComponent(doc.id)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(revision ? { "If-Match": revision } : { "If-None-Match": "*" }),
      },
      body: JSON.stringify(doc),
    },
  );
  if (response.status === 409) {
    const body = (await response.json()) as { current: Document };
    throw new DocumentConflictError(body.current);
  }
  if (!response.ok) throw new ApiRequestError(response.status);
  const ack = (await response.json()) as Document;
  if (
    ack.id !== doc.id ||
    typeof ack.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(ack.updatedAt))
  ) {
    throw new Error("Invalid document acknowledgement");
  }
  return ack;
}

function queueDocumentWrite(
  scope: ApiClientScope,
  doc: Document,
  initialRevision?: string,
  allowStagedDraft = false,
  signal?: AbortSignal,
): Promise<Document> {
  const submitted = JSON.stringify(doc);
  const previous = journal(scope)[doc.id];
  if (previous?.state === "draft" && !allowStagedDraft)
    return Promise.reject(new Error("Restored draft needs explicit recovery"));
  const queue = queues.get(
    scope.cacheKey,
    doc.id,
    previous ? previous.revision : initialRevision,
    previous && previous.state !== "draft"
      ? new Error("Previous save needs explicit reload or retry")
      : undefined,
  );
  const startedEpoch = epoch(scope);
  mark(scope, doc.id, { revision: queue.revision, state: "pending" });
  return queue
    .enqueue(
      (revision) => {
        signal?.throwIfAborted();
        if (epoch(scope) !== startedEpoch)
          throw new Error("Document cache was cleared");
        return syncDocument(scope, doc, revision);
      },
      (ack, latest) => {
        if (epoch(scope) !== startedEpoch) return;
        const docs = loadAt(scope.cacheKey);
        const index = docs.findIndex((entry) => entry.id === doc.id);
        // A response for an older draft may advance the queue's ACK, but must
        // never overwrite edits made while that request was in flight.
        if (latest && JSON.stringify(docs[index]) === submitted) {
          docs[index] = ack;
          saveAt(scope.cacheKey, docs);
          mark(scope, doc.id);
        } else {
          const hasDraft = journal(scope)[doc.id]?.hasDraft;
          mark(scope, doc.id, {
            revision: ack.updatedAt,
            state: latest && hasDraft ? "draft" : "pending",
            ...(hasDraft ? { hasDraft: true } : {}),
          });
        }
      },
      (error) => {
        if (epoch(scope) === startedEpoch)
          mark(scope, doc.id, {
            revision: queue.revision,
            state:
              error instanceof DocumentConflictError ||
              previous?.state === "conflict"
                ? "conflict"
                : "failed",
          });
      },
    )
    .finally(() => queues.release(scope.cacheKey, doc.id, queue));
}

function createInScope(scope: ApiClientScope, doc: Document): Promise<Document> {
  const docs = loadAt(scope.cacheKey);
  if (docs.some((entry) => entry.id === doc.id))
    return Promise.reject(new Error("Document already exists locally"));
  saveAt(scope.cacheKey, [...docs, doc]);
  return queueDocumentWrite(scope, doc);
}

/** Capture before reading/converting an import file, never after an await. */
export function captureDocumentCreator(lifetime: { isActive?: () => boolean } = {}) {
  const scope = api.capture(lifetime);
  const capturedEpoch = epoch(scope);
  return (doc: Document): Promise<Document> => {
    if (epoch(scope) !== capturedEpoch)
      return Promise.reject(new Error("Document cache was cleared"));
    return createInScope(scope, doc);
  };
}

export function addDocument(doc: Document): Promise<Document> {
  return captureDocumentCreator()(doc);
}

export async function updateDocumentInStorage(
  id: string,
  updates: Partial<Pick<Document, "title" | "content">>,
): Promise<Document | null> {
  return updateInScope(api.capture(), id, updates);
}

/** Capture before an editor debounce, so a later route change cannot retarget it. */
export function captureDocumentWriter(id: string) {
  const scope = api.capture();
  const capturedEpoch = epoch(scope);
  // Only the writer that starts staging in the active editor may autosave it.
  // A newly mounted editor must not borrow that permission from disk state.
  const allowStagedDraft = journal(scope)[id]?.state !== "draft";
  const write = (updates: Partial<Pick<Document, "title" | "content">>) => {
    if (epoch(scope) !== capturedEpoch)
      return Promise.reject(new Error("Document cache was cleared"));
    return updateInScope(scope, id, updates, allowStagedDraft);
  };
  return Object.assign(write, {
    stage(updates: Partial<Pick<Document, "title" | "content">>): void {
      if (epoch(scope) !== capturedEpoch)
        throw new Error("Document cache was cleared");
      const docs = loadAt(scope.cacheKey);
      const index = docs.findIndex((doc) => doc.id === id);
      if (index < 0) throw new Error("Document is no longer available");
      const base = docs[index];
      docs[index] = { ...base, ...updates };
      // Persist before the UI debounce, without turning a client edit into an
      // acknowledged revision or issuing a request. Keep unknown/conflict
      // journals blocked even when the user edits that retained draft.
      saveAt(scope.cacheKey, docs);
      const pending = journal(scope)[id];
      const queue = queues.find(scope.cacheKey, id);
      mark(scope, id, {
        ...(pending ?? {
          revision: queue ? queue.revision : base.updatedAt,
          state: queue?.protected ? "pending" : "draft",
        }),
        hasDraft: true,
      });
    },
  });
}

async function updateInScope(
  scope: ApiClientScope,
  id: string,
  updates: Partial<Pick<Document, "title" | "content">>,
  allowStagedDraft = false,
): Promise<Document | null> {
  const docs = loadAt(scope.cacheKey);
  const index = docs.findIndex((doc) => doc.id === id);
  if (index < 0) return null;
  const base = docs[index];
  const draft = {
    ...base,
    ...updates,
    updatedAt: nextEntityRevision(base.updatedAt),
  };
  docs[index] = draft;
  saveAt(scope.cacheKey, docs);
  return queueDocumentWrite(scope, draft, base.updatedAt, allowStagedDraft);
}

type ReadLifetime = { isActive?: () => boolean };

function assertReadActive(lifetime: ReadLifetime): void {
  if (lifetime.isActive?.() === false)
    throw new Error("Document read was retired");
}

export function loadDocumentFromApi(
  id: string,
  options?: ReadLifetime & { discardLocal?: false; signal?: AbortSignal },
): Promise<Document>;
export function loadDocumentFromApi(
  id: string,
  options: ReadLifetime & { discardLocal: true; signal?: AbortSignal },
): Promise<Document | null>;
export async function loadDocumentFromApi(
  id: string,
  options: ReadLifetime & { discardLocal?: boolean; signal?: AbortSignal } = {},
): Promise<Document | null> {
  assertReadActive(options);
  const scope = api.capture(options);
  const startedEpoch = epoch(scope);
  const creating = queues.find(scope.cacheKey, id);
  if (creating?.busy) await creating.settled();
  assertReadActive(options);
  options?.signal?.throwIfAborted();
  if (epoch(scope) !== startedEpoch)
    throw new Error("Document cache was cleared");
  const before = JSON.stringify(
    loadAt(scope.cacheKey).find((doc) => doc.id === id),
  );
  let remote: Document;
  try {
    remote = await requestDocument(scope, id, options?.signal);
  } catch (error) {
    assertReadActive(options);
    options?.signal?.throwIfAborted();
    if (epoch(scope) !== startedEpoch) throw error;
    const docs = loadAt(scope.cacheKey);
    const local = docs.find((doc) => doc.id === id);
    // A transient read failure must not strand an already-unconfirmed draft.
    // Its failed/conflict journal remains authoritative; this is not a fresh
    // server read or permission to retry, replace or discard it.
    const transientReadFailure =
      error instanceof TypeError ||
      (error instanceof ApiRequestError &&
        error.status >= 500 &&
        error.status < 600);
    if (
      !options?.discardLocal &&
      transientReadFailure &&
      local &&
      protectedDraft(scope, id)
    )
      return local;
    if (error instanceof ApiRequestError && error.status === 404) {
      if (options?.discardLocal) {
        if (JSON.stringify(local) !== before) return local ?? null;
        if (queues.find(scope.cacheKey, id)?.busy)
          throw new Error("A save is still in flight");
        queues.discard(scope.cacheKey, id);
        mark(scope, id);
        saveAt(
          scope.cacheKey,
          docs.filter((doc) => doc.id !== id),
        );
        return null;
      }
      if (local && protectedDraft(scope, id)) return local;
    }
    throw error;
  }
  assertReadActive(options);
  options?.signal?.throwIfAborted();
  if (epoch(scope) !== startedEpoch)
    throw new Error("Document cache was cleared");
  if (!options?.discardLocal) {
    const writing = queues.find(scope.cacheKey, id);
    if (writing?.busy) await writing.settled();
    assertReadActive(options);
    if (epoch(scope) !== startedEpoch)
      throw new Error("Document cache was cleared");
  }
  const docs = loadAt(scope.cacheKey);
  const index = docs.findIndex((doc) => doc.id === id);
  const local = docs[index];
  const changed = JSON.stringify(local) !== before;
  if (changed || (protectedDraft(scope, id) && !options?.discardLocal))
    return local ?? remote;
  if (options?.discardLocal) {
    if (queues.find(scope.cacheKey, id)?.busy)
      throw new Error("A save is still in flight");
    queues
      .find(scope.cacheKey, id)
      ?.invalidate(new Error("Draft was discarded"));
    // Clearing only this idle document is handled by the scoped queue helper.
    queues.discard(scope.cacheKey, id);
    mark(scope, id);
  }
  if (index < 0) docs.push(remote);
  else docs[index] = remote;
  saveAt(scope.cacheKey, docs);
  return remote;
}

export async function loadDocumentsFromApi(
  lifetime: ReadLifetime = {},
): Promise<Document[]> {
  assertReadActive(lifetime);
  const scope = api.capture(lifetime);
  const startedEpoch = epoch(scope);
  const before = new Map(
    loadAt(scope.cacheKey).map((doc) => [doc.id, JSON.stringify(doc)]),
  );
  const remote = await scope.requestJson<Document[]>(api.apiPath);
  assertReadActive(lifetime);
  if (epoch(scope) !== startedEpoch)
    throw new Error("Document cache was cleared");
  const current = loadAt(scope.cacheKey);
  const protectedIds = new Set(
    current
      .filter(
        (doc) =>
          protectedDraft(scope, doc.id) ||
          before.get(doc.id) !== JSON.stringify(doc),
      )
      .map((doc) => doc.id),
  );
  const merged = [
    ...remote.filter((doc) => !protectedIds.has(doc.id)),
    ...current.filter((doc) => protectedIds.has(doc.id)),
  ];
  saveAt(scope.cacheKey, merged);
  return merged;
}

/** Explicitly replace the retained draft against a fresh server revision, once. */
export async function retryDocumentAfterConflict(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Document | null> {
  options?.signal?.throwIfAborted();
  const scope = api.capture();
  if (queues.find(scope.cacheKey, id)?.busy)
    throw new Error("A save is still in flight");
  if (!journal(scope)[id]) return null;
  const startedEpoch = epoch(scope);
  let remote: Document | undefined;
  try {
    remote = await requestDocument(scope, id, options?.signal);
  } catch (error) {
    options?.signal?.throwIfAborted();
    const pending = journal(scope)[id];
    // Only an explicitly retried, never-acknowledged create may reconcile a
    // fresh404 as absence. The subsequent PUT still uses If-None-Match:*.
    if (!(
      error instanceof ApiRequestError &&
      error.status === 404 &&
      pending &&
      pending.revision === undefined
    ))
      throw error;
  }
  options?.signal?.throwIfAborted();
  if (epoch(scope) !== startedEpoch)
    throw new Error("Document cache was cleared");
  if (queues.find(scope.cacheKey, id)?.busy)
    throw new Error("A save is still in flight");
  const local = loadAt(scope.cacheKey).find((doc) => doc.id === id);
  if (!local) return null;
  queues.discard(scope.cacheKey, id);
  mark(scope, id);
  return queueDocumentWrite(scope, local, remote?.updatedAt, false, options?.signal);
}

export async function removeDocument(id: string): Promise<void> {
  const scope = api.capture();
  if (protectedDraft(scope, id))
    throw new Error("Resolve unsaved changes before deleting");
  const current = loadAt(scope.cacheKey).find((doc) => doc.id === id);
  if (!current) return;
  const startedEpoch = epoch(scope);
  const response = await scope.request(
    `${api.apiPath}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { "If-Match": current.updatedAt },
      credentials: "same-origin",
    },
  );
  if (!response.ok) throw new ApiRequestError(response.status);
  if (epoch(scope) === startedEpoch)
    saveAt(
      scope.cacheKey,
      loadAt(scope.cacheKey).filter(
        (doc) => doc.id !== id || doc.updatedAt !== current.updatedAt,
      ),
    );
}
