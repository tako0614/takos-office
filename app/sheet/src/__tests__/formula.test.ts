import { expect, test } from "bun:test";
import {
  evaluateSheet,
  formatHfResult,
  looksNumeric,
  setCellValue,
  shiftSheetStructure,
  renameSheetReferences,
  recalculateWorkbook,
} from "../lib/formula.ts";
import type { Sheet } from "../types/index.ts";

test("workbook recalculation refreshes transitive results independent of tab order without mutating its input", () => {
  const input: Sheet = { id: "input", name: "Input", cells: { A1: { value: "20" } }, colWidths: { 0: 180 }, rowHeights: {} };
  const middle: Sheet = { id: "middle", name: "Middle", cells: { A1: { value: "=Input!A1+1", computed: "11" } }, colWidths: {}, rowHeights: {} };
  const last: Sheet = { id: "last", name: "Last", cells: { A1: { value: "=Middle!A1*2", computed: "22" } }, colWidths: {}, rowHeights: {} };
  const original = structuredClone([last, middle, input]);
  const result = recalculateWorkbook([last, middle, input]);
  expect(result[0].cells.A1).toMatchObject({ value: "=Middle!A1*2", computed: "42", computedType: "number" });
  expect(result[1].cells.A1.computed).toBe("21");
  expect(result[2].colWidths).toEqual(input.colWidths);
  expect([last, middle, input]).toEqual(original);
});

test("workbook recalculation preserves typed literals across sheet dependencies", () => {
  const input: Sheet = { id: "input", name: "Input", cells: {
    A1: { value: "007", valueType: "text" }, B1: { value: "=1+1", valueType: "text" }, C1: { value: "TRUE", valueType: "boolean" },
  }, colWidths: {}, rowHeights: {} };
  const dependent: Sheet = { id: "dependent", name: "Dependent", cells: {
    A1: { value: "=SUM(Input!A1)" }, B1: { value: "=Input!B1" }, C1: { value: "=IF(Input!C1,1,2)" },
  }, colWidths: {}, rowHeights: {} };
  const result = recalculateWorkbook([input, dependent]);
  expect(result[1].cells.A1.computed).toBe("0");
  expect(result[1].cells.B1).toMatchObject({ computed: "=1+1", computedType: "text" });
  expect(result[1].cells.C1.computed).toBe("1");
  expect(result[0].cells.A1.valueType).toBe("text");
});

test("input-save recalculation retains historical file/stale provenance while explicit sheet evaluation may refresh it", () => {
  const input: Sheet = { id: "input", name: "Input", cells: { A1: { value: "20" } }, colWidths: {}, rowHeights: {} };
  const dependent: Sheet = { id: "dependent", name: "Dependent", cells: {
    A1: { value: "=Input!A1+1", computed: "11", computedSource: "file" },
    B1: { value: "=Input!A1+1", computed: "11", computedSource: "stale" },
    C1: { value: "=_xlfn.FUTUREFUNC(Input!A1)", computed: "42", computedSource: "stale" },
    D1: { value: "=1/(Input!A1-20)", computed: "-0.1" },
  }, colWidths: {}, rowHeights: {} };
  const result = recalculateWorkbook([input, dependent]);
  for (const address of ["A1", "B1", "C1"]) expect(result[1].cells[address]).toEqual(dependent.cells[address]);
  expect(result[1].cells.D1).toMatchObject({ computed: "#DIV/0!", computedType: "error" });
  const explicit = evaluateSheet(result[1], result, { preserveImportedCache: true });
  expect(explicit.B1.computed).toBe("21");
  expect(explicit.B1.computedSource).toBeUndefined();
  expect(explicit.A1.computedSource).toBe("file");
  expect(explicit.C1.computedSource).toBe("stale");
});

