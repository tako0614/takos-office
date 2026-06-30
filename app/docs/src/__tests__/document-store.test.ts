import { expect, test } from "bun:test";

import { DocumentConflictError, TakosDocumentStore } from "../document-store.ts";
import type { StorageFile, TakosStorageClient } from "../../../shared/lib/takos-storage.ts";
import type { Document } from "../types/index.ts";

function makeDocument(overrides: Partial<Document> = {}): Document {
  const now = "2026-04-30T00:00:00.000Z";
  return {
    id: overrides.id ?? "doc-1",
    title: overrides.title ?? "Report",
    content: overrides.content ?? "{}",
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createMemoryStorage() {
  const files = new Map<string, StorageFile>();
  const content = new Map<string, string>();

  const makeFile = (
    name: string,
    type: "file" | "folder",
    parentId?: string,
    mimeType?: string,
  ): StorageFile => {
    const now = new Date().toISOString();
    const file = {
      id: crypto.randomUUID(),
      name,
      parentId,
      type,
      mimeType,
      createdAt: now,
      updatedAt: now,
    };
    files.set(file.id, file);
    return file;
  };

  const client: TakosStorageClient = {
    list(prefix?: string) {
      const all = [...files.values()];
      if (!prefix) return Promise.resolve(all);
      const folder = all.find((file) =>
        file.type === "folder" && file.name === prefix
      );
      return Promise.resolve(
        folder ? all.filter((file) => file.parentId === folder.id) : [],
      );
    },
    get(fileId: string) {
      return Promise.resolve(files.get(fileId) ?? null);
    },
    getContent(fileId: string) {
      return Promise.resolve(content.get(fileId) ?? "");
    },
    putContent(fileId: string, value: string) {
      content.set(fileId, value);
      return Promise.resolve();
    },
    create(
      name: string,
      parentId?: string,
      options?: { content?: string; mimeType?: string },
    ) {
      const file = makeFile(name, "file", parentId, options?.mimeType);
      content.set(file.id, options?.content ?? "");
      return Promise.resolve(file);
    },
    createFolder(name: string, parentId?: string) {
      return Promise.resolve(makeFile(name, "folder", parentId));
    },
    rename(fileId: string, name: string) {
      const file = files.get(fileId);
      if (file) files.set(fileId, { ...file, name });
      return Promise.resolve();
    },
    delete(fileId: string) {
      files.delete(fileId);
      content.delete(fileId);
      return Promise.resolve();
    },
  };

  return { client, files, content, makeFile };
}

test("TakosDocumentStore ignores legacy .json files", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-docs", "folder");
  const legacyDoc = makeDocument({ id: "legacy" });
  const currentDoc = makeDocument({ id: "current" });
  const legacyFile = storage.makeFile(
    "legacy.json",
    "file",
    folder.id,
    "application/vnd.takos.docs+json",
  );
  const currentFile = storage.makeFile(
    "current.takosdoc",
    "file",
    folder.id,
  );
  storage.content.set(legacyFile.id, JSON.stringify(legacyDoc));
  storage.content.set(currentFile.id, JSON.stringify(currentDoc));

  const store = new TakosDocumentStore(storage.client);

  expect((await store.list()).map((doc) => doc.id)).toEqual(["current"]);
  expect(await store.get(legacyFile.id)).toEqual(null);
});

test("TakosDocumentStore creates only .takosdoc files", async () => {
  const storage = createMemoryStorage();
  const store = new TakosDocumentStore(storage.client);

  const doc = await store.create("Report");
  const createdFile = [...storage.files.values()].find((file) =>
    file.type === "file"
  );

  expect(createdFile?.name).toEqual(`${doc.id}.takosdoc`);
  expect(createdFile?.mimeType).toEqual("application/vnd.takos.docs+json");
});

test("TakosDocumentStore reflects external writes on re-read (no stale cache)", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-docs", "folder");
  const docFile = storage.makeFile("doc-1.takosdoc", "file", folder.id);
  storage.content.set(
    docFile.id,
    JSON.stringify(makeDocument({ id: "doc-1", title: "Original" })),
  );

  const store = new TakosDocumentStore(storage.client);

  // First read hydrates whatever process-local memo exists.
  expect((await store.get("doc-1"))?.title).toEqual("Original");
  expect((await store.list()).map((d) => d.title)).toEqual(["Original"]);

  // Simulate another replica / external Takos-side write to the backing store.
  storage.content.set(
    docFile.id,
    JSON.stringify(makeDocument({ id: "doc-1", title: "Updated elsewhere" })),
  );

  // Reads must reflect the backing store, not a stale in-process copy.
  expect((await store.get("doc-1"))?.title).toEqual("Updated elsewhere");
  expect((await store.list()).map((d) => d.title)).toEqual(["Updated elsewhere"]);

  // Simulate an externally created doc appearing in the folder.
  const newFile = storage.makeFile("doc-2.takosdoc", "file", folder.id);
  storage.content.set(
    newFile.id,
    JSON.stringify(makeDocument({ id: "doc-2", title: "External new doc" })),
  );
  const titles = (await store.list()).map((d) => d.title).sort();
  expect(titles).toEqual(["External new doc", "Updated elsewhere"]);
  expect((await store.get("doc-2"))?.title).toEqual("External new doc");
});

