import { expect, test } from "bun:test";
import {
  compareCellValues,
  filterHiddenRows,
  shiftCells,
  sortRangeRows,
} from "../lib/sheet-ops.ts";
import { shiftSheetStructure } from "../lib/formula.ts";
import type { CellData, Sheet } from "../types/index.ts";

function cell(value: string, format?: CellData["format"]): CellData {
  return format ? { value, format } : { value };
}

// ---------------------------------------------------------------------------
// shiftCells — pure address-shift (insert/delete rows & columns)
// ---------------------------------------------------------------------------

test("shiftCells inserts a row: cells at/below `at` move down, formats preserved", () => {
  const cells = {
    A1: cell("top"),
    A2: cell("mid", { bold: true }),
    A3: cell("bot"),
  };
  // Insert 1 row at index 1 (above A2): A2 -> A3, A3 -> A4.
  const result = shiftCells(cells, "row", 1, 1);
  expect(result.A1).toEqual(cell("top"));
  expect(result.A2).toBeUndefined(); // opened-up empty band
  expect(result.A3).toEqual(cell("mid", { bold: true }));
  expect(result.A4).toEqual(cell("bot"));
});

test("shiftCells inserts multiple rows by count", () => {
  const result = shiftCells({ A1: cell("a"), A2: cell("b") }, "row", 1, 2);
  expect(result.A1).toEqual(cell("a"));
  expect(result.A2).toBeUndefined();
  expect(result.A3).toBeUndefined();
  expect(result.A4).toEqual(cell("b"));
});

test("shiftCells deletes a column: removes it and shifts the rest left", () => {
  const cells = {
    A1: cell("a"),
    B1: cell("b"),
    C1: cell("c"),
    D1: cell("d"),
  };
  // Delete column at index 1 (B): B dropped, C -> B, D -> C.
  const result = shiftCells(cells, "col", 1, -1);
  expect(result.A1).toEqual(cell("a"));
  expect(result.B1).toEqual(cell("c"));
  expect(result.C1).toEqual(cell("d"));
  expect(result.D1).toBeUndefined();
});

test("shiftCells deletes multiple columns by count", () => {
  const cells = { A1: cell("a"), B1: cell("b"), C1: cell("c"), D1: cell("d") };
  const result = shiftCells(cells, "col", 1, -2); // remove B,C; D -> B
  expect(result.A1).toEqual(cell("a"));
  expect(result.B1).toEqual(cell("d"));
  expect(result.C1).toBeUndefined();
  expect(result.D1).toBeUndefined();
});

test("shiftCells preserves cells above the insert point unchanged", () => {
  const result = shiftCells({ A1: cell("keep"), A5: cell("move") }, "row", 3, 1);
  expect(result.A1).toEqual(cell("keep"));
  expect(result.A6).toEqual(cell("move"));
});

test("shiftCells passes through unparsable addresses", () => {
  const result = shiftCells(
    { "bad-addr": cell("x"), A2: cell("y") },
    "row",
    0,
    1,
  );
  expect(result["bad-addr"]).toEqual(cell("x"));
  expect(result.A3).toEqual(cell("y"));
});

// ---------------------------------------------------------------------------
// compareCellValues
// ---------------------------------------------------------------------------

test("compareCellValues orders numbers numerically", () => {
  expect(compareCellValues("2", "10")).toBeLessThan(0);
  expect(compareCellValues("10", "2")).toBeGreaterThan(0);
  expect(compareCellValues("5", "5")).toBe(0);
});

test("compareCellValues orders non-numbers as strings", () => {
  expect(compareCellValues("apple", "banana")).toBeLessThan(0);
  expect(compareCellValues("banana", "apple")).toBeGreaterThan(0);
});

test("compareCellValues sorts empties last", () => {
  expect(compareCellValues("", "a")).toBeGreaterThan(0);
  expect(compareCellValues("a", "")).toBeLessThan(0);
  expect(compareCellValues("", "")).toBe(0);
});

// ---------------------------------------------------------------------------
// sortRangeRows
// ---------------------------------------------------------------------------

const range3x3 = { startCol: 0, startRow: 0, endCol: 1, endRow: 2 };

test("sortRangeRows orders rows by the key column ascending (numbers)", () => {
  // A column = key, B column = tag that must travel with its row.
  const cells = {
    A1: cell("3"),
    B1: cell("three"),
    A2: cell("1"),
    B2: cell("one"),
    A3: cell("2"),
    B3: cell("two"),
  };
  const result = sortRangeRows(cells, range3x3, 0, "asc");
  expect(result.A1.value).toBe("1");
  expect(result.B1.value).toBe("one");
  expect(result.A2.value).toBe("2");
  expect(result.B2.value).toBe("two");
  expect(result.A3.value).toBe("3");
  expect(result.B3.value).toBe("three");
});

test("sortRangeRows orders rows descending (numbers)", () => {
  const cells = {
    A1: cell("1"),
    A2: cell("3"),
    A3: cell("2"),
  };
  const result = sortRangeRows(
    cells,
    { startCol: 0, startRow: 0, endCol: 0, endRow: 2 },
    0,
    "desc",
  );
  expect(result.A1.value).toBe("3");
  expect(result.A2.value).toBe("2");
  expect(result.A3.value).toBe("1");
});

