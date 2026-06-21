import { expect, test } from "bun:test";
import { throws } from "node:assert/strict";
import {
  columnToLetter,
  formatCellAddress,
  getCellRange,
  letterToColumn,
  parseCellAddress,
  parseCellRange,
} from "../lib/cell-utils.ts";

// ---------------------------------------------------------------------------
// columnToLetter
// ---------------------------------------------------------------------------

test("columnToLetter converts 0 to A", () => {
  expect(columnToLetter(0)).toEqual("A");
});

test("columnToLetter converts 1 to B", () => {
  expect(columnToLetter(1)).toEqual("B");
});

test("columnToLetter converts 25 to Z", () => {
  expect(columnToLetter(25)).toEqual("Z");
});

test("columnToLetter converts 26 to AA", () => {
  expect(columnToLetter(26)).toEqual("AA");
});

test("columnToLetter converts 27 to AB", () => {
  expect(columnToLetter(27)).toEqual("AB");
});

test("columnToLetter converts 701 to ZZ", () => {
  expect(columnToLetter(701)).toEqual("ZZ");
});

test("columnToLetter converts 702 to AAA", () => {
  expect(columnToLetter(702)).toEqual("AAA");
});

// ---------------------------------------------------------------------------
// letterToColumn
// ---------------------------------------------------------------------------

test("letterToColumn converts A to 0", () => {
  expect(letterToColumn("A")).toEqual(0);
});

test("letterToColumn converts B to 1", () => {
  expect(letterToColumn("B")).toEqual(1);
});

test("letterToColumn converts Z to 25", () => {
  expect(letterToColumn("Z")).toEqual(25);
});

test("letterToColumn converts AA to 26", () => {
  expect(letterToColumn("AA")).toEqual(26);
});

test("letterToColumn converts AB to 27", () => {
  expect(letterToColumn("AB")).toEqual(27);
});

test("letterToColumn converts ZZ to 701", () => {
  expect(letterToColumn("ZZ")).toEqual(701);
});

test("letterToColumn converts AAA to 702", () => {
  expect(letterToColumn("AAA")).toEqual(702);
});

test("letterToColumn throws for malformed letters", () => {
  throws(() => letterToColumn(""));
  throws(() => letterToColumn("a"));
  throws(() => letterToColumn("A1"));
});

// ---------------------------------------------------------------------------
// columnToLetter / letterToColumn round-trip
// ---------------------------------------------------------------------------

test("columnToLetter and letterToColumn are inverses", () => {
  for (const n of [0, 1, 13, 25, 26, 51, 100, 701, 702]) {
    expect(letterToColumn(columnToLetter(n))).toEqual(n);
  }
});

// ---------------------------------------------------------------------------
// parseCellAddress
// ---------------------------------------------------------------------------

test("parseCellAddress parses A1 correctly", () => {
  expect(parseCellAddress("A1")).toEqual({ col: 0, row: 0 });
});

test("parseCellAddress parses Z100 correctly", () => {
  expect(parseCellAddress("Z100")).toEqual({ col: 25, row: 99 });
});

test("parseCellAddress parses AA1 correctly", () => {
  expect(parseCellAddress("AA1")).toEqual({ col: 26, row: 0 });
});

test("parseCellAddress throws for invalid input", () => {
  throws(() => parseCellAddress("123"));
  throws(() => parseCellAddress(""));
  throws(() => parseCellAddress("a1")); // lowercase
  throws(() => parseCellAddress("A0"));
  throws(() => parseCellAddress("A01"));
  throws(() => parseCellAddress("CW1")); // column 101, beyond app grid
  throws(() => parseCellAddress("A1001")); // beyond app grid
});

// ---------------------------------------------------------------------------
// formatCellAddress
// ---------------------------------------------------------------------------

test("formatCellAddress formats col=0, row=0 as A1", () => {
  expect(formatCellAddress(0, 0)).toEqual("A1");
});

test("formatCellAddress formats col=25, row=99 as Z100", () => {
  expect(formatCellAddress(25, 99)).toEqual("Z100");
});

test("formatCellAddress formats col=26, row=0 as AA1", () => {
  expect(formatCellAddress(26, 0)).toEqual("AA1");
});

test("parseCellAddress and formatCellAddress are inverses", () => {
  for (const addr of ["A1", "B2", "Z26", "AA1", "AB100"]) {
    const parsed = parseCellAddress(addr);
    expect(formatCellAddress(parsed.col, parsed.row)).toEqual(addr);
  }
});

test("formatCellAddress throws for invalid or out-of-bounds coordinates", () => {
  throws(() => formatCellAddress(-1, 0));
  throws(() => formatCellAddress(0, -1));
  throws(() => formatCellAddress(100, 0));
  throws(() => formatCellAddress(0, 1000));
});

test("parseCellRange normalises valid ranges and rejects oversized ranges", () => {
  expect(parseCellRange("C3:A1")).toEqual({
    startCol: 0,
    startRow: 0,
    endCol: 2,
    endRow: 2,
    cellCount: 9,
  });
  throws(() => parseCellRange("A1:CV1000"));
});

// ---------------------------------------------------------------------------
// getCellRange
// ---------------------------------------------------------------------------

test("getCellRange returns single cell when start equals end", () => {
  const range = getCellRange(0, 0, 0, 0);
  expect(range).toEqual(["A1"]);
});

test("getCellRange returns a row", () => {
  const range = getCellRange(0, 0, 2, 0);
  expect(range).toEqual(["A1", "B1", "C1"]);
});

test("getCellRange returns a column", () => {
  const range = getCellRange(0, 0, 0, 2);
  expect(range).toEqual(["A1", "A2", "A3"]);
});

test("getCellRange returns rectangular range row-major", () => {
  const range = getCellRange(0, 0, 1, 1);
  expect(range).toEqual(["A1", "B1", "A2", "B2"]);
});

test("getCellRange normalises reversed corners", () => {
  const range = getCellRange(1, 1, 0, 0);
  expect(range).toEqual(["A1", "B1", "A2", "B2"]);
});
