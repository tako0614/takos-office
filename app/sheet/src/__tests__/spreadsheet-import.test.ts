import { expect, test } from "bun:test";
import { clientStoreFixture } from "./save-custody-fixture.ts";
import { createSpreadsheetImporter } from "../lib/spreadsheet-import.ts";
import { getSpreadsheet, getSpreadsheetSaveState } from "../lib/storage.ts";
import type { ImportedSpreadsheet } from "../lib/xlsx.ts";
import { exportXlsx } from "../lib/xlsx.ts";
import { setCellValue } from "../lib/formula.ts";
import { deleteSheet, renameSheet, captureSpreadsheetWriter } from "../lib/storage.ts";
import { readOfficePackage, isOfficeRelationship } from "../../../shared/lib/office-package.ts";

const converted: ImportedSpreadsheet = {
  hasUnsupportedContent:false,
  spreadsheet:{id:"converted-file",title:"",sheets:[{id:"file-sheet",name:"Sheet1",cells:{A1:{value:"123",valueType:"text"}},colWidths:{},rowHeights:{}}],activeSheetId:"file-sheet",createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z"},
};
function deferred<T>() {let resolve!: (value: T) => void;const promise = new Promise<T>(done => {resolve=done;});return {promise,resolve};}
const input = () => new File(["file boundary"],"Imported book.xlsx");

test("formatting keeps saved formula results but input edits invalidate caches across sheets and never export them as current", async () => {
  const f = clientStoreFixture();
  const data: ImportedSpreadsheet = { ...converted, spreadsheet: { ...converted.spreadsheet, sheets: [
    { ...converted.spreadsheet.sheets[0], cells: { A1: { value: "1", valueType: "number" } } },
    { id: "other-sheet", name: "Other", cells: { B1: { value: "=_xlfn.FUTUREFUNC(Sheet1!A1)", computed: "42", computedType: "number", computedSource: "file" } }, colWidths: {}, rowHeights: {} },
  ] } };
  const importer = createSpreadsheetImporter(async () => data);
  try {
    const result = (await importer.importFile(input()))!.spreadsheet;
    const writer = captureSpreadsheetWriter(result.id);
    const formatted = structuredClone(result); formatted.sheets[0].cells.A1.format = { bold: true };
    const formatAck = (await writer(formatted))!;
    expect(formatAck.sheets[1].cells.B1.computed).toBe("42");
    expect(formatAck.sheets[1].cells.B1.computedSource).toBe("file");
    const changed = structuredClone(formatAck); changed.sheets[0].cells.A1.value = "2";
    const ack = (await writer(changed))!;
    const actual = await (await f.app.request("/api/spreadsheets/" + ack.id + "?space_id=A")).json();
    expect(actual.sheets[1].cells.B1.computedSource).toBe("stale");
    const exported = await exportXlsx(ack), pkg = await readOfficePackage(new Uint8Array(await exported.blob.arrayBuffer()));
    const sheets = [...pkg.relationships.get(pkg.mainPart)!.values()].filter(rel => isOfficeRelationship(rel, "worksheet"));
    const xml = pkg.xmlParts.get(sheets[1].target)!, ns = xml.documentElement!.namespaceURI!;
    expect(xml.getElementsByTagNameNS(ns, "f").item(0)?.textContent).toBe("_xlfn.FUTUREFUNC(Sheet1!A1)");
    expect(xml.getElementsByTagNameNS(ns, "v")).toHaveLength(0);
  } finally { importer.retire(); await f.close(); }
});

test("Excel import uses actual create ACK and captured Workspace without manual revision reseeding", async () => {
  const f = clientStoreFixture();
  const importer = createSpreadsheetImporter(async () => converted);
  try {
    const result = await importer.importFile(input());
    expect(result?.spreadsheet.title).toBe("Imported book");
    expect(result?.spreadsheet.sheets[0].cells.A1.valueType).toBe("text");
    expect(getSpreadsheet(result!.spreadsheet.id)).toEqual(result!.spreadsheet);
    expect(getSpreadsheetSaveState(result!.spreadsheet.id)).toBe("clean");
    expect(result!.spreadsheet).toEqual(await (await f.app.request("/api/spreadsheets/"+result!.spreadsheet.id+"?space_id=A")).json());
    expect(f.calls.filter(call => call.method === "PUT")).toHaveLength(1);
  } finally {importer.retire();await f.close();}
});

import { loadSpreadsheets, loadSpreadsheetFromApi } from "../lib/storage.ts";
import { captureCreateReceipt } from "../../../shared/lib/create-receipt.ts";

test("retired A to B to A conversion cannot create a row or overwrite another Workspace cache", async () => {
  const f = clientStoreFixture(), conversion = deferred<ImportedSpreadsheet>();
  const importer = createSpreadsheetImporter(async () => conversion.promise);
  try {
    const pending = importer.importFile(input());
    f.scope("B");importer.retire();
    const existing = await f.seed("B","B original");await loadSpreadsheetFromApi(existing.id);
    const beforeB = [...f.values.entries()].filter(([key]) => key.includes(":workspace:B"));
    f.scope("A");conversion.resolve(converted);
    expect(await pending).toBeNull();
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(0);
    expect(loadSpreadsheets()).toEqual([]);
    expect([...f.values.entries()].filter(([key]) => key.includes(":workspace:B"))).toEqual(beforeB);
  } finally {importer.retire();await f.close();}
});

test("an uncertain imported create stays retained and is never automatically replayed", async () => {
  const f = clientStoreFixture(), importer = createSpreadsheetImporter(async () => converted);
  try {
    f.loseNextWrite();
    await expect(importer.importFile(input())).rejects.toThrow("500");
    const local = loadSpreadsheets()[0];
    expect(getSpreadsheetSaveState(local.id)).toBe("failed");
    expect((await f.app.request("/api/spreadsheets/"+local.id+"?space_id=A")).status).toBe(200); // the real store committed before losing its ACK
    const token = captureCreateReceipt("takos-sheet-create-receipt").current();
    expect(token).not.toBeNull();
    await expect(importer.importFile(input())).rejects.toThrow("fresh library read");
    expect(captureCreateReceipt("takos-sheet-create-receipt").current()).toBe(token);
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(1);
  } finally {importer.retire();await f.close();}
});

test("another create started during file conversion keeps its original uncertainty receipt", async () => {
  const f = clientStoreFixture(), conversion = deferred<ImportedSpreadsheet>();
  const importer = createSpreadsheetImporter(async () => conversion.promise);
  try {
    const pending = importer.importFile(input());
    const receipt = captureCreateReceipt("takos-sheet-create-receipt"), token = receipt.begin();
    conversion.resolve(converted);
    await expect(pending).rejects.toThrow("fresh library read");
    expect(receipt.current()).toBe(token);
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(0);
  } finally {importer.retire();await f.close();}
});

test("a retired in-flight import settles its original ACK and receipt without adopting into B", async () => {
  const f = clientStoreFixture(), importer = createSpreadsheetImporter(async () => converted);
  try {
    const held = f.holdNext("PUT"), pending = importer.importFile(input());
    await held.started;
    const original = loadSpreadsheets()[0];
    f.scope("B");importer.retire();const beforeB=[...f.values.entries()].filter(([key]) => key.includes(":workspace:B"));
    held.release();expect(await pending).toBeNull();
    expect([...f.values.entries()].filter(([key]) => key.includes(":workspace:B"))).toEqual(beforeB);
    f.scope("A");
    expect(getSpreadsheet(original.id)).toEqual(await (await f.app.request("/api/spreadsheets/"+original.id+"?space_id=A")).json());
    expect(getSpreadsheetSaveState(original.id)).toBe("clean");
    expect(captureCreateReceipt("takos-sheet-create-receipt").current()).toBeNull();
    expect(f.calls.filter(call => call.method==="PUT")).toHaveLength(1);
  } finally {importer.retire();await f.close();}
});

for (const change of ["reference", "scope", "order", "direct-put", "edit-value"] as const) {
  test(`named-input mutation ${change} invalidates imported results through actual ACK/read/export`, async () => {
    const f = clientStoreFixture();
    const data = structuredClone(converted);
    data.spreadsheet.definedNames = [{ name: "Area", reference: "Sheet1!$A$1", localSheetId: 0 }];
    data.spreadsheet.sheets[0].cells.B1 = { value: "=_xlfn.FUTUREFUNC(Area)", computed: "42", computedType: "number", computedSource: "file" };
    data.spreadsheet.sheets.push({ id: "other", name: "Other", cells: {}, colWidths: {}, rowHeights: {} });
    const importer = createSpreadsheetImporter(async () => data);
    try {
      const original = (await importer.importFile(input()))!.spreadsheet, draft = structuredClone(original);
      if (change === "reference" || change === "direct-put") draft.definedNames![0].reference = "Sheet1!$A$2";
      if (change === "scope") draft.definedNames![0].localSheetId = 1;
      if (change === "order") draft.sheets.reverse();
      if (change === "edit-value") draft.sheets[0].cells = setCellValue(draft.sheets[0], "A1", "7", draft.sheets);
      let ack;
      if (change === "direct-put") {
        const response = await f.app.request("/api/spreadsheets/" + original.id + "?space_id=A", {
          method: "PUT", headers: { "Content-Type": "application/json", "If-Match": original.updatedAt }, body: JSON.stringify(draft),
        });
        expect(response.status).toBe(200); ack = await response.json();
      } else ack = (await captureSpreadsheetWriter(original.id)(draft))!;
      const actual = await (await f.app.request("/api/spreadsheets/" + original.id + "?space_id=A")).json();
      const cell = actual.sheets.find((sheet: { id: string }) => sheet.id === original.sheets[0].id).cells.B1;
      expect(cell.computedSource).toBe("stale"); expect(cell.computed).toBe("42");
      const output = await exportXlsx(ack), pkg = await readOfficePackage(new Uint8Array(await output.blob.arrayBuffer()));
      const worksheets = [...pkg.relationships.get(pkg.mainPart)!.values()].filter(rel => isOfficeRelationship(rel, "worksheet"));
      const xml = pkg.xmlParts.get(worksheets[ack.sheets.findIndex((sheet: { id: string }) => sheet.id === original.sheets[0].id)].target)!, ns = xml.documentElement!.namespaceURI!;
      const formula = Array.from(xml.getElementsByTagNameNS(ns, "c")).find(c => c.getAttribute("r") === "B1")!;
      expect(formula.getElementsByTagNameNS(ns, "v")).toHaveLength(0);
    } finally { importer.retire(); await f.close(); }
  });
}

for (const operation of ["insertRows", "deleteRows", "insertColumns", "deleteColumns", "renameTab", "removeTab", "local-rename", "local-delete"] as const) {
  test(`symbolic-name structural edit ${operation} refuses without changing the workbook`, async () => {
    const f = clientStoreFixture(), data = structuredClone(converted);
    data.spreadsheet.definedNames = [{ name: "Area", reference: "Sheet1!$A$1", localSheetId: 0 }];
    data.spreadsheet.sheets.push({ id: "other", name: "Other", cells: {}, colWidths: {}, rowHeights: {} });
    const importer = createSpreadsheetImporter(async () => data);
    try {
      const original = (await importer.importFile(input()))!.spreadsheet, store = f.store("A"), sheetId = original.sheets[0].id;
      if (operation === "local-rename") expect(() => renameSheet(original.id, sheetId, "Renamed")).toThrow("defined names");
      else if (operation === "local-delete") expect(() => deleteSheet(original.id, sheetId)).toThrow("defined names");
      else if (operation === "renameTab") await expect(store.renameTab(original.id, sheetId, "Renamed")).rejects.toThrow("defined names");
      else if (operation === "removeTab") await expect(store.removeTab(original.id, sheetId)).rejects.toThrow("defined names");
      else await expect(store[operation](original.id, sheetId, 0, 1)).rejects.toThrow("defined names");
      expect(await (await f.app.request("/api/spreadsheets/" + original.id + "?space_id=A")).json()).toEqual(original);
      expect(getSpreadsheet(original.id)).toEqual(original);
    } finally { importer.retire(); await f.close(); }
  });
}
