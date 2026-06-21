import { expect, test } from "bun:test";

import {
  addDocument,
  getDocument,
  loadDocuments,
  removeDocument,
  saveDocuments,
  updateDocumentInStorage,
} from "../lib/storage.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "takos-docs-documents";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  [name: string]: unknown;
}

interface Document {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: overrides.id ?? "doc-1",
    title: overrides.title ?? "Test Doc",
    content: overrides.content ?? "<p>Hello</p>",
    createdAt: overrides.createdAt ?? "2025-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2025-01-01T00:00:00.000Z",
  };
}

function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
  const body = init?.method === "DELETE" ? "{}" : String(init?.body ?? "{}");
  return Promise.resolve(
    new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("loadDocuments returns empty array when storage is empty", () => {
  clearStorage();
  const docs = loadDocuments();
  expect(docs).toEqual([]);
});

test("loadDocuments returns parsed documents when storage has data", () => {
  clearStorage();
  const docs = [makeDoc({ id: "a" }), makeDoc({ id: "b" })];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  const result = loadDocuments();
  expect(result.length).toEqual(2);
  expect(result[0].id).toEqual("a");
  expect(result[1].id).toEqual("b");
});

test("loadDocuments returns empty array on invalid JSON", () => {
  clearStorage();
  localStorage.setItem(STORAGE_KEY, "NOT_JSON{{{");
  const docs = loadDocuments();
  expect(docs).toEqual([]);
});

test("saveDocuments persists documents to localStorage", () => {
  clearStorage();
  const docs = [makeDoc({ id: "x" })];
  saveDocuments(docs);
  const raw = localStorage.getItem(STORAGE_KEY);
  expect(JSON.parse(raw!)).toEqual(docs);
});

test("getDocument returns the matching document", () => {
  clearStorage();
  const docs = [makeDoc({ id: "a" }), makeDoc({ id: "b" })];
  saveDocuments(docs);
  const found = getDocument("b");
  expect(found?.id).toEqual("b");
});

test("getDocument returns undefined when not found", () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a" })]);
  const found = getDocument("nonexistent");
  expect(found).toEqual(undefined);
});

test("addDocument appends a new document", async () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a" })]);
  await addDocument(makeDoc({ id: "b" }));
  const docs = loadDocuments();
  expect(docs.length).toEqual(2);
  expect(docs[1].id).toEqual("b");
});

test("updateDocumentInStorage updates title and sets updatedAt", async () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a", title: "Old Title" })]);
  await updateDocumentInStorage("a", { title: "New Title" });
  const doc = getDocument("a");
  expect(doc?.title).toEqual("New Title");
  // updatedAt should be a recent ISO string (not the original)
  expect(doc?.updatedAt !== "2025-01-01T00:00:00.000Z").toEqual(true);
});

test("updateDocumentInStorage updates content", async () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a", content: "old" })]);
  await updateDocumentInStorage("a", { content: "new" });
  const doc = getDocument("a");
  expect(doc?.content).toEqual("new");
});

test("updateDocumentInStorage does nothing for unknown id", async () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a" })]);
  await updateDocumentInStorage("nonexistent", { title: "X" });
  const docs = loadDocuments();
  expect(docs.length).toEqual(1);
  expect(docs[0].title).toEqual("Test Doc");
});

test("removeDocument removes the matching document", async () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a" }), makeDoc({ id: "b" })]);
  await removeDocument("a");
  const docs = loadDocuments();
  expect(docs.length).toEqual(1);
  expect(docs[0].id).toEqual("b");
});

test("removeDocument does nothing when id not found", async () => {
  clearStorage();
  saveDocuments([makeDoc({ id: "a" })]);
  await removeDocument("nonexistent");
  const docs = loadDocuments();
  expect(docs.length).toEqual(1);
});

test("client storage normalizes spaceId query to space_id", async () => {
  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    "location",
  );
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  Object.defineProperty(globalThis, "location", {
    value: new URL("http://localhost/editor?spaceId=space-camel"),
    configurable: true,
  });
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
    await addDocument(makeDoc({ id: "space-test" }));
    expect(requestedUrl).toEqual("/api/documents/space-test?space_id=space-camel");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocation) {
      Object.defineProperty(globalThis, "location", originalLocation);
    } else {
      delete (globalThis as { location?: Location }).location;
    }
  }
});
