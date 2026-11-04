import { createServerApp } from "../server.ts";
import { SpreadsheetStore } from "../spreadsheet-store.ts";
import { ObjectStorageConflictError } from "../../../shared/lib/takos-storage.ts";
import type { StorageFile, TakosStorageClient } from "../../../shared/lib/takos-storage.ts";

function memoryObjects(denyDelete: () => boolean): TakosStorageClient {
  const records = new Map<string, { file: StorageFile; content: string }>();
  function metadata(name: string, type: "file" | "folder", parentId?: string): StorageFile {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), name, type, parentId, createdAt: now, updatedAt: now, revision: "0" };
  }
  return {
    async ready() {},
    async list(prefix) {
      const all = [...records.values()].map((record) => ({ ...record.file }));
      if (!prefix) return all.filter((file) => !file.parentId);
      const folder = all.find((file) => file.type === "folder" && file.name === prefix);
      return folder ? all.filter((file) => file.parentId === folder.id) : [];
    },
    async get(id) { const record = records.get(id); return record ? { ...record.file } : null; },
    async getContent(id) { return records.get(id)!.content; },
    async create(name, parentId, options) {
      if ([...records.values()].some((record) => record.file.name === name && record.file.parentId === parentId)) throw new Error("duplicate object");
      const file = metadata(name, "file", parentId);
      records.set(file.id, { file, content: options?.content ?? "" });
      return { ...file };
    },
    async createFolder(name, parentId) {
      const file = metadata(name, "folder", parentId);
      records.set(file.id, { file, content: "" });
      return { ...file };
    },
    async putContent(id, content, _mime, options) {
      const record = records.get(id)!;
      if (options?.expectedRevision !== record.file.revision) throw new ObjectStorageConflictError(record.file);
      record.content = content;
      record.file = { ...record.file, revision: String(Number(record.file.revision) + 1) };
    },
    async delete(id, options) {
      const record = records.get(id);
      if (record && options?.expectedRevision !== record.file.revision) throw new ObjectStorageConflictError(record.file);
      if (denyDelete()) throw new Error("controlled object delete unavailable");
      records.delete(id);
    },
    async rename() { throw new Error("unexpected fixture rename"); },
  };
}

export function clientStoreFixture() {
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  const stores = new Map<string, SpreadsheetStore>();
  let denyObjectDelete = false;
  function store(workspace: string) {
    let current = stores.get(workspace);
    if (!current) stores.set(workspace, current = new SpreadsheetStore(memoryObjects(() => { const denied = denyObjectDelete; denyObjectDelete = false; return denied; })));
    return current;
  }
  const app = createServerApp(null, {
    env: { ALLOW_UNAUTHENTICATED_ACCESS: "1", TAKOS_NATIVE_RENDERING: "0" },
    storeForRequest: (context) => {
      const workspace = context.req.query("space_id") ?? context.req.query("spaceId");
      return workspace ? store(workspace) : context.json({ error: "space_id is required" }, 400);
    },
  });
  const calls: Array<{ method: string; url: string; revision: string | null; status?: number }> = [];
  const active = new Set<Promise<unknown>>();
  let hold: { method: string; waiting: () => void; released: Promise<void> } | undefined;
  const releases = new Set<() => void>();
  let loseWrite = false;
  let malformedAck: "identity" | "nested" | undefined;
  let readStatus: number | undefined;
  let failBeforeCommit = false;
  const scope = (workspace: string) => Object.defineProperty(globalThis, "location", {
    value: new URL("http://localhost/sheet/?space_id=" + encodeURIComponent(workspace)),
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  scope("A");
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), "http://localhost"), init);
    const call = { method: request.method, url: request.url, revision: request.headers.get("If-Match") } as typeof calls[number];
    calls.push(call);
    const gate = hold?.method === request.method ? hold : undefined;
    if (gate) hold = undefined;
    const failedRead = request.method === "GET" ? readStatus : undefined;
    if (failedRead) readStatus = undefined;
    const failWrite = request.method === "PUT" && failBeforeCommit;
    if (failWrite) failBeforeCommit = false;
    const task = (async () => {
      if (request.method !== "GET") await new Promise((resolve) => setTimeout(resolve, 20));
      let response = failWrite ? Response.json({ error: "controlled pre-dispatch failure" }, { status: 500 }) : await app.fetch(request);
      if (failedRead) response = Response.json({ error: "controlled read failure" }, { status: failedRead });
      if (gate) { gate.waiting(); await gate.released; }
      if (request.method === "PUT" && response.ok && loseWrite) {
        loseWrite = false;
        response = Response.json({ error: "controlled lost ACK after commit" }, { status: 500 });
      }
      if (request.method === "PUT" && response.ok && malformedAck) {
        if (malformedAck === "nested") {
          const current = await response.json();
          response = Response.json({ ...current, sheets: [{ id: current.activeSheetId }] });
        } else response = Response.json({ id: "wrong-ack-id", updatedAt: "not-a-revision" });
        malformedAck = undefined;
      }
      call.status = response.status;
      return response;
    })();
    active.add(task);
    void task.finally(() => active.delete(task)).catch(() => undefined);
    return task;
  }) as typeof fetch;
  return {
    app, store, values, calls, scope,
    holdNext(method: string) {
      let waiting!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => { waiting = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      releases.add(release);hold = { method, waiting, released };
      return { started, release: () => { releases.delete(release); release(); } };
    },
    loseNextWrite() { loseWrite = true; },
    failNextObjectDelete() { denyObjectDelete = true; },
    failNextWriteBeforeCommit() { failBeforeCommit = true; },
    failNextRead(status = 503) { readStatus = status; },
    malformedNextAck() { malformedAck = "identity"; },
    malformedNestedAck() { malformedAck = "nested"; },
    async seed(workspace: string, title = "Budget") {
      const response = await app.request("/api/spreadsheets?space_id=" + encodeURIComponent(workspace), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error("actual API seed failed: " + response.status);
      return await response.json() as import("../types/index.ts").Spreadsheet;
    },
    async close() {
      for (const release of releases) release();
      await Promise.allSettled([...active]);
      globalThis.fetch = originalFetch;
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
      else delete (globalThis as { location?: Location }).location;
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    },
  };
}
