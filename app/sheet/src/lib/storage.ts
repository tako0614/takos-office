import type { Sheet, Spreadsheet } from "../types/index.ts";
import { spreadsheetSchema } from "../../../shared/office-schema.ts";
import { ApiRequestError, createApiClient, type ApiClientScope } from "../../../shared/lib/api-client.ts";
import { nextEntityRevision } from "../../../shared/lib/entity-revision.ts";
import { ScopedRevisionWriteQueues } from "../../../shared/lib/revision-write-queue.ts";

const api = createApiClient("/api/spreadsheets", "takos-excel-spreadsheets", {
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid pending spreadsheet writes");
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
export function clearSpreadsheetsCache(): void { api.clearCache(); }

/** The server rejected this revision; the attempted local draft remains intact. */
export class SpreadsheetConflictError extends Error {
  constructor(public readonly current: Spreadsheet) {
    super("Spreadsheet was modified elsewhere");
    this.name = "SpreadsheetConflictError";
  }
}
function loadAt(key: string): Spreadsheet[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value as Spreadsheet[] : [];
  } catch { return []; }
}
function saveAt(key: string, records: Spreadsheet[]): void {
  localStorage.setItem(key, JSON.stringify(records));
}
export function loadSpreadsheets(): Spreadsheet[] { return loadAt(api.cacheKey()); }
export function saveSpreadsheets(records: Spreadsheet[]): void { saveAt(api.cacheKey(), records); }
export function getSpreadsheet(id: string): Spreadsheet | undefined {
  return loadSpreadsheets().find((record) => record.id === id);
}
function protectedDraft(scope: ApiClientScope, id: string): boolean {
  return queues.find(scope.cacheKey, id)?.protected === true || journal(scope)[id] !== undefined;
}
export function getSpreadsheetSaveState(id: string): "clean" | "pending" | "failed" | "conflict" {
  const scope = api.capture(), pending = journal(scope)[id];
  if (!pending) return "clean";
  return pending.state === "pending" && !queues.find(scope.cacheKey, id)?.busy ? "failed" : pending.state;
}
function validateSpreadsheet(value: Spreadsheet, id: string): Spreadsheet {
  if (!spreadsheetSchema.safeParse(value).success || value.id !== id ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      !value.sheets.some((sheet) => sheet.id === value.activeSheetId)) {
    throw new Error("Invalid spreadsheet acknowledgement");
  }
  return value;
}
async function requestSpreadsheet(scope: ApiClientScope, id: string, signal?: AbortSignal): Promise<Spreadsheet> {
  const value = await scope.requestJson<Spreadsheet>(api.apiPath + "/" + encodeURIComponent(id), signal ? { signal } : undefined);
  return validateSpreadsheet(value, id);
}
async function syncSpreadsheet(scope: ApiClientScope, snapshot: Spreadsheet, revision?: string): Promise<Spreadsheet> {
  const response = await scope.request(api.apiPath + "/" + encodeURIComponent(snapshot.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(revision ? { "If-Match": revision } : { "If-None-Match": "*" }) },
    body: JSON.stringify(snapshot),
  });
  if (response.status === 409) {
    const body = await response.json() as { current: Spreadsheet };
    throw new SpreadsheetConflictError(body.current);
  }
  if (!response.ok) throw new ApiRequestError(response.status);
  return validateSpreadsheet(await response.json() as Spreadsheet, snapshot.id);
}
function queueSpreadsheetWrite(scope: ApiClientScope, draft: Spreadsheet, initialRevision?: string): Promise<Spreadsheet> {
  const submitted = JSON.stringify(draft);
  const snapshot = JSON.parse(submitted) as Spreadsheet;
  const previous = journal(scope)[draft.id];
  const queue = queues.get(scope.cacheKey, draft.id, previous ? previous.revision : initialRevision,
    previous ? new Error("Previous save needs explicit reload or retry") : undefined);
  const startedEpoch = epoch(scope);
  mark(scope, draft.id, { revision: queue.revision, state: "pending" });
  return queue.enqueue(
    (revision) => {
      if (epoch(scope) !== startedEpoch) throw new Error("Spreadsheet cache was cleared");
      return syncSpreadsheet(scope, snapshot, revision);
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
        state: error instanceof SpreadsheetConflictError || previous?.state === "conflict" ? "conflict" : "failed",
      });
    },
  ).finally(() => queues.release(scope.cacheKey, draft.id, queue));
}
export function createSpreadsheet(title: string, defaultSheetName = "Sheet1"): LocalSaveResult<Spreadsheet> {
  const scope = api.capture(), now = new Date().toISOString(), sheetId = crypto.randomUUID();
  const sheet: Sheet = { id: sheetId, name: defaultSheetName, cells: {}, colWidths: {}, rowHeights: {} };
  const spreadsheet: Spreadsheet = { id: crypto.randomUUID(), title, sheets: [sheet], activeSheetId: sheetId, createdAt: now, updatedAt: now };
  saveAt(scope.cacheKey, [...loadAt(scope.cacheKey), spreadsheet]);
  return { value: spreadsheet, remote: queueSpreadsheetWrite(scope, spreadsheet) };
}
async function updateInScope(scope: ApiClientScope, spreadsheet: Spreadsheet): Promise<Spreadsheet | undefined> {
  const records = loadAt(scope.cacheKey), index = records.findIndex((record) => record.id === spreadsheet.id);
  if (index < 0) return undefined;
  const base = records[index];
  const draft = { ...structuredClone(spreadsheet), id: base.id, createdAt: base.createdAt, updatedAt: nextEntityRevision(base.updatedAt) };
  records[index] = draft;
  saveAt(scope.cacheKey, records);
  return queueSpreadsheetWrite(scope, draft, base.updatedAt);
}
export async function updateSpreadsheet(spreadsheet: Spreadsheet): Promise<Spreadsheet | undefined> {
  return updateInScope(api.capture(), spreadsheet);
}
/** Hold the editor's original Workspace across delayed handlers. */
export function captureSpreadsheetWriter(id: string) {
  const scope = api.capture(), capturedEpoch = epoch(scope);
  return async (snapshot: Spreadsheet) => {
    if (snapshot.id !== id || epoch(scope) !== capturedEpoch) throw new Error("Spreadsheet binding was retired");
    return updateInScope(scope, snapshot);
  };
}
export function loadSpreadsheetFromApi(
  id: string, options?: { signal?: AbortSignal },
): Promise<Spreadsheet>;
export function loadSpreadsheetFromApi(
  id: string,
  options: { discardLocal: true; signal?: AbortSignal },
): Promise<Spreadsheet | null>;
export async function loadSpreadsheetFromApi(
  id: string,
  options?: { discardLocal?: boolean; signal?: AbortSignal },
): Promise<Spreadsheet | null> {
  const scope = api.capture();
  const startedEpoch = epoch(scope);
  const creating = queues.find(scope.cacheKey, id);
  if (creating?.busy) await creating.settled();
  options?.signal?.throwIfAborted();
  if (epoch(scope) !== startedEpoch)
    throw new Error("Spreadsheet cache was cleared");
  const before = JSON.stringify(
    loadAt(scope.cacheKey).find((record) => record.id === id),
  );
  let remote: Spreadsheet;
  try {
    remote = await requestSpreadsheet(scope, id, options?.signal);
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
    throw new Error("Spreadsheet cache was cleared");
  if (!options?.discardLocal) {
    const writing = queues.find(scope.cacheKey, id);
    if (writing?.busy) await writing.settled();
    if (epoch(scope) !== startedEpoch)
      throw new Error("Spreadsheet cache was cleared");
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
    // Clearing only this idle spreadsheet is handled by the scoped queue helper.
    queues.discard(scope.cacheKey, id);
    mark(scope, id);
  }
  if (index < 0) records.push(remote);
  else records[index] = remote;
  saveAt(scope.cacheKey, records);
  return remote;
}

export async function loadSpreadsheetsFromApi(): Promise<Spreadsheet[]> {
  const scope = api.capture();
  const startedEpoch = epoch(scope);
  const before = new Map(
    loadAt(scope.cacheKey).map((record) => [record.id, JSON.stringify(record)]),
  );
  const remote = await scope.requestJson<Spreadsheet[]>(api.apiPath);
  if (epoch(scope) !== startedEpoch)
    throw new Error("Spreadsheet cache was cleared");
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
export async function retrySpreadsheetAfterConflict(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Spreadsheet | null> {
  options?.signal?.throwIfAborted();
  const scope = api.capture();
  if (queues.find(scope.cacheKey, id)?.busy)
    throw new Error("A save is still in flight");
  if (!journal(scope)[id]) return null;
  const startedEpoch = epoch(scope);
  let remote: Spreadsheet | undefined;
  try {
    remote = await requestSpreadsheet(scope, id, options?.signal);
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
    throw new Error("Spreadsheet cache was cleared");
  if (queues.find(scope.cacheKey, id)?.busy)
    throw new Error("A save is still in flight");
  const local = loadAt(scope.cacheKey).find((record) => record.id === id);
  if (!local) return null;
  queues.discard(scope.cacheKey, id);
  mark(scope, id);
  return queueSpreadsheetWrite(scope, local, remote?.updatedAt);
}

export async function deleteSpreadsheet(id: string): Promise<void> {
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

function changeSheet<T>(id: string, change: (record: Spreadsheet) => T, unchanged: T): LocalSaveResult<T> {
  const scope = api.capture(), records = loadAt(scope.cacheKey), index = records.findIndex((record) => record.id === id);
  if (index < 0) return { value: unchanged, remote: Promise.resolve() };
  const base = records[index], draft = structuredClone(base), value = change(draft);
  if (value === false || value === undefined) return { value, remote: Promise.resolve() };
  draft.updatedAt = nextEntityRevision(base.updatedAt);
  records[index] = draft;saveAt(scope.cacheKey, records);
  return { value, remote: queueSpreadsheetWrite(scope, draft, base.updatedAt) };
}
export function addSheet(spreadsheetId: string, sheetName?: string): LocalSaveResult<Sheet | undefined> {
  return changeSheet<Sheet | undefined>(spreadsheetId, (record) => {
    const sheet: Sheet = { id: crypto.randomUUID(), name: sheetName ?? "Sheet" + (record.sheets.length + 1), cells: {}, colWidths: {}, rowHeights: {} };
    record.sheets.push(sheet);record.activeSheetId = sheet.id;return sheet;
  }, undefined);
}
export function deleteSheet(spreadsheetId: string, sheetId: string): LocalSaveResult<boolean> {
  return changeSheet(spreadsheetId, (record) => {
    if (record.sheets.length <= 1 || !record.sheets.some((sheet) => sheet.id === sheetId)) return false;
    record.sheets = record.sheets.filter((sheet) => sheet.id !== sheetId);
    if (record.activeSheetId === sheetId) record.activeSheetId = record.sheets[0].id;
    return true;
  }, false);
}
export function renameSheet(spreadsheetId: string, sheetId: string, newName: string): LocalSaveResult<boolean> {
  return changeSheet(spreadsheetId, (record) => {
    const sheet = record.sheets.find((entry) => entry.id === sheetId);if (!sheet) return false;
    sheet.name = newName;return true;
  }, false);
}
