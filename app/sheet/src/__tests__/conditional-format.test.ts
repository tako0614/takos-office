import { expect, test } from "bun:test";
import { evaluateConditionalRules } from "../lib/conditional-format.ts";
import type { CellData, ConditionalRule } from "../types/index.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(
  overrides: Partial<ConditionalRule> & {
    condition: ConditionalRule["condition"];
  },
): ConditionalRule {
  return {
    id: overrides.id ?? "rule-1",
    range: overrides.range ?? "A1:A1",
    condition: overrides.condition,
    format: overrides.format ?? { bold: true },
  };
}

function makeCells(
  entries: Record<string, string>,
): Record<string, CellData> {
  const cells: Record<string, CellData> = {};
  for (const [addr, value] of Object.entries(entries)) {
    cells[addr] = { value };
  }
  return cells;
}

// ---------------------------------------------------------------------------
// greaterThan
// ---------------------------------------------------------------------------

test("matchesCondition greaterThan - matches", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "greaterThan", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "10" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition greaterThan - does not match", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "greaterThan", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "3" }));
  expect(result["A1"]).toBeUndefined();
});

test("matchesCondition greaterThan - non-numeric value", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "greaterThan", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "abc" }));
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// lessThan
// ---------------------------------------------------------------------------

test("matchesCondition lessThan - matches", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "lessThan", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "2" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition lessThan - does not match", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "lessThan", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "10" }));
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// equal
// ---------------------------------------------------------------------------

test("matchesCondition equal - numeric match", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "equal", values: ["42"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "42" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition equal - string match", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "equal", values: ["hello"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "hello" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition equal - no match", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "equal", values: ["42"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "99" }));
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// notEqual
// ---------------------------------------------------------------------------

test("matchesCondition notEqual - matches", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "notEqual", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "10" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition notEqual - does not match (equal)", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "notEqual", values: ["5"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "5" }));
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// between
// ---------------------------------------------------------------------------

test("matchesCondition between - inside range", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "between", values: ["1", "10"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "5" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition between - on boundary", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "between", values: ["1", "10"] },
    }),
  ];
  const lo = evaluateConditionalRules(rules, makeCells({ A1: "1" }));
  expect(lo["A1"]).toEqual({ bold: true });
  const hi = evaluateConditionalRules(rules, makeCells({ A1: "10" }));
  expect(hi["A1"]).toEqual({ bold: true });
});

test("matchesCondition between - outside range", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "between", values: ["1", "10"] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "15" }));
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// textContains
// ---------------------------------------------------------------------------

test("matchesCondition textContains - matches", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "textContains", values: ["ello"] },
    }),
  ];
  const result = evaluateConditionalRules(
    rules,
    makeCells({ A1: "Hello world" }),
  );
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition textContains - case insensitive", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "textContains", values: ["HELLO"] },
    }),
  ];
  const result = evaluateConditionalRules(
    rules,
    makeCells({ A1: "hello world" }),
  );
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition textContains - no match", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "textContains", values: ["xyz"] },
    }),
  ];
  const result = evaluateConditionalRules(
    rules,
    makeCells({ A1: "Hello world" }),
  );
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// isEmpty / isNotEmpty
// ---------------------------------------------------------------------------

test("matchesCondition isEmpty - empty cell", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "isEmpty", values: [] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition isEmpty - non-empty cell", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "isEmpty", values: [] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "x" }));
  expect(result["A1"]).toBeUndefined();
});

test("matchesCondition isEmpty - missing cell treated as empty", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "isEmpty", values: [] },
    }),
  ];
  // A1 not in cells at all
  const result = evaluateConditionalRules(rules, {});
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition isNotEmpty - non-empty cell", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "isNotEmpty", values: [] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "x" }));
  expect(result["A1"]).toEqual({ bold: true });
});

test("matchesCondition isNotEmpty - empty cell", () => {
  const rules = [
    makeRule({
      range: "A1:A1",
      condition: { type: "isNotEmpty", values: [] },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "" }));
  expect(result["A1"]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// evaluateConditionalRules - multi-cell range
// ---------------------------------------------------------------------------

test("evaluateConditionalRules applies to all cells in range", () => {
  const rules = [
    makeRule({
      range: "A1:C1",
      condition: { type: "greaterThan", values: ["0"] },
      format: { bgColor: "red" },
    }),
  ];
  const cells = makeCells({ A1: "1", B1: "2", C1: "0" });
  const result = evaluateConditionalRules(rules, cells);
  expect(result["A1"]).toEqual({ bgColor: "red" });
  expect(result["B1"]).toEqual({ bgColor: "red" });
  expect(result["C1"]).toBeUndefined(); // 0 is not > 0
});

// ---------------------------------------------------------------------------
// evaluateConditionalRules - multiple rules
// ---------------------------------------------------------------------------

test("evaluateConditionalRules merges formats from multiple rules", () => {
  const rules = [
    makeRule({
      id: "r1",
      range: "A1:A1",
      condition: { type: "greaterThan", values: ["0"] },
      format: { bold: true },
    }),
    makeRule({
      id: "r2",
      range: "A1:A1",
      condition: { type: "lessThan", values: ["100"] },
      format: { italic: true },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "50" }));
  expect(result["A1"]).toEqual({ bold: true, italic: true });
});

test("evaluateConditionalRules later rule overrides earlier for same property", () => {
  const rules = [
    makeRule({
      id: "r1",
      range: "A1:A1",
      condition: { type: "greaterThan", values: ["0"] },
      format: { bgColor: "red" },
    }),
    makeRule({
      id: "r2",
      range: "A1:A1",
      condition: { type: "greaterThan", values: ["0"] },
      format: { bgColor: "blue" },
    }),
  ];
  const result = evaluateConditionalRules(rules, makeCells({ A1: "50" }));
  expect(result["A1"]?.bgColor).toEqual("blue");
});

// ---------------------------------------------------------------------------
// evaluateConditionalRules - no matches
// ---------------------------------------------------------------------------

test("evaluateConditionalRules returns empty when no cells match", () => {
  const rules = [
    makeRule({
      range: "A1:B2",
      condition: { type: "greaterThan", values: ["999"] },
    }),
  ];
  const cells = makeCells({ A1: "1", B1: "2", A2: "3", B2: "4" });
  const result = evaluateConditionalRules(rules, cells);
  expect(result).toEqual({});
});

// ---------------------------------------------------------------------------
// evaluateConditionalRules - malformed range is skipped
// ---------------------------------------------------------------------------

test("evaluateConditionalRules skips rule with malformed range", () => {
  const rules = [
    makeRule({
      range: "INVALID",
      condition: { type: "isEmpty", values: [] },
    }),
  ];
  const result = evaluateConditionalRules(rules, {});
  expect(result).toEqual({});
});
