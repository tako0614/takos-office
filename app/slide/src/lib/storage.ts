import type { Slide, SlideElement, Presentation } from "../types/index.ts";
import { t } from "../i18n.ts";
import { presentationSchema } from "../../../shared/office-schema.ts";
import { ApiRequestError, createApiClient, type ApiClientScope } from "../../../shared/lib/api-client.ts";
import { nextEntityRevision } from "../../../shared/lib/entity-revision.ts";
import { ScopedRevisionWriteQueues } from "../../../shared/lib/revision-write-queue.ts";

const api = createApiClient("/api/presentations", "takos-slide-presentations", {
  onClear: invalidateWrites,
});
const queues = new ScopedRevisionWriteQueues();
const epochs = new Map<string, number>();
type PendingWrite = { revision?: string; state: "pending" | "failed" | "conflict" };
const epoch = (scope: ApiClientScope) => epochs.get(scope.cacheKey) ?? 0;
const journalKey = (scope: ApiClientScope) => scope.cacheKey + ":pending-writes";
export interface LocalSaveResult<T> { value: T; remote: Promise<unknown>; }

function journal(scope: ApiClientScope): Record<string, PendingWrite> {
  const raw = localStorage.getItem(journalKey(scope));
  if (!raw) return Object.create(null);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid pending presentation writes");
  return Object.assign(Object.create(null), parsed);
}
function mark(scope: ApiClientScope, id: string, value?: PendingWrite): void {
  const entries = journal(scope);
  if (value) entries[id] = value;
  else delete entries[id];
  if (Object.keys(entries).length) localStorage.setItem(journalKey(scope), JSON.stringify(entries));
  else localStorage.removeItem(journalKey(scope));
}
function invalidateWrites(scope: ApiClientScope): void {
  epochs.set(scope.cacheKey, epoch(scope) + 1);
  queues.clear(scope.cacheKey);
  localStorage.removeItem(journalKey(scope));
}
export function clearPresentationsCache(): void { api.clearCache(); }

/** The server rejected this revision; the attempted local draft remains intact. */
export class PresentationConflictError extends Error {
  constructor(public readonly current: Presentation) {
    super("Presentation was modified elsewhere");
    this.name = "PresentationConflictError";
  }
}
function loadAt(key: string): Presentation[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value as Presentation[] : [];
  } catch { return []; }
}
function saveAt(key: string, records: Presentation[]): void {
  localStorage.setItem(key, JSON.stringify(records));
}
export function loadPresentations(): Presentation[] { return loadAt(api.cacheKey()); }
export function savePresentations(records: Presentation[]): void { saveAt(api.cacheKey(), records); }
export function getPresentation(id: string): Presentation | undefined {
  return loadPresentations().find((record) => record.id === id);
}
function protectedDraft(scope: ApiClientScope, id: string): boolean {
  return queues.find(scope.cacheKey, id)?.protected === true || journal(scope)[id] !== undefined;
}
export function getPresentationSaveState(id: string): "clean" | "pending" | "failed" | "conflict" {
  const scope = api.capture(), pending = journal(scope)[id];
  if (!pending) return "clean";
  return pending.state === "pending" && !queues.find(scope.cacheKey, id)?.busy ? "failed" : pending.state;
}
function validatePresentation(value: Presentation, id: string): Presentation {
  if (!presentationSchema.safeParse(value).success || value.id !== id ||
      !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("Invalid presentation acknowledgement");
  }
  return value;
}
async function requestPresentation(scope: ApiClientScope, id: string, signal?: AbortSignal): Promise<Presentation> {
  const value = await scope.requestJson<Presentation>(api.apiPath + "/" + encodeURIComponent(id), signal ? { signal } : undefined);
  return validatePresentation(value, id);
}
async function syncPresentation(scope: ApiClientScope, snapshot: Presentation, revision?: string): Promise<Presentation> {
  const response = await scope.request(api.apiPath + "/" + encodeURIComponent(snapshot.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(revision ? { "If-Match": revision } : { "If-None-Match": "*" }) },
    body: JSON.stringify(snapshot),
  });
  if (response.status === 409) {
    const body = await response.json() as { current: Presentation };
    throw new PresentationConflictError(body.current);
  }
  if (!response.ok) throw new ApiRequestError(response.status);
  return validatePresentation(await response.json() as Presentation, snapshot.id);
}
function queuePresentationWrite(scope: ApiClientScope, draft: Presentation, initialRevision?: string): Promise<Presentation> {
  const submitted = JSON.stringify(draft);
  const snapshot = JSON.parse(submitted) as Presentation;
  const previous = journal(scope)[draft.id];
  const queue = queues.get(scope.cacheKey, draft.id, previous ? previous.revision : initialRevision,
    previous ? new Error("Previous save needs explicit reload or retry") : undefined);
  const startedEpoch = epoch(scope);
  mark(scope, draft.id, { revision: queue.revision, state: "pending" });
  return queue.enqueue(
    (revision) => {
      if (epoch(scope) !== startedEpoch) throw new Error("Presentation cache was cleared");
      return syncPresentation(scope, snapshot, revision);
    },
    (ack, latest) => {
      if (epoch(scope) !== startedEpoch) return;
      const records = loadAt(scope.cacheKey), index = records.findIndex((record) => record.id === draft.id);
      if (latest && JSON.stringify(records[index]) === submitted) {
        records[index] = ack;
        saveAt(scope.cacheKey, records);
        mark(scope, draft.id);
      } else mark(scope, draft.id, { revision: ack.updatedAt, state: "pending" });
    },
    (error) => {
      if (epoch(scope) === startedEpoch) mark(scope, draft.id, {
        revision: queue.revision,
        state: error instanceof PresentationConflictError || previous?.state === "conflict" ? "conflict" : "failed",
      });
    },
  ).finally(() => queues.release(scope.cacheKey, draft.id, queue));
}
function saveInScope(scope: ApiClientScope, snapshot: Presentation): { value: Presentation[]; remote: Promise<Presentation> } {
  const records = loadAt(scope.cacheKey), index = records.findIndex((record) => record.id === snapshot.id);
  const base = records[index];
  const draft = { ...structuredClone(snapshot), id: base?.id ?? snapshot.id, createdAt: base?.createdAt ?? snapshot.createdAt, updatedAt: nextEntityRevision(base?.updatedAt ?? snapshot.updatedAt) };
  if (index < 0) records.push(draft);
  else records[index] = draft;
  saveAt(scope.cacheKey, records);
  return { value: records, remote: queuePresentationWrite(scope, draft, base?.updatedAt) };
}
export function savePresentation(snapshot: Presentation) {
  return saveInScope(api.capture(), snapshot);
}
/** Capture a new import's destination before reading or converting its file. */
export function capturePresentationCreator(lifetime: {isActive?: () => boolean} = {}) {
  const scope = api.capture(lifetime), capturedEpoch = epoch(scope);
  return (presentation: Presentation): Promise<Presentation> => {
    if (epoch(scope) !== capturedEpoch) return Promise.reject(new Error("Presentation cache was cleared"));
    if (loadAt(scope.cacheKey).some(record => record.id === presentation.id)) return Promise.reject(new Error("Presentation already exists locally"));
    return saveInScope(scope,presentation).remote;
  };
}

