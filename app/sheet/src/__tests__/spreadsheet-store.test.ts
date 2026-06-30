import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import {
  SpreadsheetConflictError,
  SpreadsheetStore,
} from "../spreadsheet-store.ts";
import type { StorageFile, TakosStorageClient } from "../../../shared/lib/takos-storage.ts";
import type { Spreadsheet } from "../types/index.ts";

function makeSpreadsheet(overrides: Partial<Spreadsheet> = {}): Spreadsheet {
  const now = "2026-04-30T00:00:00.000Z";
  return {
    id: overrides.id ?? "spreadsheet-1",
    title: overrides.title ?? "Budget",
    sheets: overrides.sheets ?? [{
      id: "sheet-1",
      name: "Sheet1",
      cells: {},
      colWidths: {},
      rowHeights: {},
    }],
    activeSheetId: overrides.activeSheetId ?? "sheet-1",
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

test("SpreadsheetStore ignores legacy .json files", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  const legacySpreadsheet = makeSpreadsheet({ id: "legacy" });
  const currentSpreadsheet = makeSpreadsheet({ id: "current" });
  const legacyFile = storage.makeFile(
    "legacy.json",
    "file",
    folder.id,
    "application/vnd.takos.excel+json",
  );
  const currentFile = storage.makeFile(
    "current.takossheet",
    "file",
    folder.id,
  );
  storage.content.set(legacyFile.id, JSON.stringify(legacySpreadsheet));
  storage.content.set(currentFile.id, JSON.stringify(currentSpreadsheet));

  const store = new SpreadsheetStore(storage.client);

  expect((await store.listSpreadsheets()).map((sheet) => sheet.id)).toEqual([
    "current",
  ]);
  await rejects(
    () => store.getSpreadsheet(legacyFile.id),
    new RegExp(`Spreadsheet not found: ${legacyFile.id}`),
  );
});

test("SpreadsheetStore creates only .takossheet files", async () => {
  const storage = createMemoryStorage();
  const store = new SpreadsheetStore(storage.client);

  const id = await store.createSpreadsheet("Budget");
  const createdFile = [...storage.files.values()].find((file) =>
    file.type === "file"
  );

  expect(createdFile?.name).toEqual(`${id}.takossheet`);
  expect(createdFile?.mimeType).toEqual("application/vnd.takos.excel+json");
});

test("SpreadsheetStore reflects external writes on re-read (no stale cache)", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  const file = storage.makeFile("ss1.takossheet", "file", folder.id);
  storage.content.set(
    file.id,
    JSON.stringify(makeSpreadsheet({ id: "ss1", title: "Original" })),
  );

  const store = new SpreadsheetStore(storage.client);

  expect((await store.getSpreadsheet("ss1")).title).toEqual("Original");
  expect((await store.listSpreadsheets()).map((s) => s.title)).toEqual(["Original"]);

  // Another replica / external write updates the backing store.
  storage.content.set(
    file.id,
    JSON.stringify(makeSpreadsheet({ id: "ss1", title: "Updated elsewhere" })),
  );

  expect((await store.getSpreadsheet("ss1")).title).toEqual("Updated elsewhere");
  expect((await store.listSpreadsheets()).map((s) => s.title)).toEqual(["Updated elsewhere"]);

  // A mutation must build on the externally-updated state, not a stale copy.
  await store.setSpreadsheetTitle("ss1", "Renamed");
  const persisted = JSON.parse(storage.content.get(file.id)!) as Spreadsheet;
  expect(persisted.title).toEqual("Renamed");
});

test("SpreadsheetStore insertRows re-points cross-sheet refs in other sheets", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  const file = storage.makeFile("wb.takossheet", "file", folder.id);
  const wb = makeSpreadsheet({
    id: "wb",
    sheets: [
      {
        id: "sheet-1",
        name: "Sheet1",
        cells: { A1: { value: "10" }, A2: { value: "20" } },
        colWidths: {},
        rowHeights: {},
      },
      {
        id: "sheet-2",
        name: "Sheet2",
        cells: { B1: { value: "=Sheet1!A2" } },
        colWidths: {},
        rowHeights: {},
      },
    ],
    activeSheetId: "sheet-1",
  });
  storage.content.set(file.id, JSON.stringify(wb));

  const store = new SpreadsheetStore(storage.client);
  // Before the shift, Sheet2!B1 resolves to Sheet1!A2 = 20.
  expect((await store.getComputed("wb", "sheet-2", "B1:B1"))[0][0]).toEqual(
    "20",
  );

  // Insert a row above Sheet1!A2: its value moves to A3.
  await store.insertRows("wb", "sheet-1", 0, 1);

  const persisted = JSON.parse(storage.content.get(file.id)!) as Spreadsheet;
  const sheet2 = persisted.sheets.find((s) => s.id === "sheet-2")!;
  // The OTHER sheet's stored formula text followed the moved cell...
  expect(sheet2.cells["B1"]?.value).toEqual("=Sheet1!A3");
  // ...and still computes the moved value, not the stale row's content.
  expect((await store.getComputed("wb", "sheet-2", "B1:B1"))[0][0]).toEqual(
    "20",
  );
});

