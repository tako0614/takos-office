import { afterEach, expect, test } from "bun:test";
import * as client from "../lib/storage.ts";
import {
  TakosDocumentStore,
  DocumentConflictError,
} from "../document-store.ts";
import type { Document } from "../types/index.ts";
import type {
  StorageFile,
  TakosStorageClient,
} from "../../../shared/lib/takos-storage.ts";

let sequence = 0;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const scope = "debounced-draft-" + ++sequence;
  const original = Object.fromEntries(
    ["localStorage", "location", "fetch"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const memory = new Map<string, string>();
  let failStorage = false;
  const location = (workspace: string) =>
    new URL("https://office-fixture.invalid/docs/doc?space_id=" + workspace);
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    writable: true,
    value: location(scope),
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failStorage) throw new Error("QuotaExceededError");
        memory.set(key, String(value));
      },
      removeItem: (key: string) => memory.delete(key),
    },
  });
  const initial: Document = {
    id: "doc",
    title: "Original",
    content: "Initial text",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
  let stored = structuredClone(initial),
    objectRevision = 0,
    loseAck = false,
    failRead = false,
    hold = false;
  const entered = deferred(),
    released = deferred();
  const metadata = (): StorageFile => ({
    id: "file",
    name: "doc.takosdoc",
    type: "file",
    createdAt: initial.createdAt,
    updatedAt: stored.updatedAt,
    revision: String(objectRevision),
  });
  const backing: TakosStorageClient = {
    async ready() {},
    async rename() {},
    async delete() {},
    async list(prefix) {
      return prefix
        ? [metadata()]
        : [
            {
              id: "folder",
              name: "takos-docs",
              type: "folder",
              createdAt: initial.createdAt,
              updatedAt: initial.updatedAt,
            },
          ];
    },
    async get() {
      return metadata();
    },
    async getContent() {
      return JSON.stringify(stored);
    },
    async putContent(_id, content, _mime, options) {
      expect(options?.expectedRevision).toBe(String(objectRevision));
      stored = JSON.parse(content);
      objectRevision++;
    },
    async create() {
      throw new Error("unexpected create");
    },
    async createFolder() {
      throw new Error("unexpected folder");
    },
  };
  const server = new TakosDocumentStore(backing);
  const requests: {
    method: string;
    expected: string | null;
    scope: string | null;
  }[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://office-fixture.invalid");
      if (
        url.origin !== "https://office-fixture.invalid" ||
        url.pathname !== "/api/documents/doc"
      )
        throw new Error("external/unexpected request blocked");
      const method = init?.method ?? "GET",
        expected = new Headers(init?.headers).get("If-Match");
      requests.push({
        method,
        expected,
        scope: url.searchParams.get("space_id"),
      });
      if (method === "GET")
        return failRead
          ? Response.json({ error: "read unavailable" }, { status: 503 })
          : Response.json(await server.get("doc"));
      if (method !== "PUT") throw new Error("unexpected mutation");
      try {
        const ack = await server.upsert(JSON.parse(String(init?.body)), {
          expectedUpdatedAt: expected ?? undefined,
        });
        if (hold) {
          hold = false;
          entered.resolve();
          await released.promise;
        }
        if (loseAck) {
          loseAck = false;
          return Response.json(
            { error: "lost ACK after commit" },
            { status: 503 },
          );
        }
        return Response.json(ack);
      } catch (error) {
        if (error instanceof DocumentConflictError)
          return Response.json({ current: error.current }, { status: 409 });
        throw error;
      }
    },
  });
  client.saveDocuments([initial]);
  cleanups.push(() => {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    scope,
    initial,
    memory,
    requests,
    server,
    entered,
    release: released.resolve,
    stored: () => structuredClone(stored),
    workspace: (next: string) => {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        writable: true,
        value: location(next),
      });
    },
    hold: () => {
      hold = true;
    },
    loseAck: () => {
      loseAck = true;
    },
    failRead: (value: boolean) => {
      failRead = value;
    },
    failStorage: () => {
      failStorage = true;
    },
  };
}