test("sheet rename rewrites references and quotes names without rewriting literals or metadata", () => {
  const first: Sheet = { id: "first", name: "Sheet1", cells: { A1: { value: "10", format: { bold: true } } }, colWidths: { 0: 180 }, rowHeights: { 0: 40 } };
  const second: Sheet = { id: "second", name: "Sheet2", cells: {
    A1: { value: "=Sheet1!$A$1+Sheet1!A1" },
    A2: { value: '=\"Sheet1!A1\"' },
    A3: { value: "=Sheet1!A1", valueType: "text" },
    A4: { value: "Sheet1!A1" },
  }, colWidths: {}, rowHeights: {} };
  const original = structuredClone([first, second]);
  const renamed = renameSheetReferences([first, second], first.id, "Bob's inputs");
  expect(renamed[0].name).toBe("Bob's inputs");
  expect(renamed[1].cells.A1.value).toBe("='Bob''s inputs'!$A$1+'Bob''s inputs'!A1");
  expect(renamed[1].cells.A1.computed).toBe("20");
  expect(renamed[1].cells.A2).toMatchObject({ value: '=\"Sheet1!A1\"', computed: "Sheet1!A1" });
  expect(renamed[1].cells.A3).toMatchObject({ value: "=Sheet1!A1", valueType: "text" });
  expect(renamed[1].cells.A4.value).toBe("Sheet1!A1");
  expect(renamed[0]).toMatchObject({ id: first.id, colWidths: first.colWidths, rowHeights: first.rowHeights, cells: { A1: { format: { bold: true } } } });
  expect([first, second]).toEqual(original);
});

test("refused duplicate sheet name cannot mutate any workbook input", () => {
  const first: Sheet = { id: "first", name: "First", cells: { A1: { value: "10" } }, colWidths: {}, rowHeights: {} };
  const second: Sheet = { ...structuredClone(first), id: "second", name: "Second" };
  const original = structuredClone([first, second]);
  expect(() => renameSheetReferences([first, second], first.id, "Second")).toThrow();
  expect([first, second]).toEqual(original);
});

function sheetWith(cells: Record<string, string>): Sheet {
  return {
    id: "s1",
    name: "Sheet1",
    cells: Object.fromEntries(
      Object.entries(cells).map(([addr, value]) => [addr, { value }]),
    ),
    colWidths: {},
    rowHeights: {},
  };
}

test("imported text stays text in formulas, including numeric-looking and formula-looking literals", () => {
  const sheet = sheetWith({ A1: "123", A2: "2", B1: "=SUM(A1:A2)", C1: "=1+1" });
  sheet.cells.A1.valueType = "text";
  sheet.cells.A2.valueType = "number";
  sheet.cells.C1.valueType = "text";
  const cells = evaluateSheet(sheet);
  expect(cells.B1.computed).toBe("2");
  expect(cells.C1.computed).toBe("=1+1");
  const edited = setCellValue(sheet, "A1", "7");
  expect(edited.A1.valueType).toBeUndefined();
  expect(edited.B1.computed).toBe("9");
});

test("imported boolean/error literals and recalculated formula cache types retain their meaning", () => {
  const sheet = sheetWith({ A1: "TRUE", A2: "#DIV/0!", B1: "=IF(A1,5,9)", B2: "=SUM(A2:A2)", C1: '=\"123\"' });
  sheet.cells.A1.valueType = "boolean";
  sheet.cells.A2.valueType = "error";
  sheet.cells.C1.computedType = "number";
  const cells = evaluateSheet(sheet);
  expect(cells.B1.computed).toBe("5");
  expect(cells.B2.computed).toBe("#DIV/0!");
  expect(cells.C1.computed).toBe("123");
  expect(cells.C1.computedType).toBe("text");
});

