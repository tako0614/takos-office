import type { CellData, CellFormat, ConditionalRule } from "../types/index.ts";
import { formatCellAddress, parseCellAddress } from "./cell-utils.ts";

function assertNever(x: never): never {
  throw new Error(`Unhandled conditional rule type: ${JSON.stringify(x)}`);
}

/**
 * Parse a range string like "A1:C10" into its start/end column and row.
 */
function parseRange(range: string): {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
} {
  const parts = range.split(":");
  if (parts.length !== 2) throw new Error(`Invalid range: ${range}`);
  const start = parseCellAddress(parts[0]);
  const end = parseCellAddress(parts[1]);
  return {
    startCol: Math.min(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endCol: Math.max(start.col, end.col),
    endRow: Math.max(start.row, end.row),
  };
}

/**
 * Check whether a single cell satisfies a conditional rule's condition.
 */
function matchesCondition(
  cell: CellData | undefined,
  condition: ConditionalRule["condition"],
): boolean {
  const raw = cell?.computed ?? cell?.value ?? "";
  const num = raw === "" ? NaN : Number(raw);

  switch (condition.type) {
    case "isEmpty":
      return raw === "";
    case "isNotEmpty":
      return raw !== "";
    case "textContains":
      return raw.toLowerCase().includes(
        (condition.values[0] ?? "").toLowerCase(),
      );
    case "equal":
      if (!isNaN(num) && !isNaN(Number(condition.values[0]))) {
        return num === Number(condition.values[0]);
      }
      return raw === (condition.values[0] ?? "");
    case "notEqual":
      if (!isNaN(num) && !isNaN(Number(condition.values[0]))) {
        return num !== Number(condition.values[0]);
      }
      return raw !== (condition.values[0] ?? "");
    case "greaterThan":
      return !isNaN(num) && num > Number(condition.values[0] ?? 0);
    case "lessThan":
      return !isNaN(num) && num < Number(condition.values[0] ?? 0);
    case "between": {
      const lo = Number(condition.values[0] ?? 0);
      const hi = Number(condition.values[1] ?? 0);
      return !isNaN(num) && num >= lo && num <= hi;
    }
    default:
      return assertNever(condition.type);
  }
}

/**
 * Evaluate all conditional formatting rules against a set of cells.
 *
 * Returns a map of cellAddress -> CellFormat for every cell that matched at
 * least one rule.  When multiple rules apply to the same cell the later rule
 * in the array wins (properties are merged, later overrides earlier).
 */
export function evaluateConditionalRules(
  rules: ConditionalRule[],
  cells: Record<string, CellData>,
): Record<string, CellFormat> {
  const result: Record<string, CellFormat> = {};

  for (const rule of rules) {
    let bounds: ReturnType<typeof parseRange>;
    try {
      bounds = parseRange(rule.range);
    } catch {
      continue; // skip malformed range
    }

    for (let r = bounds.startRow; r <= bounds.endRow; r++) {
      for (let c = bounds.startCol; c <= bounds.endCol; c++) {
        const addr = formatCellAddress(c, r);
        if (matchesCondition(cells[addr], rule.condition)) {
          result[addr] = { ...(result[addr] ?? {}), ...rule.format };
        }
      }
    }
  }

  return result;
}