test("stage persists title/content before debounce with zero requests and preserves the acknowledged CAS base", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  writer.stage({ title: "New title" });
  writer.stage({ content: "Immediate text" });
  expect(client.getDocument("doc")).toMatchObject({
    title: "New title",
    content: "Immediate text",
    updatedAt: f.initial.updatedAt,
  });
  expect(client.getDocumentSaveState("doc")).toBe("draft");
  expect(f.requests).toHaveLength(0);
  const first = await writer({ title: "New title", content: "Immediate text" });
  expect(f.requests[0]?.expected).toBe(f.initial.updatedAt);
  expect(client.getDocumentSaveState("doc")).toBe("clean");
  expect(client.getDocument("doc")?.updatedAt).toBe(first!.updatedAt);
  writer.stage({ content: "Second edit" });
  const second = await writer({ content: "Second edit" });
  expect(f.requests[1]?.expected).toBe(first!.updatedAt);
  expect(client.getDocument("doc")?.updatedAt).toBe(second!.updatedAt);
  expect(f.stored().content).toBe("Second edit");
});

test("canonical GET cannot discard a staged unsent draft", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  writer.stage({ content: "Retained before debounce" });
  expect((await client.loadDocumentFromApi("doc")).content).toBe(
    "Retained before debounce",
  );
  expect(client.getDocumentSaveState("doc")).toBe("draft");
  expect(f.requests.map((r) => r.method)).toEqual(["GET"]);
  expect(f.stored().content).toBe("Initial text");
});

test("an ACK for an older in-flight save cannot clear the later staged draft or turn it into an unknown revision", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  f.hold();
  const first = writer({ content: "Submitted first" });
  await f.entered.promise;
  writer.stage({ content: "Newer staged" });
  expect(client.getDocumentSaveState("doc")).toBe("pending");
  f.release();
  const ack = await first;
  expect(client.getDocument("doc")?.content).toBe("Newer staged");
  expect(client.getDocumentSaveState("doc")).toBe("draft");
  expect(f.requests).toHaveLength(1);
  await writer({ content: "Newer staged" });
  expect(f.requests[1]?.expected).toBe(ack!.updatedAt);
  expect(client.getDocumentSaveState("doc")).toBe("clean");
});

test("queued saves retain a third unsent draft and chain only real ACK revisions", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  f.hold();
  const first = writer({ content: "First" });
  await f.entered.promise;
  writer.stage({ content: "Second" });
  const second = writer({ content: "Second" });
  writer.stage({ content: "Third unsent" });
  f.release();
  const [a, b] = await Promise.all([first, second]);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]?.expected).toBe(a!.updatedAt);
  expect(client.getDocument("doc")?.content).toBe("Third unsent");
  expect(client.getDocumentSaveState("doc")).toBe("draft");
  await writer({ content: "Third unsent" });
  expect(f.requests[2]?.expected).toBe(b!.updatedAt);
  expect(f.stored().content).toBe("Third unsent");
});

test("typing over a genuine conflict keeps automatic writes blocked until explicit fresh-read recovery", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  const external = await f.server.upsert(
    { ...f.initial, content: "Other writer" },
    { expectedUpdatedAt: f.initial.updatedAt },
  );
  writer.stage({ content: "My draft" });
  await expect(writer({ content: "My draft" })).rejects.toBeInstanceOf(
    client.DocumentConflictError,
  );
  expect(client.getDocumentSaveState("doc")).toBe("conflict");
  writer.stage({ content: "Newer conflict draft" });
  await expect(writer({ content: "Newer conflict draft" })).rejects.toThrow();
  expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  expect(f.stored().content).toBe("Other writer");
  await client.retryDocumentAfterConflict("doc");
  const writes = f.requests.filter((r) => r.method === "PUT");
  expect(writes[1]?.expected).toBe(external.updatedAt);
  expect(f.stored().content).toBe("Newer conflict draft");
  expect(client.getDocumentSaveState("doc")).toBe("clean");
});

