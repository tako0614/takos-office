import { expect, test } from "bun:test";
import { computeUsedRange } from "../lib/cell-utils.ts";
import type { CellData } from "../types/index.ts";

function cell(value: string): CellData {
  return { value };
}

// ---------------------------------------------------------------------------
// computeUsedRange
// ---------------------------------------------------------------------------

test("computeUsedRange reports an empty sheet", () => {
  expect(computeUsedRange({})).toEqual({ range: null, rows: 0, cols: 0 });
});

test("computeUsedRange handles a single cell", () => {
  expect(computeUsedRange({ B3: cell("hi") })).toEqual({
    range: "B3:B3",
    startRow: 2,
    startCol: 1,
    endRow: 2,
    endCol: 1,
    rows: 1,
    cols: 1,
  });
});

test("computeUsedRange bounds a scattered block (B2 and D5 -> B2:D5)", () => {
  expect(computeUsedRange({ B2: cell("x"), D5: cell("y") })).toEqual({
    range: "B2:D5",
    startRow: 1,
    startCol: 1,
    endRow: 4,
    endCol: 3,
    rows: 4,
    cols: 3,
  });
});

test("computeUsedRange excludes whitespace-only and absent cells", () => {
  const cells: Record<string, CellData> = {
    A1: cell(""),
    B2: cell("   "),
    C3: cell("\t\n"),
    D4: cell("data"),
  };
  expect(computeUsedRange(cells)).toEqual({
    range: "D4:D4",
    startRow: 3,
    startCol: 3,
    endRow: 3,
    endCol: 3,
    rows: 1,
    cols: 1,
  });
});

test("computeUsedRange returns empty when every cell is whitespace/empty", () => {
  expect(computeUsedRange({ A1: cell(""), Z9: cell("  ") })).toEqual({
    range: null,
    rows: 0,
    cols: 0,
  });
});

test("computeUsedRange ignores cells with unparsable addresses", () => {
  const cells: Record<string, CellData> = {
    "not-a-cell": cell("junk"),
    A1: cell("real"),
  };
  expect(computeUsedRange(cells)).toEqual({
    range: "A1:A1",
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0,
    rows: 1,
    cols: 1,
  });
});
