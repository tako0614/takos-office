import type { CellData, CellFormat } from "../types/index.ts";
import { formatCellAddress, parseCellAddress } from "./cell-utils.ts";
import { looksNumeric } from "./formula.ts";

/**
 * Pure structural operations on a sheet's cell map: address-shifting for
 * row/column insert & delete, and within-range row reordering for sort. These
 * are kept free of HyperFormula and the store so they are unit-testable in
 * isolation; the store wires them together with `evaluateSheet` + persistence.
 */

export type ShiftAxis = "row" | "col";

/**
 * Shift the keys of a cell map along one axis to model a row/column insert
 * (`delta > 0`) or delete (`delta < 0`) at 0-based index `at`.
 *
 *  - Insert (`delta = +count`): every cell whose axis-index is `>= at` moves by
 *    `+count`, opening an empty band at `[at, at+count)`.
 *  - Delete (`delta = -count`): every cell in the band `[at, at+count)` is
 *    dropped, and every cell whose axis-index is `>= at+count` moves by
 *    `-count` to close the gap.
 *
 * This is a PURE address-shift of the cell map: it does NOT rewrite formula
 * references inside cell values. The store's insert/delete methods run the
 * shift through HyperFormula so refs adjust, and use this helper only to carry
 * per-cell formats to their shifted addresses. Cells with unparsable addresses
 * are passed through unchanged.
 */
export function shiftCells<T>(
  cells: Record<string, T>,
  axis: ShiftAxis,
  at: number,
  delta: number,
): Record<string, T> {
  const result: Record<string, T> = {};
  const deleteCount = delta < 0 ? -delta : 0;

  for (const [addr, data] of Object.entries(cells)) {
    let parsed: { col: number; row: number };
    try {
      parsed = parseCellAddress(addr);
    } catch {
      // Pass through addresses we can't parse rather than dropping data.
      result[addr] = data;
      continue;
    }

    const index = axis === "row" ? parsed.row : parsed.col;

    // Delete: drop cells inside the removed band entirely.
    if (deleteCount > 0 && index >= at && index < at + deleteCount) {
      continue;
    }

    let newIndex = index;
    if (index >= at) newIndex = index + delta;
    // Defensive: never produce a negative index (band is already filtered out).
    if (newIndex < 0) continue;

    const newCol = axis === "col" ? newIndex : parsed.col;
    const newRow = axis === "row" ? newIndex : parsed.row;
    try {
      result[formatCellAddress(newCol, newRow)] = data;
    } catch {
      // Shifted out of bounds (past the grid edge): drop rather than throw.
    }
  }

  return result;
}

/**
 * Compare two raw cell values for sorting. Numeric when both look like
 * canonical numbers, else case-insensitive string compare. Empty values always
 * sort last regardless of direction (the caller flips non-empty pairs for
 * descending).
 */
export function compareCellValues(a: string, b: string): number {
  const aEmpty = a.trim() === "";
  const bEmpty = b.trim() === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (looksNumeric(a) && looksNumeric(b)) {
    return Number(a) - Number(b);
  }
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Reorder the rows of a rectangular range by the value in `columnIndex`
 * (0-based, relative to the range's left edge). Whole row-slices move together
 * (values + formats), so formulas that reference cells outside the range are
 * left untouched. `direction` is 'asc' | 'desc'; empties always sort last.
 *
 * Returns a NEW cell map: cells inside the range are rewritten to their sorted
 * positions and cells outside the range are preserved. Pure: no evaluation or
 * persistence. The caller re-evaluates afterwards.
 */
export function sortRangeRows(
  cells: Record<string, CellData>,
  range: {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  },
  columnIndex: number,
  direction: "asc" | "desc",
): Record<string, CellData> {
  const { startCol, startRow, endCol, endRow } = range;
  const width = endCol - startCol + 1;
  const keyCol = startCol + columnIndex;

  // Capture each row-slice (column offset -> cell) plus its sort key.
  type RowSlice = { key: string; cells: Map<number, CellData> };
  const slices: RowSlice[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const slice = new Map<number, CellData>();
    for (let c = startCol; c <= endCol; c++) {
      const cell = cells[formatCellAddress(c, r)];
      if (cell) slice.set(c - startCol, cell);
    }
    const keyCell = cells[formatCellAddress(keyCol, r)];
    // Sort on the COMPUTED value, not the raw source: a formula column's raw
    // value is its source text (e.g. "=B2*C2"), which would sort
    // lexicographically ("=100" < "=2") instead of by the evaluated number.
    // Falls back to the raw value for literals (computed === value there).
    slices.push({
      key: keyCell?.computed ?? keyCell?.value ?? "",
      cells: slice,
    });
  }

  // Stable sort: keep original order among equal keys.
  const indexed = slices.map((slice, i) => ({ slice, i }));
  indexed.sort((a, b) => {
    const cmp = compareCellValues(a.slice.key, b.slice.key);
    if (cmp !== 0) {
      // Empty always sorts last; flip only the comparison of two non-empties.
      const aEmpty = a.slice.key.trim() === "";
      const bEmpty = b.slice.key.trim() === "";
      if (aEmpty || bEmpty) return cmp;
      return direction === "desc" ? -cmp : cmp;
    }
    return a.i - b.i;
  });

  // Rebuild the cell map: clear the range, then write the sorted slices back.
  const result: Record<string, CellData> = { ...cells };
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      delete result[formatCellAddress(c, r)];
    }
  }
  for (let i = 0; i < indexed.length; i++) {
    const targetRow = startRow + i;
    const slice = indexed[i].slice.cells;
    for (let offset = 0; offset < width; offset++) {
      const cell = slice.get(offset);
      if (cell) result[formatCellAddress(startCol + offset, targetRow)] = cell;
    }
  }

  return result;
}