test("typing after a lost genuine ACK does not turn uncertainty into an automatically replayable draft", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  f.loseAck();
  await expect(writer({ content: "Committed without ACK" })).rejects.toThrow();
  writer.stage({ content: "Newer retained draft" });
  expect(client.getDocumentSaveState("doc")).toBe("failed");
  await expect(writer({ content: "Newer retained draft" })).rejects.toThrow();
  expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  expect(f.stored().content).toBe("Committed without ACK");
  expect((await client.loadDocumentFromApi("doc")).content).toBe(
    "Newer retained draft",
  );
  expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  await client.retryDocumentAfterConflict("doc");
  expect(f.stored().content).toBe("Newer retained draft");
});

test("a captured staged writer stays in its original Workspace and leaves the next cache byte-exact", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  f.workspace(f.scope + "-B");
  client.saveDocuments([{ ...f.initial, title: "B title" }]);
  const bKey = "takos-docs-documents:workspace:" + f.scope + "-B",
    before = f.memory.get(bKey);
  writer.stage({ title: "A draft" });
  expect(f.memory.get(bKey)).toBe(before);
  expect(
    JSON.parse(f.memory.get("takos-docs-documents:workspace:" + f.scope)!)[0]
      .title,
  ).toBe("A draft");
  await writer({ title: "A draft" });
  expect(f.requests[0]?.scope).toBe(f.scope);
  expect(f.memory.get(bKey)).toBe(before);
});

test("cache invalidation fences both staging and the delayed writer without request effects", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  client.clearDocumentsCache();
  expect(() => writer.stage({ content: "Stale" })).toThrow();
  await expect(writer({ content: "Stale" })).rejects.toThrow();
  expect(f.requests).toHaveLength(0);
});

test("unsent draft blocks deletion and failed explicit discard keeps its content", async () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  writer.stage({ content: "Retained unsent" });
  await expect(client.removeDocument("doc")).rejects.toThrow();
  expect(f.requests).toHaveLength(0);
  f.failRead(true);
  await expect(
    client.loadDocumentFromApi("doc", { discardLocal: true }),
  ).rejects.toThrow();
  expect(client.getDocument("doc")?.content).toBe("Retained unsent");
  expect(client.getDocumentSaveState("doc")).toBe("draft");
  f.failRead(false);
  await client.loadDocumentFromApi("doc", { discardLocal: true });
  expect(client.getDocument("doc")?.content).toBe("Initial text");
  expect(client.getDocumentSaveState("doc")).toBe("clean");
});

test("a browser storage failure surfaces before any network write", () => {
  const f = fixture(),
    writer = client.captureDocumentWriter("doc");
  f.failStorage();
  expect(() => writer.stage({ content: "Cannot persist" })).toThrow(
    "QuotaExceededError",
  );
  expect(f.requests).toHaveLength(0);
});

test("a newly mounted writer cannot autosave a restored draft merely because the title was edited", async () => {
  const f = fixture();
  const previousEditor = client.captureDocumentWriter("doc");
  previousEditor.stage({ content: "Retained content awaiting recovery" });
  const reopenedEditor = client.captureDocumentWriter("doc");
  reopenedEditor.stage({ title: "Title typed after reopening" });
  const outcome = await reopenedEditor({
    title: "Title typed after reopening",
  }).then(
    () => "saved",
    () => "blocked",
  );
  expect({
    outcome,
    requests: f.requests.length,
    serverContent: f.stored().content,
    localContent: client.getDocument("doc")?.content,
  }).toEqual({
    outcome: "blocked",
    requests: 0,
    serverContent: "Initial text",
    localContent: "Retained content awaiting recovery",
  });
});