/** Keep delayed editor handlers tied to their original Workspace. */
export function capturePresentationWriter(id: string) {
  const scope = api.capture(), capturedEpoch = epoch(scope);
  return (snapshot: Presentation) => {
    if (snapshot.id !== id || epoch(scope) !== capturedEpoch) throw new Error("Presentation binding was retired");
    return saveInScope(scope, snapshot);
  };
}
export function loadPresentationFromApi(
  id: string, options?: { signal?: AbortSignal },
): Promise<Presentation>;
export function loadPresentationFromApi(
  id: string,
  options: { discardLocal: true; signal?: AbortSignal },
): Promise<Presentation | null>;
export async function loadPresentationFromApi(
  id: string,
  options?: { discardLocal?: boolean; signal?: AbortSignal },
): Promise<Presentation | null> {
  const scope = api.capture();
  const startedEpoch = epoch(scope);
  const creating = queues.find(scope.cacheKey, id);
  if (creating?.busy) await creating.settled();
  options?.signal?.throwIfAborted();
  if (epoch(scope) !== startedEpoch)
    throw new Error("Presentation cache was cleared");
  const before = JSON.stringify(
    loadAt(scope.cacheKey).find((record) => record.id === id),
  );
  let remote: Presentation;
  try {
    remote = await requestPresentation(scope, id, options?.signal);
  } catch (error) {
    options?.signal?.throwIfAborted();
    if (epoch(scope) !== startedEpoch) throw error;
    const records = loadAt(scope.cacheKey);
    const local = records.find((record) => record.id === id);
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
          records.filter((record) => record.id !== id),
        );
        return null;
      }
      if (local && protectedDraft(scope, id)) return local;
    }
    throw error;
  }
  options?.signal?.throwIfAborted();
  if (epoch(scope) !== startedEpoch)
    throw new Error("Presentation cache was cleared");
  if (!options?.discardLocal) {
    const writing = queues.find(scope.cacheKey, id);
    if (writing?.busy) await writing.settled();
    if (epoch(scope) !== startedEpoch)
      throw new Error("Presentation cache was cleared");
  }
  const records = loadAt(scope.cacheKey);
  const index = records.findIndex((record) => record.id === id);
  const local = records[index];
  const changed = JSON.stringify(local) !== before;
  if (changed || (protectedDraft(scope, id) && !options?.discardLocal))
    return local ?? remote;
  if (options?.discardLocal) {
    if (queues.find(scope.cacheKey, id)?.busy)
      throw new Error("A save is still in flight");
    queues
      .find(scope.cacheKey, id)
      ?.invalidate(new Error("Draft was discarded"));
    // Clearing only this idle presentation is handled by the scoped queue helper.
    queues.discard(scope.cacheKey, id);
    mark(scope, id);
  }
  if (index < 0) records.push(remote);
  else records[index] = remote;
  saveAt(scope.cacheKey, records);
  return remote;
}

