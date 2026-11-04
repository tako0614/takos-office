import { expect, test } from "bun:test";
import {
  createSpreadsheet,
  loadSpreadsheetsFromApi,
  saveSpreadsheets,
  updateSpreadsheet,
} from "../lib/storage.ts";
import { createServerApp } from "../server.ts";
import { SpreadsheetStore } from "../spreadsheet-store.ts";
import type {
  StorageFile,
  TakosStorageClient,
} from "../../../shared/lib/takos-storage.ts";
import type { Spreadsheet } from "../types/index.ts";

const STORAGE_KEY = "takos-excel-spreadsheets";

function installMemoryLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  } as Storage;

  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });

  return () => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  };
}

function makeSpreadsheet(): Spreadsheet {
  const now = "2026-04-30T00:00:00.000Z";
  return {
    id: "spreadsheet-1",
    title: "Budget",
    sheets: [{
      id: "sheet-1",
      name: "Sheet1",
      cells: {},
      colWidths: {},
      rowHeights: {},
    }],
    activeSheetId: "sheet-1",
    createdAt: now,
    updatedAt: now,
  };
}

test("client storage normalizes spaceId query to space_id", async () => {
  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  const originalFetch = globalThis.fetch;
  const restoreLocalStorage = installMemoryLocalStorage();
  let requestedUrl = "";
  const spreadsheet = makeSpreadsheet();


  Object.defineProperty(globalThis, "location", {
    value: new URL("http://localhost/editor?spaceId=space-camel"),
    configurable: true,
  });
  saveSpreadsheets([spreadsheet]);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = input instanceof Request ? input.url : String(input);
    return Promise.resolve(
      new Response(String(init?.body ?? "{}"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    await updateSpreadsheet(spreadsheet);
    expect(requestedUrl).toEqual("/api/spreadsheets/spreadsheet-1?space_id=space-camel");
  } finally {
    globalThis.fetch = originalFetch;
    localStorage.removeItem(STORAGE_KEY);
    restoreLocalStorage();
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    } else {
      delete (globalThis as { location?: Location }).location;
    }
  }
});

test("client create persists through the canonical API and preserves conditional update guards", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const restoreLocalStorage = installMemoryLocalStorage();
  const files = new Map<string, { file: StorageFile; content: string }>();
  const client: TakosStorageClient = {
    async ready() {},
    async list(prefix) {
      const all = [...files.values()].map((entry) => entry.file);
      if (!prefix) return all.filter((file) => !file.parentId);
      const folder = all.find((file) => file.type === "folder" && file.name === prefix);
      return all.filter((file) => file.parentId === folder?.id);
    },
    async get(id) { return files.get(id)?.file ?? null; },
    async getContent(id) { return files.get(id)!.content; },
    async create(name, parentId, options) {
      const now = new Date().toISOString();
      const file: StorageFile = { id: crypto.randomUUID(), name, parentId, type: "file", createdAt: now, updatedAt: now, revision: "0" };
      files.set(file.id, { file, content: options?.content ?? "" });
      return file;
    },
    async createFolder(name) {
      const now = new Date().toISOString();
      const file: StorageFile = { id: crypto.randomUUID(), name, type: "folder", createdAt: now, updatedAt: now };
      files.set(file.id, { file, content: "" });
      return file;
    },
    async putContent(id, content, _mime, options) {
      const entry = files.get(id)!;
      if (options?.expectedRevision !== entry.file.revision) throw new Error("synthetic storage CAS mismatch");
      entry.content = content;
      entry.file = { ...entry.file, revision: String(Number(entry.file.revision) + 1) };
    },
    async rename() { throw new Error("unexpected fixture rename"); },
    async delete() { throw new Error("unexpected fixture delete"); },
  };
  const store = new SpreadsheetStore(client);
  const app = createServerApp(store, { env: { ALLOW_UNAUTHENTICATED_ACCESS: "1", TAKOS_SPACE_ID: "client-create-test" } });
  const statuses: number[] = [];
  Object.defineProperty(globalThis, "location", { value: new URL("http://localhost/sheet/?space_id=client-create-test"), configurable: true });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), "http://localhost"), init);
    const response = await app.fetch(request);
    statuses.push(response.status);
    return response;
  }) as typeof fetch;
  try {
    const created = createSpreadsheet("Created through client");
    await created.remote;
    expect(statuses).toEqual([200]);
    const persisted = await store.getSpreadsheet(created.value.id);
    expect(persisted.title).toBe("Created through client");
    expect(persisted.sheets).toEqual(created.value.sheets);
    // Refresh through the actual client/API, never hand-reseed the server ACK.
    const [loaded] = await loadSpreadsheetsFromApi();
    expect(loaded).toEqual(persisted);
    const updated = await updateSpreadsheet({ ...loaded!, title: "Conditional update" });
    expect(updated?.title).toBe("Conditional update");
    expect(await store.getSpreadsheet(created.value.id)).toEqual(updated!);
    const beforeRejectedWrites = await store.getSpreadsheet(created.value.id);
    const path = "/api/spreadsheets/" + created.value.id + "?space_id=client-create-test";
    const duplicate = await app.request(path, { method: "PUT", headers: { "Content-Type": "application/json", "If-None-Match": "*" }, body: JSON.stringify({ ...created.value, title: "Must not overwrite" }) });
    expect(duplicate.status).toBe(428);
    const stale = await app.request(path, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": persisted.updatedAt }, body: JSON.stringify({ ...persisted, title: "Stale writer" }) });
    expect(stale.status).toBe(409);
    expect(await store.getSpreadsheet(created.value.id)).toEqual(beforeRejectedWrites);
    expect(await store.listSpreadsheets()).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreLocalStorage();
    if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
    else delete (globalThis as { location?: Location }).location;
  }
});
