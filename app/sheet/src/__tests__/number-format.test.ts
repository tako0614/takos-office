import { expect, test } from "bun:test";
import { applyNumberFormat } from "../lib/number-format.ts";

test("returns the raw value when there is no format", () => {
  expect(applyNumberFormat("1234.5", undefined)).toBe("1234.5");
  expect(applyNumberFormat("", "#,##0.00")).toBe("");
});

test("thousands + fixed decimals", () => {
  expect(applyNumberFormat("1234567.5", "#,##0.00")).toBe("1,234,567.50");
  expect(applyNumberFormat("-1234", "#,##0")).toBe("-1,234");
});

test("percent scales by 100 and appends %", () => {
  expect(applyNumberFormat("0.3333333333", "0%")).toBe("33%");
  expect(applyNumberFormat("0.5", "0.0%")).toBe("50.0%");
});

test("currency prefix", () => {
  expect(applyNumberFormat("1234.5", "$#,##0.00")).toBe("$1,234.50");
});

test("date serial is rendered via the format", () => {
  // 2026-06-21 as a HyperFormula serial (nullDate 1899-12-30).
  const serial = Math.round(
    (Date.UTC(2026, 5, 21) - Date.UTC(1899, 11, 30)) / 86_400_000,
  );
  expect(applyNumberFormat(String(serial), "yyyy-mm-dd")).toBe("2026-06-21");
});

test("ISO date string is reformatted", () => {
  expect(applyNumberFormat("2026-01-05", "yyyy/mm/dd")).toBe("2026/01/05");
});

test("independent Excel month-name formats retain escaped literal spaces", () => {
  expect(applyNumberFormat("41287", "mmmm\\ d\\ yyyy")).toBe("January 13 2013");
  expect(applyNumberFormat("41287", '"On "ddd, mmm d, yyyy')).toBe("On Sun, Jan 13, 2013");
});

test("date/time tokens distinguish minutes from months and retain fractional serial time", () => {
  expect(applyNumberFormat("41287.5", "yyyy-mm-dd hh:mm:ss")).toBe("2013-01-13 12:00:00");
});

test("non-numeric values pass through unformatted", () => {
  expect(applyNumberFormat("hello", "#,##0.00")).toBe("hello");
});
