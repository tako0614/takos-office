export const MAX_SPREADSHEET_COLUMNS = 100;
export const MAX_SPREADSHEET_ROWS = 1_000;
export const MAX_RANGE_CELLS = 10_000;

/**
 * Convert a 0-based column index to a letter (A, B, ..., Z, AA, AB, ...)
 */
export function columnToLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }

  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/**
 * Convert a column letter (A, B, ..., Z, AA, AB, ...) to a 0-based index
 */
export function letterToColumn(letter: string): number {
  if (!/^[A-Z]+$/.test(letter)) {
    throw new Error(`Invalid column letter: ${letter}`);
  }

  let col = 0;
  for (let i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col - 1;
}

function assertCellBounds(col: number, row: number): void {
  if (
    col < 0 ||
    col >= MAX_SPREADSHEET_COLUMNS ||
    row < 0 ||
    row >= MAX_SPREADSHEET_ROWS
  ) {
    throw new Error(
      `Cell address out of bounds: ${formatCellAddressUnchecked(col, row)}`,
    );
  }
}

function formatCellAddressUnchecked(col: number, row: number): string {
  return `${columnToLetter(col)}${row + 1}`;
}

/**
 * Parse a cell address like "A1" into { col, row } (0-based)
 */
export function parseCellAddress(addr: string): { col: number; row: number } {
  const match = addr.match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) {
    throw new Error(`Invalid cell address: ${addr}`);
  }
  const parsed = {
    col: letterToColumn(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
  assertCellBounds(parsed.col, parsed.row);
  return parsed;
}

/**
 * Format a 0-based col and row into a cell address like "A1"
 */
export function formatCellAddress(col: number, row: number): string {
  if (!Number.isInteger(col) || !Number.isInteger(row)) {
    throw new Error(`Invalid cell coordinates: ${col}, ${row}`);
  }
  assertCellBounds(col, row);
  return formatCellAddressUnchecked(col, row);
}

/**
 * Parse a range string like "A1:C10" into normalized 0-based bounds.
 */
export function parseCellRange(range: string): {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
  cellCount: number;
} {
  const parts = range.split(":");
  if (parts.length !== 2) throw new Error(`Invalid range: ${range}`);

  const start = parseCellAddress(parts[0]);
  const end = parseCellAddress(parts[1]);
  const startCol = Math.min(start.col, end.col);
  const startRow = Math.min(start.row, end.row);
  const endCol = Math.max(start.col, end.col);
  const endRow = Math.max(start.row, end.row);
  const cellCount = (endCol - startCol + 1) * (endRow - startRow + 1);

  if (cellCount > MAX_RANGE_CELLS) {
    throw new Error(`Range too large: ${range}`);
  }

  return { startCol, startRow, endCol, endRow, cellCount };
}

export function isValidCellAddress(addr: string): boolean {
  try {
    parseCellAddress(addr);
    return true;
  } catch {
    return false;
  }
}

export function isValidCellRange(range: string): boolean {
  try {
    parseCellRange(range);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the range of cell addresses between two corners (inclusive)
 */
export function getCellRange(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
): string[] {
  const addresses: string[] = [];
  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  assertCellBounds(minCol, minRow);
  assertCellBounds(maxCol, maxRow);

  const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
  if (cellCount > MAX_RANGE_CELLS) {
    throw new Error(`Range too large: ${cellCount} cells`);
  }

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      addresses.push(formatCellAddress(c, r));
    }
  }
  return addresses;
}
