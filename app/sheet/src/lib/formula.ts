import { HyperFormula } from "hyperformula";
import type { CellData, Sheet } from "../types/index.ts";
import { columnToLetter, parseCellAddress } from "./cell-utils.ts";

let hfInstance: HyperFormula | null = null;

/**
 * Get or create the HyperFormula engine instance
 */
export function getEngine(): HyperFormula {
  if (!hfInstance) {
    hfInstance = HyperFormula.buildEmpty({
      licenseKey: "gpl-v3",
    });
  }
  return hfInstance;
}

/**
 * Sync a Sheet's cells into HyperFormula for evaluation
 */
export function syncSheetToEngine(sheet: Sheet): number {
  const hf = getEngine();

  // Remove all existing sheets
  const sheetNames = hf.getSheetNames();
  for (const name of sheetNames) {
    const id = hf.getSheetId(name);
    if (id !== undefined) {
      hf.removeSheet(id);
    }
  }

  // Build a 2D array from cells
  const maxRow = 1000;
  const maxCol = 100;

  // Find the actual bounds of data
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

  // Create sheet data (at least 1x1)
  const rows = Math.min(Math.max(dataMaxRow + 1, 1), maxRow);
  const cols = Math.min(Math.max(dataMaxCol + 1, 1), maxCol);
  const data: (string | number | null)[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: (string | number | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const addr = `${columnToLetter(c)}${r + 1}`;
      const cell = sheet.cells[addr];
      if (cell) {
        const v = cell.value;
        if (v.startsWith("=")) {
          row.push(v);
        } else if (v !== "" && !isNaN(Number(v))) {
          row.push(Number(v));
        } else {
          row.push(v || null);
        }
      } else {
        row.push(null);
      }
    }
    data.push(row);
  }

  const sheetName = hf.addSheet(sheet.name);
  const sheetId = hf.getSheetId(sheetName);
  if (sheetId === undefined) {
    throw new Error(`Failed to create HyperFormula sheet: ${sheet.name}`);
  }
  hf.setSheetContent(sheetId, data);
  return sheetId;
}

/**
 * Evaluate all formulas in a sheet, returning updated cells
 */
export function evaluateSheet(
  sheet: Sheet,
): Record<string, CellData> {
  const hf = getEngine();
  const sheetId = syncSheetToEngine(sheet);
  const updatedCells: Record<string, CellData> = { ...sheet.cells };

  for (
    const [addr, cell] of Object.entries(sheet.cells) as [string, CellData][]
  ) {
    if (!cell.value) {
      updatedCells[addr] = { ...cell, computed: "" };
      continue;
    }

    try {
      const { col, row } = parseCellAddress(addr);
      const result = hf.getCellValue({
        sheet: sheetId,
        row,
        col,
      });

      if (result !== null && result !== undefined) {
        if (typeof result === "object" && "type" in result) {
          // HyperFormula error object
          updatedCells[addr] = { ...cell, computed: "#ERROR!" };
        } else {
          updatedCells[addr] = {
            ...cell,
            computed: String(result),
          };
        }
      } else {
        updatedCells[addr] = { ...cell, computed: cell.value };
      }
    } catch {
      updatedCells[addr] = {
        ...cell,
        computed: cell.value.startsWith("=") ? "#ERROR!" : cell.value,
      };
    }
  }

  return updatedCells;
}

/**
 * Set a cell value and re-evaluate
 */
export function setCellValue(
  sheet: Sheet,
  address: string,
  value: string,
): Record<string, CellData> {
  const updatedCells = { ...sheet.cells };
  const existing = updatedCells[address];
  updatedCells[address] = {
    ...existing,
    value,
    format: existing?.format,
  };

  const updatedSheet = { ...sheet, cells: updatedCells };
  return evaluateSheet(updatedSheet);
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
