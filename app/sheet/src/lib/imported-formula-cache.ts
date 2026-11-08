import type { Spreadsheet } from "../types/index.ts";

/** Formatting, viewport and title changes do not invalidate formula inputs. */
export function spreadsheetInputsChanged(previous: Spreadsheet, next: Spreadsheet): boolean {
  if (previous.sheets.length !== next.sheets.length) return true;
  const names = (book: Spreadsheet) => (book.definedNames ?? []).map(({ name, reference, localSheetId }) => [name, reference, localSheetId ?? null]);
  if (JSON.stringify(names(previous)) !== JSON.stringify(names(next))) return true;
  if (previous.sheets.some((sheet, index) => sheet.id !== next.sheets[index].id)) return true;
  const oldSheets = new Map(previous.sheets.map(sheet => [sheet.id, sheet]));
  for (const sheet of next.sheets) {
    const old = oldSheets.get(sheet.id);
    if (!old || old.name !== sheet.name) return true;
    const addresses = new Set([...Object.keys(old.cells), ...Object.keys(sheet.cells)]);
    for (const address of addresses) {
      const a = old.cells[address], b = sheet.cells[address];
      if ((a?.value ?? "") !== (b?.value ?? "") || a?.valueType !== b?.valueType) return true;
    }
  }
  return false;
}

/** Retain historical data but never export it as a current calculated result. */
export function invalidateImportedFormulaCaches(spreadsheet: Spreadsheet): Spreadsheet {
  return { ...spreadsheet, sheets: spreadsheet.sheets.map(sheet => ({ ...sheet,
    cells: Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => [address,
      cell.computedSource === "file" ? { ...cell, computedSource: "stale" as const } : cell,
    ])),
  })) };
}

/** Symbolic Excel names are retained, but this editor cannot rewrite their references. */
export function assertNamedRangeStructureEditable(spreadsheet: Spreadsheet): void {
  if (spreadsheet.definedNames?.length) throw new Error("Workbooks with defined names require Excel for structural edits");
}
