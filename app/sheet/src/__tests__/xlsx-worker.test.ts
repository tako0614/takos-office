import { expect, test } from "bun:test";
import { importXlsxFile, exportXlsxFile } from "../lib/xlsx-worker.ts";
import { readOfficePackage } from "../../../shared/lib/office-package.ts";

async function independentFile() {
  const bytes = await Bun.file(new URL("./fixtures/xlsx/tutorial03.xlsx", import.meta.url)).arrayBuffer();
  return new File([bytes], "tutorial03.xlsx");
}

test("the real disposable Excel Worker imports an independent formula/cache and writes an XLSX package", async () => {
  const converted = await importXlsxFile(await independentFile());
  expect(converted.spreadsheet.sheets[0].cells.C6.computed).toBe("1450");
  const result = await exportXlsxFile(converted.spreadsheet);
  const pkg = await readOfficePackage(new Uint8Array(await result.blob.arrayBuffer()));
  expect(pkg.mainPart).toBe("xl/workbook.xml");
  expect(pkg.parts.has("xl/worksheets/sheet1.xml")).toBe(true);
});

test("a malformed Excel import fails closed and a later real Worker remains usable", async () => {
  await expect(importXlsxFile(new File(["not a ZIP"], "broken.xlsx"))).rejects.toMatchObject({ code: "invalid" });
  expect((await importXlsxFile(await independentFile())).spreadsheet.sheets[0].cells.C2.value).toBe("1000");
});

test("retiring an Excel file read cannot post a late Worker operation", async () => {
  let finish!: (value: ArrayBuffer) => void;
  const bytes = new Promise<ArrayBuffer>((resolve) => { finish = resolve; });
  const file = new File(["pending"], "pending.xlsx"); file.arrayBuffer = () => bytes;
  const controller = new AbortController(), pending = importXlsxFile(file, controller.signal);
  controller.abort("retired own Excel read");
  await expect(pending).rejects.toBe("retired own Excel read");
  finish(new ArrayBuffer(0));
});