/**
 * Read the cell map back from a HyperFormula sheet after a structural shift,
 * preserving per-cell formats. For each occupied engine cell we keep the
 * formula (so HyperFormula's adjusted references survive) when present, else the
 * literal value. `shiftedFormats` maps each FINAL address to the format that
 * belongs there (produced by `shiftCells` on the pre-shift format map).
 */
export function rebuildCellsFromEngine(
  read: {
    width: number;
    height: number;
    formulaAt: (col: number, row: number) => string | undefined;
    valueAt: (col: number, row: number) => unknown;
  },
  shiftedFormats: Record<string, CellFormat>,
): Record<string, CellData> {
  const result: Record<string, CellData> = {};
  for (let row = 0; row < read.height; row++) {
    for (let col = 0; col < read.width; col++) {
      let addr: string;
      try {
        addr = formatCellAddress(col, row);
      } catch {
        continue;
      }
      const formula = read.formulaAt(col, row);
      let value: string;
      if (formula !== undefined) {
        value = formula; // already includes the leading "="
      } else {
        const raw = read.valueAt(col, row);
        if (raw === null || raw === undefined || raw === "") continue;
        value = stringifyEngineValue(raw);
      }
      const format = shiftedFormats[addr];
      result[addr] = format ? { value, format } : { value };
    }
  }
  // Materialize format-only cells (empty value + format) that the engine left
  // empty: they were pushed to HyperFormula as null so produce no engine cell,
  // but their shifted format must still follow the structural move.
  for (const [addr, format] of Object.entries(shiftedFormats)) {
    if (!result[addr]) result[addr] = { value: "", format };
  }
  return result;
}

/** Stringify a HyperFormula literal value back to the raw form we store. */
function stringifyEngineValue(raw: unknown): string {
  if (typeof raw === "boolean") return raw ? "TRUE" : "FALSE";
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "object") {
    const err = raw as { value?: unknown };
    if (typeof err.value === "string") return err.value;
    return String(raw);
  }
  return String(raw);
}

/**
 * Rows to hide for a column filter. Row 0 is treated as a header and always
 * kept; within `[1, maxRow]` a row is hidden when the filter column's cell
 * (computed value, falling back to raw) does not contain `query`
 * (case-insensitive). Rows beyond `maxRow` (the used range) are left visible so
 * the empty tail stays editable.
 */
export function filterHiddenRows(
  cells: Record<string, CellData>,
  column: number,
  query: string,
  maxRow: number,
): Set<number> {
  const hidden = new Set<number>();
  const q = query.trim().toLowerCase();
  if (!q) return hidden;
  for (let r = 1; r <= maxRow; r++) {
    const cell = cells[formatCellAddress(column, r)];
    const text = (cell?.computed ?? cell?.value ?? "").toLowerCase();
    if (!text.includes(q)) hidden.add(r);
  }
  return hidden;
}
