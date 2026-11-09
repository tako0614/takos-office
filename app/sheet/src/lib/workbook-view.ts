import type { CellData, Spreadsheet } from "../types/index.ts";
import { evaluateSheet, recalculateWorkbook } from "./formula.ts";

const isFormula = (cell: CellData) => cell.valueType !== "text" && cell.value.startsWith("=");

/** Derived read view only: keep raw inputs, history, identity and revision.
 * No cache write or persistence is performed while opening an older workbook. */
export function refreshWorkbookReadView(book: Spreadsheet): Spreadsheet {
  let sheets: Spreadsheet["sheets"];
  try { sheets = recalculateWorkbook(book.sheets); }
  catch {
    // An incompatible legacy calculation graph must not hide the workbook or
    // turn old cached numbers into a claimed successful calculation.
    sheets = book.sheets.map(sheet => ({ ...sheet, cells: Object.fromEntries(
      Object.entries(sheet.cells).map(([address, cell]) => [address,
        cell.computedSource ? { ...cell }
          : isFormula(cell) ? { ...cell, computed: "#ERROR!", computedType: "error" }
          : { ...cell, computed: cell.value },
      ]),
    ) }));
  }
  return { ...book, sheets: sheets.map((sheet, index) => ({ ...sheet, cells: Object.fromEntries(
    Object.entries(sheet.cells).map(([address, cell]) => {
      const original = book.sheets[index].cells[address];
      // A literal with no derived cache already displays its raw value. Keep
      // its existing shape, including create/import ACK equality.
      return [address, original.computed === undefined && !isFormula(original) ? { ...original } : cell];
    }),
  ) })) };
}

/** Adopt either a server read or a protected local draft before seeding Undo. */
export function prepareSpreadsheetForEditing(book: Spreadsheet): Spreadsheet {
  const view = refreshWorkbookReadView(book);
  const index = Math.max(0, view.sheets.findIndex(sheet => sheet.id === view.activeSheetId));
  const active = view.sheets[index];
  if (active) {
    try { view.sheets[index] = { ...active, cells: evaluateSheet(active, view.sheets, { preserveImportedCache: true }) }; }
    catch { /* The read view already exposes calculation errors and preserves historical results. */ }
  }
  return view;
}
