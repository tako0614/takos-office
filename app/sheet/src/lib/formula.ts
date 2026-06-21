import { HyperFormula } from "hyperformula";
import type { CellData, Sheet } from "../types/index.ts";
import { columnToLetter, parseCellAddress } from "./cell-utils.ts";

/**
 * Whether a raw cell string is an unambiguous, canonical number that is safe to
 * coerce to a JS number without losing information. This deliberately rejects
 * values that round-trip differently (leading zeros like "007", hex "0x1F",
 * scientific "1e3", signed-with-plus "+15551234", Infinity/NaN) so that phone
 * numbers, zip/postal codes and IDs are never silently mangled.
 */
export function looksNumeric(v: string): boolean {
  const trimmed = v.trim();
  if (trimmed === "") return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && String(n) === trimmed;
}

/**
 * Render a HyperFormula cell value as the string we store in `computed`.
 * Preserves the real Excel error token (#DIV/0!, #REF!, …) and uppercase
 * booleans, instead of collapsing everything to a generic "#ERROR!".
 */
export function formatHfResult(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "boolean") return result ? "TRUE" : "FALSE";
  if (typeof result === "number") return String(result);
  if (typeof result === "object") {
    const err = result as { value?: unknown; type?: unknown };
    if (typeof err.value === "string") return err.value; // e.g. "#DIV/0!"
    if (typeof err.type === "string") {
      return `#${String(err.type).toUpperCase()}!`;
    }
    return "#ERROR!";
  }
  return String(result);
}

const MAX_ENGINE_ROWS = 1000;
const MAX_ENGINE_COLS = 100;

/** Build the dense 2D value array HyperFormula expects from a sheet's cells. */
function buildSheetData(sheet: Sheet): (string | number | null)[][] {
  let dataMaxRow = 0;
  let dataMaxCol = 0;
  for (const addr of Object.keys(sheet.cells)) {
    try {
      const { col, row } = parseCellAddress(addr);
      dataMaxRow = Math.max(dataMaxRow, row);
      dataMaxCol = Math.max(dataMaxCol, col);
    } catch {
      // skip invalid addresses
    }
  }

  const rows = Math.min(Math.max(dataMaxRow + 1, 1), MAX_ENGINE_ROWS);
  const cols = Math.min(Math.max(dataMaxCol + 1, 1), MAX_ENGINE_COLS);
  const data: (string | number | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: (string | number | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = sheet.cells[`${columnToLetter(c)}${r + 1}`];
      if (cell) {
        const v = cell.value;
        if (v.startsWith("=")) row.push(v);
        else if (looksNumeric(v)) row.push(Number(v));
        else row.push(v || null);
      } else {
        row.push(null);
      }
    }
    data.push(row);
  }
  return data;
}

/**
 * Build a fresh HyperFormula engine containing every sheet of the workbook,
 * named to match the tabs so cross-sheet references like `=Sheet2!A1` resolve.
 *
 * A fresh instance per evaluation (rather than a shared module-global) also
 * means concurrent evaluations of different workbooks can't race on one engine.
 * Returns the engine and a map from each `Sheet.id` to its HyperFormula id.
 */
function buildEngine(sheets: Sheet[]): {
  hf: HyperFormula;
  idBySheetId: Map<string, number>;
} {
  const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
  const idBySheetId = new Map<string, number>();
  const usedNames = new Set<string>();

  // Create every sheet first so cross-sheet references (`=Sheet2!A1`) resolve
  // before any sheet's formulas are loaded, then fill content in a second pass.
  for (const sheet of sheets) {
    // HyperFormula sheet names must be unique; fall back to the id on collision.
    let name = sheet.name;
    if (usedNames.has(name)) name = `${sheet.name}__${sheet.id}`;
    usedNames.add(name);
    const actual = hf.addSheet(name);
    const hfId = hf.getSheetId(actual);
    if (hfId !== undefined) idBySheetId.set(sheet.id, hfId);
  }
  for (const sheet of sheets) {
    const hfId = idBySheetId.get(sheet.id);
    if (hfId !== undefined) hf.setSheetContent(hfId, buildSheetData(sheet));
  }
  return { hf, idBySheetId };
}

/**
 * Evaluate every formula in `sheet`, returning updated cells. Pass the whole
 * workbook as `allSheets` so cross-sheet references resolve; defaults to the
 * single sheet for callers that don't have the workbook.
 */
export function evaluateSheet(
  sheet: Sheet,
  allSheets: Sheet[] = [sheet],
): Record<string, CellData> {
  const sheets = allSheets.some((s) => s.id === sheet.id)
    ? allSheets
    : [...allSheets, sheet];
  const { hf, idBySheetId } = buildEngine(sheets);
  const sheetId = idBySheetId.get(sheet.id) ?? 0;
  const updatedCells: Record<string, CellData> = { ...sheet.cells };

  for (
    const [addr, cell] of Object.entries(sheet.cells) as [string, CellData][]
  ) {
    if (!cell.value) {
      updatedCells[addr] = { ...cell, computed: "" };
      continue;
    }

    // Literal (non-formula) cells display exactly what the user typed. Only
    // formulas are evaluated, so "007"/"+1555..." etc. are never coerced.
    if (!cell.value.startsWith("=")) {
      updatedCells[addr] = { ...cell, computed: cell.value };
      continue;
    }

    try {
      const { col, row } = parseCellAddress(addr);
      const result = hf.getCellValue({ sheet: sheetId, row, col });
      updatedCells[addr] = { ...cell, computed: formatHfResult(result) };
    } catch {
      updatedCells[addr] = { ...cell, computed: "#ERROR!" };
    }
  }

  return updatedCells;
}

/**
 * Evaluate a one-off formula in the context of a sheet, with the whole workbook
 * loaded so cross-sheet refs resolve. Does not write a scratch cell.
 */
export function evaluateFormula(
  formula: string,
  contextSheet: Sheet,
  allSheets: Sheet[] = [contextSheet],
): string {
  const sheets = allSheets.some((s) => s.id === contextSheet.id)
    ? allSheets
    : [...allSheets, contextSheet];
  const { hf, idBySheetId } = buildEngine(sheets);
  const sheetId = idBySheetId.get(contextSheet.id) ?? 0;
  try {
    const normalized = formula.startsWith("=") ? formula : `=${formula}`;
    return formatHfResult(hf.calculateFormula(normalized, sheetId));
  } catch {
    return "#ERROR!";
  }
}

/**
 * Set a cell value and re-evaluate. Pass the workbook as `allSheets` so
 * cross-sheet references resolve during the re-evaluation.
 */
export function setCellValue(
  sheet: Sheet,
  address: string,
  value: string,
  allSheets?: Sheet[],
): Record<string, CellData> {
  const updatedCells = { ...sheet.cells };
  const existing = updatedCells[address];
  updatedCells[address] = {
    ...existing,
    value,
    format: existing?.format,
  };

  const updatedSheet = { ...sheet, cells: updatedCells };
  const siblings = allSheets
    ? allSheets.map((s) => (s.id === sheet.id ? updatedSheet : s))
    : [updatedSheet];
  return evaluateSheet(updatedSheet, siblings);
}

/**
 * Get the computed value for a cell
 */
export function getCellValue(
  sheet: Sheet,
  address: string,
): string {
  const cell = sheet.cells[address];
  if (!cell) return "";
  return cell.computed ?? cell.value;
}
