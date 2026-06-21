import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { createPresentationStore } from "../presentation-store.ts";
import type {
  StorageFile,
  TakosStorageClient,
} from "../../../shared/lib/takos-storage.ts";

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

test("setSlideNotes round-trips speaker notes through save/load", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);
  const presentation = await store.create("Deck");

  const updated = await store.setSlideNotes(
    presentation.id,
    0,
    "Open with the agenda.\nThen the demo.",
  );
  expect(updated.notes).toEqual("Open with the agenda.\nThen the demo.");

  // Re-read from the backing store (no stale in-process copy).
  const reloaded = await store.get(presentation.id);
  expect(reloaded?.slides[0].notes).toEqual(
    "Open with the agenda.\nThen the demo.",
  );
});

test("setSlideNotes preserves notes alongside other slide mutations", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);
  const presentation = await store.create("Deck");

  await store.setSlideNotes(presentation.id, 0, "Remember to smile.");
  await store.setSlideBackground(presentation.id, 0, "#101010");
  await store.addTextElement(presentation.id, 0, {
    text: "Title",
    x: 10,
    y: 10,
  });

  const reloaded = await store.get(presentation.id);
  expect(reloaded?.slides[0].notes).toEqual("Remember to smile.");
  expect(reloaded?.slides[0].background).toEqual("#101010");
  expect(reloaded?.slides[0].elements).toHaveLength(1);
});

test("setSlideNotes rejects an out-of-range slide index", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);
  const presentation = await store.create("Deck");

  await rejects(
    () => store.setSlideNotes(presentation.id, 5, "Nope"),
    /out of range/,
  );
});

test("setSlideNotes rejects unsupported control characters", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);
  const presentation = await store.create("Deck");

  // A NUL byte is not an allowed whitespace control character.
  const withNul = `bad${String.fromCharCode(0)}null`;
  await rejects(
    () => store.setSlideNotes(presentation.id, 0, withNul),
    /control characters/,
  );
});

test("setSlideNotes rejects notes that exceed the length cap", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);
  const presentation = await store.create("Deck");

  await rejects(
    () => store.setSlideNotes(presentation.id, 0, "x".repeat(20_001)),
    /at most/,
  );
});