test("SpreadsheetStore setCell preserves externally-written cells (fresh read)", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  const file = storage.makeFile("ss1.takossheet", "file", folder.id);
  storage.content.set(
    file.id,
    JSON.stringify(makeSpreadsheet({ id: "ss1" })),
  );

  const store = new SpreadsheetStore(storage.client);
  await store.listSpreadsheets(); // warm any memo

  // Another replica writes cell A1 directly to the backing store.
  const external = makeSpreadsheet({ id: "ss1" });
  external.sheets[0].cells["A1"] = { value: "external" };
  storage.content.set(file.id, JSON.stringify(external));

  // Setting B1 must not clobber the externally-written A1.
  await store.setCell("ss1", "sheet-1", "B1", "mine");
  const persisted = JSON.parse(storage.content.get(file.id)!) as Spreadsheet;
  expect(persisted.sheets[0].cells["A1"]?.value).toEqual("external");
  expect(persisted.sheets[0].cells["B1"]?.value).toEqual("mine");
});

test("replaceSpreadsheet with a stale expectedUpdatedAt throws a conflict", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  const file = storage.makeFile("ss1.takossheet", "file", folder.id);
  storage.content.set(
    file.id,
    JSON.stringify(makeSpreadsheet({ id: "ss1", updatedAt: "v0" })),
  );
  const store = new SpreadsheetStore(storage.client);
  await store.listSpreadsheets(); // warm the fileId memo

  // A concurrent writer (e.g. an agent over MCP) advances the stored version.
  storage.content.set(
    file.id,
    JSON.stringify(
      makeSpreadsheet({ id: "ss1", title: "Agent edit", updatedAt: "v1" }),
    ),
  );

  let conflict: unknown;
  try {
    await store.replaceSpreadsheet(
      makeSpreadsheet({ id: "ss1", title: "Browser snapshot", updatedAt: "v0" }),
      { expectedUpdatedAt: "v0" },
    );
  } catch (e) {
    conflict = e;
  }
  expect(conflict).toBeInstanceOf(SpreadsheetConflictError);
  expect((conflict as SpreadsheetConflictError).current.title).toEqual(
    "Agent edit",
  );
  // The concurrent writer's content is preserved on disk.
  const persisted = JSON.parse(storage.content.get(file.id)!) as Spreadsheet;
  expect(persisted.title).toEqual("Agent edit");
});

test("replaceSpreadsheet without a precondition still overwrites", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  const file = storage.makeFile("ss1.takossheet", "file", folder.id);
  storage.content.set(
    file.id,
    JSON.stringify(makeSpreadsheet({ id: "ss1", title: "Old" })),
  );
  const store = new SpreadsheetStore(storage.client);
  await store.listSpreadsheets();
  const result = await store.replaceSpreadsheet(
    makeSpreadsheet({ id: "ss1", title: "New" }),
  );
  expect(result.title).toEqual("New");
});

function countingClient(base: TakosStorageClient) {
  const counts = { get: 0, getContent: 0, listFolder: 0 };
  const client: TakosStorageClient = {
    ...base,
    list(prefix?: string) {
      if (prefix) counts.listFolder++;
      return base.list(prefix);
    },
    get(fileId: string) {
      counts.get++;
      return base.get(fileId);
    },
    getContent(fileId: string) {
      counts.getContent++;
      return base.getContent(fileId);
    },
  };
  return { client, counts };
}

test("listSpreadsheetsFull does not issue a redundant per-file get()", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  for (const id of ["a", "b", "c"]) {
    const f = storage.makeFile(`${id}.takossheet`, "file", folder.id);
    storage.content.set(f.id, JSON.stringify(makeSpreadsheet({ id })));
  }
  const { client, counts } = countingClient(storage.client);
  const store = new SpreadsheetStore(client);

  const all = await store.listSpreadsheetsFull();
  expect(all.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  // One body fetch per file, and NO redundant metadata get() (loadAll already
  // holds the StorageFile from the folder listing).
  expect(counts.getContent).toEqual(3);
  expect(counts.get).toEqual(0);
});

test("getSpreadsheet on a nonexistent id downloads no bodies", async () => {
  const storage = createMemoryStorage();
  const folder = storage.makeFile("takos-excel", "folder");
  for (const id of ["a", "b", "c"]) {
    const f = storage.makeFile(`${id}.takossheet`, "file", folder.id);
    storage.content.set(f.id, JSON.stringify(makeSpreadsheet({ id })));
  }
  const { client, counts } = countingClient(storage.client);
  const store = new SpreadsheetStore(client);

  await rejects(() => store.getSpreadsheet("does-not-exist"), /not found/);
  // Resolved via folder metadata only — no full-folder body download.
  expect(counts.getContent).toEqual(0);
});
