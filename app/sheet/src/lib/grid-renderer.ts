/**
 * Server-side spreadsheet grid renderer using node-canvas (npm:canvas).
 *
 * Renders a sheet's cells as a visual grid image with column headers,
 * row numbers, cell borders, and formatted cell values.
 */

import { createCanvas } from "canvas";
import type { CellFormat, Sheet } from "../types/index.ts";
import { columnToLetter, formatCellAddress } from "./cell-utils.ts";

interface RenderOptions {
  width?: number;
  height?: number;
  rows?: number;
  cols?: number;
}

const DEFAULT_COL_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 28;
const HEADER_HEIGHT = 30;
const ROW_NUM_WIDTH = 50;
const DEFAULT_FONT_SIZE = 13;
const HEADER_BG = "#f3f4f6";
const HEADER_TEXT = "#374151";
const GRID_LINE = "#d1d5db";
const CELL_TEXT = "#111827";

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function assertNever(x: never): never {
  throw new Error(`Unhandled text align: ${JSON.stringify(x)}`);
}

/**
 * Render a sheet to a PNG buffer.
 */
export function renderSheetToBuffer(
  sheet: Sheet,
  options?: RenderOptions,
): Uint8Array {
  const numRows = options?.rows ?? 20;
  const numCols = options?.cols ?? 10;
  const imgWidth = options?.width ?? 1200;
  const imgHeight = options?.height ?? 800;

  const canvas = createCanvas(imgWidth, imgHeight);
  const ctx = canvas.getContext("2d");

  // Compute column widths and row heights
  const colWidths: number[] = [];
  for (let c = 0; c < numCols; c++) {
    colWidths.push(sheet.colWidths[c] ?? DEFAULT_COL_WIDTH);
  }
  const rowHeights: number[] = [];
  for (let r = 0; r < numRows; r++) {
    rowHeights.push(sheet.rowHeights[r] ?? DEFAULT_ROW_HEIGHT);
  }

  // Compute total grid dimensions
  const totalGridWidth = ROW_NUM_WIDTH + colWidths.reduce((a, b) => a + b, 0);
  const totalGridHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0);

  // Scale to fit
  const scaleX = Math.min(1, imgWidth / totalGridWidth);
  const scaleY = Math.min(1, imgHeight / totalGridHeight);
  const scale = Math.min(scaleX, scaleY);

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, imgWidth, imgHeight);

  ctx.save();
  ctx.scale(scale, scale);

  // Draw column headers
  drawColumnHeaders(ctx, colWidths, numCols);

  // Draw row numbers
  drawRowNumbers(ctx, rowHeights, numRows);

  // Draw grid lines
  drawGridLines(ctx, colWidths, rowHeights, numCols, numRows);

  // Draw cell values
  drawCells(ctx, sheet, colWidths, rowHeights, numCols, numRows);

  ctx.restore();

  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawColumnHeaders(
  ctx: Ctx,
  colWidths: number[],
  numCols: number,
): void {
  // Header background
  let x = ROW_NUM_WIDTH;
  ctx.fillStyle = HEADER_BG;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  ctx.fillRect(ROW_NUM_WIDTH, 0, totalWidth, HEADER_HEIGHT);

  // Top-left corner
  ctx.fillStyle = HEADER_BG;
  ctx.fillRect(0, 0, ROW_NUM_WIDTH, HEADER_HEIGHT);

  // Header text
  ctx.fillStyle = HEADER_TEXT;
  ctx.font = `bold ${DEFAULT_FONT_SIZE}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  x = ROW_NUM_WIDTH;
  for (let c = 0; c < numCols; c++) {
    const w = colWidths[c];
    ctx.fillText(columnToLetter(c), x + w / 2, HEADER_HEIGHT / 2);
    x += w;
  }

  // Header bottom border
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_HEIGHT);
  ctx.lineTo(ROW_NUM_WIDTH + totalWidth, HEADER_HEIGHT);
  ctx.stroke();
}

function drawRowNumbers(
  ctx: Ctx,
  rowHeights: number[],
  numRows: number,
): void {
  ctx.fillStyle = HEADER_TEXT;
  ctx.font = `bold ${DEFAULT_FONT_SIZE}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  let y = HEADER_HEIGHT;
  for (let r = 0; r < numRows; r++) {
    const h = rowHeights[r];
    // Row number background
    ctx.fillStyle = HEADER_BG;
    ctx.fillRect(0, y, ROW_NUM_WIDTH, h);

    // Row number text
    ctx.fillStyle = HEADER_TEXT;
    ctx.fillText(String(r + 1), ROW_NUM_WIDTH / 2, y + h / 2);

    y += h;
  }

  // Right border for row number column
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ROW_NUM_WIDTH, 0);
  ctx.lineTo(
    ROW_NUM_WIDTH,
    HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0),
  );
  ctx.stroke();
}

