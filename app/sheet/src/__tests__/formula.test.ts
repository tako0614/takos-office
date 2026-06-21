import { expect, test } from "bun:test";
import {
  evaluateSheet,
  formatHfResult,
  looksNumeric,
} from "../lib/formula.ts";
import type { Sheet } from "../types/index.ts";

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

test("formatHfResult handles primitives, booleans and error objects", () => {
  expect(formatHfResult(null)).toBe("");
  expect(formatHfResult(42)).toBe("42");
  expect(formatHfResult(true)).toBe("TRUE");
  expect(formatHfResult({ value: "#REF!", type: "REF" })).toBe("#REF!");
  expect(formatHfResult({ type: "NAME" })).toBe("#NAME!");
});