export async function loadPresentationsFromApi(
  lifetime: { isActive?: () => boolean } = {},
): Promise<Presentation[]> {
  if (lifetime.isActive?.() === false) throw new Error("Presentation read was retired");
  const scope = api.capture(lifetime);
  const startedEpoch = epoch(scope);
  const before = new Map(
    loadAt(scope.cacheKey).map((record) => [record.id, JSON.stringify(record)]),
  );
  const remote = await scope.requestJson<Presentation[]>(api.apiPath);
  if (lifetime.isActive?.() === false) throw new Error("Presentation read was retired");
  if (epoch(scope) !== startedEpoch)
    throw new Error("Presentation cache was cleared");
  const current = loadAt(scope.cacheKey);
  const protectedIds = new Set(
    current
      .filter(
        (record) =>
          protectedDraft(scope, record.id) ||
          before.get(record.id) !== JSON.stringify(record),
      )
      .map((record) => record.id),
  );
  const merged = [
    ...remote.filter((record) => !protectedIds.has(record.id)),
    ...current.filter((record) => protectedIds.has(record.id)),
  ];
  saveAt(scope.cacheKey, merged);
  return merged;
}

/** Explicitly replace the retained draft against a fresh server revision, once. */
export async function retryPresentationAfterConflict(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Presentation | null> {
  options?.signal?.throwIfAborted();
  const scope = api.capture();
  if (queues.find(scope.cacheKey, id)?.busy)
    throw new Error("A save is still in flight");
  if (!journal(scope)[id]) return null;
  const startedEpoch = epoch(scope);
  let remote: Presentation | undefined;
  try {
    remote = await requestPresentation(scope, id, options?.signal);
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
    throw new Error("Presentation cache was cleared");
  if (queues.find(scope.cacheKey, id)?.busy)
    throw new Error("A save is still in flight");
  const local = loadAt(scope.cacheKey).find((record) => record.id === id);
  if (!local) return null;
  queues.discard(scope.cacheKey, id);
  mark(scope, id);
  return queuePresentationWrite(scope, local, remote?.updatedAt);
}

export async function deletePresentation(id: string): Promise<void> {
  const scope = api.capture();
  if (protectedDraft(scope, id))
    throw new Error("Resolve unsaved changes before deleting");
  const current = loadAt(scope.cacheKey).find((record) => record.id === id);
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
  const acknowledgement = await response.json() as { deleted?: unknown } | null;
  if (acknowledgement?.deleted !== true) throw new Error("Deletion was not confirmed");
  if (epoch(scope) === startedEpoch)
    saveAt(
      scope.cacheKey,
      loadAt(scope.cacheKey).filter(
        (record) => record.id !== id || record.updatedAt !== current.updatedAt,
      ),
    );
}

export function createDefaultSlide(): Slide {
  return {
    id: crypto.randomUUID(),
    elements: [],
    background: "#ffffff",
  };
}

export function createPresentation(title: string): Presentation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    slides: [createDefaultSlide()],
    createdAt: now,
    updatedAt: now,
  };
}


export function createTextElement(
  x: number,
  y: number,
  text = t("defaultTextElement"),
): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x,
    y,
    width: 300,
    height: 60,
    rotation: 0,
    text,
    fontSize: 24,
    fontFamily: "Inter, sans-serif",
    fontColor: "#333333",
    textAlign: "center",
    bold: false,
    italic: false,
  };
}

export function createShapeElement(
  shapeType: "rect" | "ellipse" | "triangle" | "arrow",
  x: number,
  y: number,
): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    x,
    y,
    width: 200,
    height: 150,
    rotation: 0,
    shapeType,
    fillColor: "#4f87e0",
    strokeColor: "#2563eb",
    strokeWidth: 2,
  };
}

export function createImageElement(
  imageUrl: string,
  x: number,
  y: number,
): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "image",
    x,
    y,
    width: 300,
    height: 200,
    rotation: 0,
    imageUrl,
  };
}