function drawGridLines(
  ctx: Ctx,
  colWidths: number[],
  rowHeights: number[],
  numCols: number,
  numRows: number,
): void {
  const totalWidth = ROW_NUM_WIDTH + colWidths.reduce((a, b) => a + b, 0);
  const totalHeight = HEADER_HEIGHT + rowHeights.reduce((a, b) => a + b, 0);

  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 0.5;

  // Horizontal lines
  let y = HEADER_HEIGHT;
  for (let r = 0; r < numRows; r++) {
    y += rowHeights[r];
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(totalWidth, y);
    ctx.stroke();
  }

  // Vertical lines
  let x = ROW_NUM_WIDTH;
  for (let c = 0; c < numCols; c++) {
    x += colWidths[c];
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, totalHeight);
    ctx.stroke();
  }
}

function drawCells(
  ctx: Ctx,
  sheet: Sheet,
  colWidths: number[],
  rowHeights: number[],
  numCols: number,
  numRows: number,
): void {
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const addr = formatCellAddress(c, r);
      const cellData = sheet.cells[addr];
      if (!cellData) continue;

      const displayValue = cellData.computed ?? cellData.value;
      if (!displayValue) continue;

      // Compute cell position
      let x = ROW_NUM_WIDTH;
      for (let i = 0; i < c; i++) x += colWidths[i];
      let y = HEADER_HEIGHT;
      for (let i = 0; i < r; i++) y += rowHeights[i];
      const w = colWidths[c];
      const h = rowHeights[r];

      // Apply cell background
      const fmt = cellData.format;
      if (fmt?.bgColor) {
        ctx.fillStyle = fmt.bgColor;
        ctx.fillRect(x, y, w, h);
      }

      // Draw cell text
      drawCellText(ctx, displayValue, x, y, w, h, fmt);
    }
  }
}

function drawCellText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  format?: CellFormat,
): void {
  const fontSize = format?.fontSize ?? DEFAULT_FONT_SIZE;
  const bold = format?.bold ? "bold " : "";
  const italic = format?.italic ? "italic " : "";
  const align = format?.textAlign ?? "left";

  ctx.font = `${italic}${bold}${fontSize}px sans-serif`;
  ctx.fillStyle = format?.textColor ?? CELL_TEXT;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;

  const padding = 4;
  let textX: number;
  switch (align) {
    case "left":
      textX = x + padding;
      break;
    case "center":
      textX = x + width / 2;
      break;
    case "right":
      textX = x + width - padding;
      break;
    default:
      assertNever(align);
  }

  // Clip to cell bounds
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillText(text, textX, y + height / 2);

  // Underline
  if (format?.underline) {
    const metrics = ctx.measureText(text);
    const underlineY = y + height / 2 + fontSize / 2 + 1;
    ctx.strokeStyle = format.textColor ?? CELL_TEXT;
    ctx.lineWidth = 1;
    ctx.beginPath();

    let lineStartX: number;
    switch (align) {
      case "left":
        lineStartX = textX;
        break;
      case "center":
        lineStartX = textX - metrics.width / 2;
        break;
      case "right":
        lineStartX = textX - metrics.width;
        break;
      default:
        assertNever(align);
    }

    ctx.moveTo(lineStartX, underlineY);
    ctx.lineTo(lineStartX + metrics.width, underlineY);
    ctx.stroke();
  }

  ctx.restore();
}