test("sortRangeRows compares strings when not numeric", () => {
  const cells = {
    A1: cell("cherry"),
    A2: cell("apple"),
    A3: cell("banana"),
  };
  const result = sortRangeRows(
    cells,
    { startCol: 0, startRow: 0, endCol: 0, endRow: 2 },
    0,
    "asc",
  );
  expect(result.A1.value).toBe("apple");
  expect(result.A2.value).toBe("banana");
  expect(result.A3.value).toBe("cherry");
});

test("sortRangeRows puts empties last in both directions", () => {
  const base = {
    A1: cell(""),
    A2: cell("2"),
    A3: cell("1"),
  };
  const asc = sortRangeRows(
    base,
    { startCol: 0, startRow: 0, endCol: 0, endRow: 2 },
    0,
    "asc",
  );
  expect(asc.A1.value).toBe("1");
  expect(asc.A2.value).toBe("2");
  expect(asc.A3.value).toBe(""); // empty last despite ascending

  const desc = sortRangeRows(
    base,
    { startCol: 0, startRow: 0, endCol: 0, endRow: 2 },
    0,
    "desc",
  );
  expect(desc.A1.value).toBe("2");
  expect(desc.A2.value).toBe("1");
  expect(desc.A3.value).toBe(""); // empty STILL last despite descending
});

test("sortRangeRows preserves formats with their moved rows", () => {
  const cells = {
    A1: cell("2", { bold: true }),
    A2: cell("1", { italic: true }),
  };
  const result = sortRangeRows(
    cells,
    { startCol: 0, startRow: 0, endCol: 0, endRow: 1 },
    0,
    "asc",
  );
  expect(result.A1).toEqual(cell("1", { italic: true }));
  expect(result.A2).toEqual(cell("2", { bold: true }));
});

test("sortRangeRows leaves cells outside the range untouched", () => {
  const cells = {
    A1: cell("2"),
    A2: cell("1"),
    Z9: cell("outside"),
  };
  const result = sortRangeRows(
    cells,
    { startCol: 0, startRow: 0, endCol: 0, endRow: 1 },
    0,
    "asc",
  );
  expect(result.Z9).toEqual(cell("outside"));
});

// ---------------------------------------------------------------------------
// shiftSheetStructure — HyperFormula-backed formula-reference adjustment
// ---------------------------------------------------------------------------

function sheetWith(cells: Record<string, CellData>): Sheet {
  return { id: "s1", name: "Sheet1", cells, colWidths: {}, rowHeights: {} };
}

test("inserting a row above a referenced cell adjusts the formula ref", () => {
  // A1 = 10, B1 = "=A1". Insert a row at index 0 (above row 1): A1 -> A2, and
  // the "=A1" ref should follow to "=A2" so it still points at the value.
  const sheet = sheetWith({ A1: cell("10"), B1: cell("=A1") });
  const result = shiftSheetStructure(sheet, "insertRows", 0, 1).get("s1")!;

  // The literal moved down one row.
  expect(result.A2?.value).toBe("10");
  // The formula moved down too and its reference was rewritten to A2.
  expect(result.B2?.value).toBe("=A2");
});

test("inserting a row preserves the format on the shifted formula cell", () => {
  const sheet = sheetWith({
    A1: cell("10"),
    B1: cell("=A1", { bold: true }),
  });
  const result = shiftSheetStructure(sheet, "insertRows", 0, 1).get("s1")!;
  expect(result.B2?.format).toEqual({ bold: true });
});

test("inserting a row re-points cross-sheet references in OTHER sheets", () => {
  // Sheet1!A2 = 20; Sheet2!B1 = "=Sheet1!A2". Insert a row above Sheet1!A2 so
  // its value moves to A3; Sheet2's reference must follow to "=Sheet1!A3".
  const sheet1: Sheet = {
    id: "s1",
    name: "Sheet1",
    cells: { A1: cell("10"), A2: cell("20") },
    colWidths: {},
    rowHeights: {},
  };
  const sheet2: Sheet = {
    id: "s2",
    name: "Sheet2",
    cells: { B1: cell("=Sheet1!A2") },
    colWidths: {},
    rowHeights: {},
  };
  const result = shiftSheetStructure(sheet1, "insertRows", 0, 1, [
    sheet1,
    sheet2,
  ]);
  // Target sheet shifted: the 20 landed on A3.
  expect(result.get("s1")!.A3?.value).toBe("20");
  // The OTHER sheet's cross-sheet ref followed the moved cell.
  expect(result.get("s2")!.B1?.value).toBe("=Sheet1!A3");
});

test("filterHiddenRows keeps the header and matching rows, hides the rest", () => {
  const cells: Record<string, import("../types/index.ts").CellData> = {
    A1: { value: "Name" },
    A2: { value: "Apple", computed: "Apple" },
    A3: { value: "Banana", computed: "Banana" },
    A4: { value: "apricot", computed: "apricot" },
  };
  const hidden = filterHiddenRows(cells, 0, "ap", 3); // maxRow=3 (A4 is row index 3)
  // row 0 (header) always visible; A2 "Apple" and A4 "apricot" match "ap";
  // A3 "Banana" hidden.
  expect([...hidden].sort()).toEqual([2]);
});

test("filterHiddenRows returns empty for a blank query", () => {
  const cells = { A1: { value: "x" }, A2: { value: "y" } };
  expect(filterHiddenRows(cells, 0, "  ", 1).size).toBe(0);
});
