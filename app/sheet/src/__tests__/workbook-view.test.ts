import { expect, test } from "bun:test";
import { refreshWorkbookReadView, prepareSpreadsheetForEditing } from "../lib/workbook-view.ts";
import { WorkbookHistory } from "../lib/history.ts";
import type { Spreadsheet } from "../types/index.ts";

function legacyBook(): Spreadsheet {
  return { id: "book", title: "Legacy calculation", activeSheetId: "input", createdAt: "created", updatedAt: "revision", sheets: [
    { id: "input", name: "Input", cells: { A1: { value: "20", computed: "20" }, A2: { value: "007", valueType: "text" } }, colWidths: {}, rowHeights: {} },
    { id: "result", name: "Result", cells: { A1: { value: "=Input!A1", computed: "10" } }, colWidths: {}, rowHeights: {} },
    { id: "last", name: "Last", cells: { A1: { value: "=Result!A1*2", computed: "20" } }, colWidths: {}, rowHeights: {} },
  ] };
}

test("a read view refreshes legacy results and keeps revision, raw inputs and uncomputed literal shape", () => {
  const book = legacyBook(), before = structuredClone(book), view = refreshWorkbookReadView(book);
  expect(view.sheets[1].cells.A1.computed).toBe("20");
  expect(view.sheets[2].cells.A1.computed).toBe("40");
  expect(view.sheets[0].cells.A2).toEqual(book.sheets[0].cells.A2);
  expect(view.updatedAt).toBe(book.updatedAt);
  expect(book).toEqual(before);
});

test("adopting a retained local draft refreshes that draft's inputs before seeding Undo", () => {
  const retained = legacyBook();retained.sheets[0].cells.A1.value = "30";
  const before = structuredClone(retained), view = prepareSpreadsheetForEditing(retained);
  expect(view.sheets[1].cells.A1.computed).toBe("30");
  expect(view.sheets[2].cells.A1.computed).toBe("60");
  const history = new WorkbookHistory();history.reset(view);
  const edited = structuredClone(view);edited.sheets[0].cells.A1.value = "40";
  history.push(prepareSpreadsheetForEditing(edited));
  expect(history.undo()!.sheets[1].cells.A1.computed).toBe("30");
  expect(retained).toEqual(before);
});

test("passive reads keep file/stale history; active adoption retains the existing explicit refresh behavior", () => {
  const book = legacyBook();book.activeSheetId = "result";
  book.sheets[1].cells.B1 = { value: "=Input!A1", computed: "10", computedSource: "file" };
  book.sheets[1].cells.C1 = { value: "=Input!A1", computed: "10", computedSource: "stale" };
  book.sheets[1].cells.D1 = { value: "=_xlfn.FUTUREFUNC(Input!A1)", computed: "42", computedSource: "stale" };
  const read = refreshWorkbookReadView(book);
  for (const address of ["B1", "C1", "D1"]) expect(read.sheets[1].cells[address]).toEqual(book.sheets[1].cells[address]);
  const active = prepareSpreadsheetForEditing(book);
  expect(active.sheets[1].cells.B1.computedSource).toBe("file");
  expect(active.sheets[1].cells.C1.computed).toBe("20");
  expect(active.sheets[1].cells.C1.computedSource).toBeUndefined();
  expect(active.sheets[1].cells.D1).toMatchObject({ computed: "42", computedSource: "stale" });
});

test("an incompatible legacy graph remains readable with explicit calculation errors and raw data intact", () => {
  const book = legacyBook();book.sheets.push({ id: "collision", name: "input", cells: { A1: { value: "99" } }, colWidths: {}, rowHeights: {} });
  const before = structuredClone(book);
  for (const view of [refreshWorkbookReadView(book), prepareSpreadsheetForEditing(book)]) {
    expect(view.sheets[1].cells.A1).toMatchObject({ value: "=Input!A1", computed: "#ERROR!", computedType: "error" });
    expect(view.sheets[0].cells.A1.value).toBe("20");
    expect(view.sheets[0].cells.A2).toEqual(book.sheets[0].cells.A2);
    expect(view.updatedAt).toBe(book.updatedAt);
  }
  expect(book).toEqual(before);
});