test("TakosDocumentStore update reads current storage state before writing", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-docs", "folder");
  const docFile = storage.makeFile("doc-1.takosdoc", "file", folder.id);
  storage.content.set(
    docFile.id,
    JSON.stringify(
      makeDocument({ id: "doc-1", title: "Original", content: "body-a" }),
    ),
  );

  const store = new TakosDocumentStore(storage.client);
  // Warm any memo.
  await store.list();

  // Another replica updates the content field.
  storage.content.set(
    docFile.id,
    JSON.stringify(
      makeDocument({ id: "doc-1", title: "Original", content: "body-b" }),
    ),
  );

  // Updating only the title must preserve the externally-written content,
  // proving update() reads fresh state rather than a stale cached copy.
  const updated = await store.update("doc-1", { title: "Retitled" });
  expect(updated?.title).toEqual("Retitled");
  expect(updated?.content).toEqual("body-b");

  const persisted = JSON.parse(storage.content.get(docFile.id)!) as Document;
  expect(persisted.content).toEqual("body-b");
  expect(persisted.title).toEqual("Retitled");
});

test("upsert with a matching expectedUpdatedAt overwrites", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-docs", "folder");
  const file = storage.makeFile("doc-1.takosdoc", "file", folder.id);
  storage.content.set(
    file.id,
    JSON.stringify(makeDocument({ id: "doc-1", updatedAt: "2026-01-01T00:00:00.000Z" })),
  );

  const store = new TakosDocumentStore(storage.client);
  await store.list(); // warm fileId memo

  const saved = await store.upsert(
    makeDocument({ id: "doc-1", content: "new", updatedAt: "2026-01-02T00:00:00.000Z" }),
    { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
  );
  expect(saved.content).toEqual("new");
  const persisted = JSON.parse(storage.content.get(file.id)!) as Document;
  expect(persisted.content).toEqual("new");
});

test("upsert with a stale expectedUpdatedAt throws DocumentConflictError and does not overwrite", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-docs", "folder");
  const file = storage.makeFile("doc-1.takosdoc", "file", folder.id);
  storage.content.set(file.id, JSON.stringify(makeDocument({ id: "doc-1" })));

  const store = new TakosDocumentStore(storage.client);
  await store.list();

  // Another writer (e.g. an MCP edit) advances the stored version.
  const theirs = makeDocument({
    id: "doc-1",
    content: "theirs",
    updatedAt: "2026-05-01T00:00:00.000Z",
  });
  storage.content.set(file.id, JSON.stringify(theirs));

  let conflict: DocumentConflictError | null = null;
  try {
    await store.upsert(
      makeDocument({ id: "doc-1", content: "mine", updatedAt: "2026-06-01T00:00:00.000Z" }),
      { expectedUpdatedAt: "2026-04-30T00:00:00.000Z" }, // the version we loaded
    );
  } catch (e) {
    conflict = e instanceof DocumentConflictError ? e : null;
  }
  expect(conflict).not.toBeNull();
  expect(conflict?.current.content).toEqual("theirs");
  // The concurrent write must survive — we did not clobber it.
  const persisted = JSON.parse(storage.content.get(file.id)!) as Document;
  expect(persisted.content).toEqual("theirs");
});

test("upsert without options overwrites unconditionally (back-compat)", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-docs", "folder");
  const file = storage.makeFile("doc-1.takosdoc", "file", folder.id);
  storage.content.set(file.id, JSON.stringify(makeDocument({ id: "doc-1" })));

  const store = new TakosDocumentStore(storage.client);
  await store.list();

  const saved = await store.upsert(makeDocument({ id: "doc-1", content: "forced" }));
  expect(saved.content).toEqual("forced");
});

test("ensureFolder adopts a concurrently-created folder instead of failing", async () => {
  const storage = createMemoryStorage();
  let winnerFolderId = "";
  const racingClient: TakosStorageClient = {
    ...storage.client,
    createFolder(name: string, parentId?: string) {
      // Simulate losing the unique-path race: the concurrent winner's folder
      // now exists, and our insert is rejected as a CONFLICT.
      winnerFolderId = storage.makeFile(name, "folder", parentId).id;
      return Promise.reject(new Error("Takos API error: 409 Conflict"));
    },
  };
  const store = new TakosDocumentStore(racingClient);

  // list() -> loadAll() -> ensureFolder(): must adopt the winner, not throw.
  expect(await store.list()).toEqual([]);
});