test("inserting rows keeps imported literal types instead of silently turning text into numbers or formulas", () => {
  const sheet = sheetWith({ A1: "123", A2: "2", B1: "=SUM(A1:A2)", C1: "=1+1" });
  sheet.cells.A1.valueType = "text";
  sheet.cells.C1.valueType = "text";
  const moved = { ...sheet, cells: shiftSheetStructure(sheet, "insertRows", 0, 1).get(sheet.id)! };
  const cells = evaluateSheet(moved);
  expect(cells.A2.valueType).toBe("text");
  expect(cells.B2.computed).toBe("2");
  expect(cells.C2.valueType).toBe("text");
  expect(cells.C2.computed).toBe("=1+1");
});

test("opening an imported workbook preserves its saved formula cache until an explicit value edit recalculates", () => {
  const sheet = sheetWith({ A1: "1", B1: "=_xlfn.FUTUREFUNC(A1)" });
  sheet.cells.B1 = { ...sheet.cells.B1, computed: "42", computedType: "number", computedSource: "file" };
  const loaded = evaluateSheet(sheet, [sheet], { preserveImportedCache: true });
  expect(loaded.B1.computed).toBe("42");
  expect(loaded.B1.computedType).toBe("number");
  expect(loaded.B1.computedSource).toBe("file");
  const edited = setCellValue({ ...sheet, cells: loaded }, "A1", "2");
  // A local engine failure cannot turn an imported historical result into a fresh cache.
  expect(edited.B1.computed).toBe("42");
  expect(edited.B1.computedSource).toBe("stale");
});

test("looksNumeric only accepts canonical numbers", () => {
  for (const ok of ["5", "5.5", "-3", "0", "1000", "  5  "]) {
    expect(looksNumeric(ok)).toBe(true);
  }
  // Leading zeros, hex, scientific, signed-plus, infinities must NOT coerce.
  for (const no of ["007", "0x1F", "1e3", "+15551234", "Infinity", "NaN", ""]) {
    expect(looksNumeric(no)).toBe(false);
  }
});

test("literal cells display verbatim — no numeric coercion (data loss fix)", () => {
  const cells = evaluateSheet(
    sheetWith({ A1: "007", A2: "+15551234", A3: "0x1F", A4: "hello" }),
  );
  expect(cells["A1"].computed).toBe("007");
  expect(cells["A2"].computed).toBe("+15551234");
  expect(cells["A3"].computed).toBe("0x1F");
  expect(cells["A4"].computed).toBe("hello");
});

test("formulas still evaluate against numeric literals", () => {
  const cells = evaluateSheet(sheetWith({ A1: "5", B1: "=A1+1" }));
  expect(cells["B1"].computed).toBe("6");
});

test("booleans render uppercase TRUE/FALSE", () => {
  const cells = evaluateSheet(sheetWith({ A1: "=1>0", A2: "=1>2" }));
  expect(cells["A1"].computed).toBe("TRUE");
  expect(cells["A2"].computed).toBe("FALSE");
});

test("formula errors surface the real Excel token, not a generic #ERROR!", () => {
  const cells = evaluateSheet(sheetWith({ A1: "=1/0" }));
  expect(cells["A1"].computed).toBe("#DIV/0!");
});

test("cross-sheet references resolve when the workbook is passed", () => {
  const sheet1: Sheet = {
    id: "s1",
    name: "Sheet1",
    cells: { A1: { value: "=Sheet2!A1+1" } },
    colWidths: {},
    rowHeights: {},
  };
  const sheet2: Sheet = {
    id: "s2",
    name: "Sheet2",
    cells: { A1: { value: "41" } },
    colWidths: {},
    rowHeights: {},
  };
  const cells = evaluateSheet(sheet1, [sheet1, sheet2]);
  expect(cells["A1"].computed).toBe("42");
});

test("formatHfResult handles primitives, booleans and error objects", () => {
  expect(formatHfResult(null)).toBe("");
  expect(formatHfResult(42)).toBe("42");
  expect(formatHfResult(true)).toBe("TRUE");
  expect(formatHfResult({ value: "#REF!", type: "REF" })).toBe("#REF!");
  expect(formatHfResult({ type: "NAME" })).toBe("#NAME!");
});
