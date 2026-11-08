import { expect, test } from "bun:test";
import { importDocxFile, exportDocxFile } from "../lib/docx-worker.ts";
import { readOfficeArchive } from "../../../shared/lib/office-archive.ts";
import { MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";

test("the real disposable DOCX Worker produces a Word package and imports an independent Word file", async () => {
  const result = await exportDocxFile("Worker report", '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Real worker text"}]}]}');
  const parts = await readOfficeArchive(new Uint8Array(await result.blob.arrayBuffer()));
  expect(new TextDecoder().decode(parts.get("word/document.xml"))).toContain("Real worker text");
  const input = await Bun.file(new URL("./fixtures/docx/simple-list.docx", import.meta.url)).arrayBuffer();
  const imported = await importDocxFile(new File([input], "independent.docx"));
  expect(JSON.parse(imported.content).content[0].type).toBe("bulletList");
  expect(imported.content).toContain("Banana");
});

test("the real Worker reports invalid content with a closed error and remains usable for a new operation", async () => {
  await expect(importDocxFile(new File(["not a ZIP"], "damaged.docx"))).rejects.toBeInstanceOf(OfficeFileError);
  const result = await exportDocxFile("Recovered", "New text");
  expect(result.blob.size).toBeGreaterThan(0);
});

test("a cancelled file read settles immediately and cannot dispatch a late Worker job", async () => {
  let release!: (bytes: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>(done => { release = done; });
  const file = new File(["delayed"], "delayed.docx");
  file.arrayBuffer = () => pending;
  const controller = new AbortController();
  const result = importDocxFile(file, controller.signal);
  controller.abort("cancelled own file operation");
  await expect(result).rejects.toBe("cancelled own file operation");
  release(new ArrayBuffer(0));
});

test("already cancelled and oversized exports are refused before Worker conversion", async () => {
  const controller = new AbortController();
  controller.abort(false);
  await expect(exportDocxFile("Cancelled", "x", controller.signal)).rejects.toBe(false);
  await expect(exportDocxFile("Oversized", "x".repeat(MAX_OFFICE_EDITOR_BYTES + 1))).rejects.toMatchObject({code:"too-large"});
});
