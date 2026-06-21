import { expect, test } from "bun:test";
import { rejects, throws } from "node:assert/strict";
import {
  createPresentationStore,
  sanitizeElementUpdateProperties,
} from "../presentation-store.ts";
import type { StorageFile, TakosStorageClient } from "../../../shared/lib/takos-storage.ts";
import type { Presentation } from "../types/index.ts";

function makePresentation(overrides: Partial<Presentation> = {}): Presentation {
  const now = "2026-04-30T00:00:00.000Z";
  return {
    id: overrides.id ?? "presentation-1",
    title: overrides.title ?? "Deck",
    slides: overrides.slides ?? [{
      id: "slide-1",
      elements: [],
      background: "#ffffff",
    }],
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

test("sanitizeElementUpdateProperties allows only valid text updates", () => {
  const patch = sanitizeElementUpdateProperties(
    {
      id: "el",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
    },
    { text: "Safe", fontSize: 32, bold: true },
  );

  expect(patch).toEqual({ text: "Safe", fontSize: 32, bold: true });
});

test("sanitizeElementUpdateProperties rejects cross-type and identity mutation", () => {
  const element = {
    id: "el",
    type: "text" as const,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
  };

  throws(
    () => sanitizeElementUpdateProperties(element, { id: "other" }),
    /Cannot update id/,
  );
  throws(
    () => sanitizeElementUpdateProperties(element, { shapeType: "rect" }),
    /Cannot update shapeType/,
  );
});

test("PresentationStore.updateElement does not mutate on rejected properties", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);
  const presentation = await store.create("Deck");
  const element = await store.addTextElement(presentation.id, 0, {
    text: "Original",
    x: 10,
    y: 10,
  });

  await rejects(
    () =>
      store.updateElement(presentation.id, 0, element.id, {
        type: "shape",
      } as never),
    /Cannot update type/,
  );

  const after = await store.get(presentation.id);
  const storedElement = after?.slides[0].elements[0];
  expect(storedElement?.id).toEqual(element.id);
  expect(storedElement?.type).toEqual("text");
  expect(storedElement?.text).toEqual("Original");
});

test("PresentationStore ignores legacy .json files", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-slide", "folder");
  const legacyPresentation = makePresentation({ id: "legacy" });
  const currentPresentation = makePresentation({ id: "current" });
  const legacyFile = storage.makeFile(
    "legacy.json",
    "file",
    folder.id,
    "application/vnd.takos.slide+json",
  );
  const currentFile = storage.makeFile(
    "current.takosslide",
    "file",
    folder.id,
  );
  storage.content.set(legacyFile.id, JSON.stringify(legacyPresentation));
  storage.content.set(currentFile.id, JSON.stringify(currentPresentation));

  const store = createPresentationStore(storage.client);

  expect((await store.list()).map((presentation) => presentation.id)).toEqual([
    "current",
  ]);
  expect(await store.get(legacyFile.id)).toEqual(undefined);
});

test("PresentationStore creates only .takosslide files", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);

  const presentation = await store.create("Deck");
  const createdFile = [...storage.files.values()].find((file) =>
    file.type === "file"
  );

  expect(createdFile?.name).toEqual(`${presentation.id}.takosslide`);
  expect(createdFile?.mimeType).toEqual("application/vnd.takos.slide+json");
});

test("PresentationStore creates template presentations as .takosslide files", async () => {
  const storage = createMemoryStorage();
  const store = createPresentationStore(storage.client);

  const presentation = await store.createFromTemplate("Deck", "blank");
  const createdFile = [...storage.files.values()].find((file) =>
    file.type === "file"
  );

  expect(createdFile?.name).toEqual(`${presentation.id}.takosslide`);
  expect(createdFile?.mimeType).toEqual("application/vnd.takos.slide+json");
});

test("PresentationStore reflects external writes on re-read (no stale cache)", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-slide", "folder");
  const file = storage.makeFile("p1.takosslide", "file", folder.id);
  storage.content.set(
    file.id,
    JSON.stringify(makePresentation({ id: "p1", title: "Original" })),
  );

  const store = createPresentationStore(storage.client);

  expect((await store.get("p1"))?.title).toEqual("Original");
  expect((await store.list()).map((p) => p.title)).toEqual(["Original"]);

  // Another replica / external write updates the backing store.
  storage.content.set(
    file.id,
    JSON.stringify(makePresentation({ id: "p1", title: "Updated elsewhere" })),
  );

  expect((await store.get("p1"))?.title).toEqual("Updated elsewhere");
  expect((await store.list()).map((p) => p.title)).toEqual(["Updated elsewhere"]);

  // A mutation must build on the externally-updated state, not a stale copy.
  await store.setTitle("p1", "Renamed");
  const persisted = JSON.parse(storage.content.get(file.id)!) as Presentation;
  expect(persisted.title).toEqual("Renamed");
});
