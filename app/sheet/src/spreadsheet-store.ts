/**
 * SpreadsheetStore backed by the Takos product storage API.
 *
 * Each spreadsheet is stored under a `/takos-excel/` folder:
 *   - File name: `{id}.takossheet`
 *   - Content: full Spreadsheet object serialised as JSON
 *
 * Reads always go to the backing storage API, which is the single source of
 * truth. The in-process Map only memoizes the spreadsheet.id -> fileId mapping
 * and the working copy loaded for the current operation; it is never used as
 * an authoritative read cache, so writes by other replicas/isolates or
 * external Takos-side changes are reflected on the next read instead of being
 * masked until the process restarts.
 */
import type {
  CellAddress,
  CellFormat,
  ConditionalRule,
  Sheet,
  Spreadsheet,
} from "./types/index.ts";
import {
  computeUsedRange,
  formatCellAddress,
  letterToColumn,
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_ROWS,
  parseCellAddress,
} from "./lib/cell-utils.ts";
import {
  evaluateFormula,
  evaluateSheet,
  setCellValue,
  shiftSheetStructure,
  type StructuralOp,
} from "./lib/formula.ts";
import { sortRangeRows } from "./lib/sheet-ops.ts";
import { parseCsv } from "./lib/csv-parser.ts";
import type { TakosStorageClient } from "../../shared/lib/takos-storage.ts";

const FOLDER_NAME = "takos-excel";
const FILE_EXTENSION = ".takossheet";
const MIME_TYPE = "application/vnd.takos.excel+json";

// ---------------------------------------------------------------------------
// SpreadsheetStore
// ---------------------------------------------------------------------------

export class SpreadsheetStore {
  private client: TakosStorageClient;
  /**
   * spreadsheet.id -> fileId memo, populated while reading and updated on
   * writes. NOT an authoritative read cache: reads re-fetch from storage.
   */
  private fileIds = new Map<string, string>();
  /**
   * Working copy loaded by getSpreadsheet() for the current operation. A
   * mutation calls getSpreadsheet() (fresh from storage), mutates the object,
   * then persist() writes that same object back. Keyed by id; transient.
   */
  private working = new Map<string, { ss: Spreadsheet; fileId: string }>();
  private folderId: string | null = null;

  constructor(client: TakosStorageClient) {
    this.client = client;
  }

  private fileIdFor(idOrFileId: string): string | undefined {
    if (this.fileIds.has(idOrFileId)) return this.fileIds.get(idOrFileId);
    for (const fileId of this.fileIds.values()) {
      if (fileId === idOrFileId) return fileId;
    }
    return undefined;
  }

  private isSupportedFile(file: { name: string; mimeType?: string | null }) {
    return file.name.endsWith(FILE_EXTENSION);
  }

  private async loadFile(fileId: string): Promise<
    { ss: Spreadsheet; fileId: string } | undefined
  > {
    const file = await this.client.get(fileId);
    if (!file || file.type !== "file" || !this.isSupportedFile(file)) {
      return undefined;
    }
    const raw = await this.client.getContent(file.id);
    const ss = JSON.parse(raw) as Spreadsheet;
    this.fileIds.set(ss.id, file.id);
    return { ss, fileId: file.id };
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Ensure the app folder exists and cache its id. Folder structure is stable,
   * so it is the only thing memoized for the process lifetime; spreadsheet
   * content is always re-read from storage by the read methods.
   */
  private async ensureFolder(): Promise<void> {
    if (this.folderId) return;
    const files = await this.client.list();
    const folder = files.find(
      (f) => f.type === "folder" && f.name === FOLDER_NAME,
    );
    if (folder) {
      this.folderId = folder.id;
    } else {
      const created = await this.client.createFolder(FOLDER_NAME);
      this.folderId = created.id;
    }
  }

  /** Re-read every spreadsheet in the folder from storage. */
  private async loadAll(): Promise<{ ss: Spreadsheet; fileId: string }[]> {
    await this.ensureFolder();
    const allFiles = await this.client.list(FOLDER_NAME);
    const entries: { ss: Spreadsheet; fileId: string }[] = [];
    for (const file of allFiles) {
      if (file.type !== "file" || !this.isSupportedFile(file)) continue;
      try {
        const entry = await this.loadFile(file.id);
        if (entry) entries.push(entry);
      } catch {
        console.warn(
          `[takos-excel] Skipping unreadable file: ${file.name}`,
        );
      }
    }
    return entries;
  }

  private async persist(id: string): Promise<void> {
    const entry = this.working.get(id);
    if (!entry) return;
    await this.client.putContent(
      entry.fileId,
      JSON.stringify(entry.ss),
      MIME_TYPE,
    );
  }

  private touch(ss: Spreadsheet): void {
    ss.updatedAt = new Date().toISOString();
  }

  // -----------------------------------------------------------------------
  // Spreadsheet CRUD
  // -----------------------------------------------------------------------

  async listSpreadsheets(): Promise<
    { id: string; title: string; sheetCount: number; updatedAt: string }[]
  > {
    const entries = await this.loadAll();
    return entries.map((e) => ({
      id: e.ss.id,
      title: e.ss.title,
      sheetCount: e.ss.sheets.length,
      updatedAt: e.ss.updatedAt,
    }));
  }

  async createSpreadsheet(title: string): Promise<string> {
    await this.ensureFolder();
    const id = crypto.randomUUID();
    const sheetId = crypto.randomUUID();
    const defaultSheet: Sheet = {
      id: sheetId,
      name: "Sheet1",
      cells: {},
      colWidths: {},
      rowHeights: {},
    };
    const ts = new Date().toISOString();
    const ss: Spreadsheet = {
      id,
      title,
      sheets: [defaultSheet],
      activeSheetId: sheetId,
      createdAt: ts,
      updatedAt: ts,
    };

    const file = await this.client.create(
      `${id}${FILE_EXTENSION}`,
      this.folderId ?? undefined,
      { content: JSON.stringify(ss), mimeType: MIME_TYPE },
    );
    this.fileIds.set(id, file.id);
    return id;
  }

  async getSpreadsheet(id: string): Promise<Spreadsheet> {
    await this.ensureFolder();
    // Always read fresh from storage (source of truth) and record the working
    // copy so a subsequent mutation + persist() operates on this same object.
    let fileId = this.fileIdFor(id);
    if (!fileId) {
      await this.loadAll(); // refresh fileId memo
      fileId = this.fileIdFor(id);
    }
    const entry = (fileId ? await this.loadFile(fileId) : undefined) ??
      await this.loadFile(id);
    if (!entry) {
      this.working.delete(id);
      throw new Error(`Spreadsheet not found: ${id}`);
    }
    this.working.set(id, entry);
    this.working.set(entry.ss.id, entry);
    return entry.ss;
  }

  async deleteSpreadsheet(id: string): Promise<void> {
    await this.ensureFolder();
    let fileId = this.fileIdFor(id);
    if (!fileId) {
      await this.loadAll(); // refresh fileId memo
      fileId = this.fileIdFor(id);
    }
    if (!fileId) throw new Error(`Spreadsheet not found: ${id}`);
    await this.client.delete(fileId);
    this.fileIds.delete(id);
    this.working.delete(id);
  }

  async replaceSpreadsheet(spreadsheet: Spreadsheet): Promise<Spreadsheet> {
    await this.ensureFolder();
    let fileId = this.fileIdFor(spreadsheet.id);
    if (!fileId) {
      await this.loadAll(); // refresh fileId memo
      fileId = this.fileIdFor(spreadsheet.id);
    }
    const updated = {
      ...spreadsheet,
      updatedAt: spreadsheet.updatedAt || new Date().toISOString(),
    };
    if (fileId) {
      await this.client.putContent(
        fileId,
        JSON.stringify(updated),
        MIME_TYPE,
      );
      this.fileIds.set(updated.id, fileId);
      return updated;
    }

    const file = await this.client.create(
      `${updated.id}${FILE_EXTENSION}`,
      this.folderId ?? undefined,
      { content: JSON.stringify(updated), mimeType: MIME_TYPE },
    );
    this.fileIds.set(updated.id, file.id);
    return updated;
  }

  async setSpreadsheetTitle(id: string, title: string): Promise<void> {
    const ss = await this.getSpreadsheet(id);
    ss.title = title;
    this.touch(ss);
    await this.persist(id);
  }

  // -----------------------------------------------------------------------
  // Sheet tab helpers
  // -----------------------------------------------------------------------

  private async getSheet(
    spreadsheetId: string,
    sheetId: string,
  ): Promise<{ ss: Spreadsheet; sheet: Sheet }> {
    const ss = await this.getSpreadsheet(spreadsheetId);
    const sheet = ss.sheets.find((s) => s.id === sheetId);
    if (!sheet) throw new Error(`Sheet not found: ${sheetId}`);
    return { ss, sheet };
  }

  async addTab(spreadsheetId: string, name?: string): Promise<string> {
    const ss = await this.getSpreadsheet(spreadsheetId);
    const sheetId = crypto.randomUUID();
    const tabName = name ?? `Sheet${ss.sheets.length + 1}`;
    ss.sheets.push({
      id: sheetId,
      name: tabName,
      cells: {},
      colWidths: {},
      rowHeights: {},
    });
    this.touch(ss);
    await this.persist(spreadsheetId);
    return sheetId;
  }

  async removeTab(spreadsheetId: string, sheetId: string): Promise<void> {
    const ss = await this.getSpreadsheet(spreadsheetId);
    if (ss.sheets.length <= 1) {
      throw new Error("Cannot remove the last sheet tab");
    }
    ss.sheets = ss.sheets.filter((s) => s.id !== sheetId);
    if (ss.activeSheetId === sheetId) {
      ss.activeSheetId = ss.sheets[0].id;
    }
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async renameTab(
    spreadsheetId: string,
    sheetId: string,
    name: string,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    sheet.name = name;
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  // -----------------------------------------------------------------------
  // Cell operations
  // -----------------------------------------------------------------------

  async getCell(
    spreadsheetId: string,
    sheetId: string,
    cell: CellAddress,
  ): Promise<{
    value: string;
    computed: string;
    format: CellFormat | undefined;
  }> {
    const { sheet } = await this.getSheet(spreadsheetId, sheetId);
    const data = sheet.cells[cell];
    if (!data) return { value: "", computed: "", format: undefined };
    return {
      value: data.value,
      computed: data.computed ?? data.value,
      format: data.format,
    };
  }

  async setCell(
    spreadsheetId: string,
    sheetId: string,
    cell: CellAddress,
    value: string,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    sheet.cells = setCellValue(sheet, cell, value, ss.sheets);
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async getRange(
    spreadsheetId: string,
    sheetId: string,
    range: string,
  ): Promise<string[][]> {
    const { sheet } = await this.getSheet(spreadsheetId, sheetId);
    const { startCol, startRow, endCol, endRow } = parseRange(range);
    const result: string[][] = [];
    for (let r = startRow; r <= endRow; r++) {
      const row: string[] = [];
      for (let c = startCol; c <= endCol; c++) {
        const addr = formatCellAddress(c, r);
        const cell = sheet.cells[addr];
        row.push(cell ? cell.value : "");
      }
      result.push(row);
    }
    return result;
  }

  async setRange(
    spreadsheetId: string,
    sheetId: string,
    startCell: string,
    values: string[][],
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const { col: sc, row: sr } = parseCellAddress(startCell);
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const addr = formatCellAddress(sc + c, sr + r);
        const existing = sheet.cells[addr];
        sheet.cells[addr] = {
          ...existing,
          value: values[r][c],
          format: existing?.format,
        };
      }
    }
    sheet.cells = evaluateSheet(sheet, ss.sheets);
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async clearRange(
    spreadsheetId: string,
    sheetId: string,
    range: string,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const { startCol, startRow, endCol, endRow } = parseRange(range);
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const addr = formatCellAddress(c, r);
        delete sheet.cells[addr];
      }
    }
    sheet.cells = evaluateSheet(sheet, ss.sheets);
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async formatCell(
    spreadsheetId: string,
    sheetId: string,
    cell: CellAddress,
    format: CellFormat,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const existing = sheet.cells[cell];
    sheet.cells[cell] = {
      value: existing?.value ?? "",
      computed: existing?.computed,
      format: { ...(existing?.format ?? {}), ...format },
    };
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async formatRange(
    spreadsheetId: string,
    sheetId: string,
    range: string,
    format: CellFormat,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const { startCol, startRow, endCol, endRow } = parseRange(range);
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const addr = formatCellAddress(c, r);
        const existing = sheet.cells[addr];
        sheet.cells[addr] = {
          value: existing?.value ?? "",
          computed: existing?.computed,
          format: { ...(existing?.format ?? {}), ...format },
        };
      }
    }
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  // -----------------------------------------------------------------------
  // Structure operations (insert / delete rows & columns)
  // -----------------------------------------------------------------------

  /**
   * Run a structural insert/delete on a sheet, adjusting formula references via
   * HyperFormula (loaded with the whole workbook so cross-sheet refs survive),
   * preserving per-cell formats, then re-evaluate and persist. Returns the
   * updated sheet. `at` is a 0-based axis index; `count` >= 1.
   */
  private async applyStructuralOp(
    spreadsheetId: string,
    sheetId: string,
    op: StructuralOp,
    at: number,
    count: number,
  ): Promise<Sheet> {
    if (!Number.isInteger(at) || at < 0) {
      throw new Error(`Invalid index: ${at}`);
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid count: ${count}`);
    }
    const axisMax = op === "insertRows" || op === "deleteRows"
      ? MAX_SPREADSHEET_ROWS
      : MAX_SPREADSHEET_COLUMNS;
    if (at >= axisMax) throw new Error(`Index out of bounds: ${at}`);
    if (op === "deleteRows" || op === "deleteColumns") {
      if (at + count > axisMax) throw new Error(`Range out of bounds`);
    }

    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    // shiftSheetStructure returns adjusted cells for EVERY sheet: the target's
    // data/formats shift, and any other sheet's cross-sheet formulas that
    // referenced the shifted area are re-pointed. Apply all of them before
    // re-evaluating, or other sheets' references would persist pointing at the
    // wrong row/column.
    const shifted = shiftSheetStructure(sheet, op, at, count, ss.sheets);
    for (const s of ss.sheets) {
      const cells = shifted.get(s.id);
      if (cells) s.cells = cells;
    }
    // Re-evaluate every sheet against the now-updated workbook so cross-sheet
    // references resolve to their new positions.
    for (const s of ss.sheets) {
      s.cells = evaluateSheet(s, ss.sheets);
    }
    this.touch(ss);
    await this.persist(spreadsheetId);
    return sheet;
  }

  insertRows(
    spreadsheetId: string,
    sheetId: string,
    at: number,
    count = 1,
  ): Promise<Sheet> {
    return this.applyStructuralOp(
      spreadsheetId,
      sheetId,
      "insertRows",
      at,
      count,
    );
  }

  deleteRows(
    spreadsheetId: string,
    sheetId: string,
    at: number,
    count = 1,
  ): Promise<Sheet> {
    return this.applyStructuralOp(
      spreadsheetId,
      sheetId,
      "deleteRows",
      at,
      count,
    );
  }

  insertColumns(
    spreadsheetId: string,
    sheetId: string,
    at: number,
    count = 1,
  ): Promise<Sheet> {
    return this.applyStructuralOp(
      spreadsheetId,
      sheetId,
      "insertColumns",
      at,
      count,
    );
  }

  deleteColumns(
    spreadsheetId: string,
    sheetId: string,
    at: number,
    count = 1,
  ): Promise<Sheet> {
    return this.applyStructuralOp(
      spreadsheetId,
      sheetId,
      "deleteColumns",
      at,
      count,
    );
  }

  // -----------------------------------------------------------------------
  // Sort
  // -----------------------------------------------------------------------

  /**
   * Reorder the rows within `range` by the value in the column at
   * `columnIndex` (0-based, relative to the range's left edge). Whole row-slices
   * (values + formats) move together; cells outside the range are untouched.
   * Re-evaluates and persists, returning the updated sheet.
   */
  async sortRange(
    spreadsheetId: string,
    sheetId: string,
    range: string,
    columnIndex: number,
    direction: "asc" | "desc",
  ): Promise<Sheet> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const bounds = parseRange(range);
    const width = bounds.endCol - bounds.startCol + 1;
    if (!Number.isInteger(columnIndex) || columnIndex < 0 ||
      columnIndex >= width) {
      throw new Error(`Sort column out of range: ${columnIndex}`);
    }
    sheet.cells = sortRangeRows(sheet.cells, bounds, columnIndex, direction);
    sheet.cells = evaluateSheet(sheet, ss.sheets);
    this.touch(ss);
    await this.persist(spreadsheetId);
    return sheet;
  }

  // -----------------------------------------------------------------------
  // Formula & computation
  // -----------------------------------------------------------------------

  async evaluate(
    spreadsheetId: string,
    sheetId: string,
    formula: string,
  ): Promise<string> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    // Evaluate in the sheet's context with the whole workbook loaded, so
    // cross-sheet refs resolve and no scratch cell is written.
    return evaluateFormula(formula, sheet, ss.sheets);
  }

  async getComputed(
    spreadsheetId: string,
    sheetId: string,
    range: string,
  ): Promise<string[][]> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const cells = evaluateSheet(sheet, ss.sheets);
    const { startCol, startRow, endCol, endRow } = parseRange(range);
    const result: string[][] = [];
    for (let r = startRow; r <= endRow; r++) {
      const row: string[] = [];
      for (let c = startCol; c <= endCol; c++) {
        const addr = formatCellAddress(c, r);
        const cell = cells[addr];
        row.push(cell ? (cell.computed ?? cell.value) : "");
      }
      result.push(row);
    }
    return result;
  }

  /**
   * Compute the bounding box of all non-empty cells on a sheet. When sheetId
   * is omitted, resolves to the spreadsheet's active sheet, falling back to the
   * first sheet. Returns a null range with zero counts for an empty sheet.
   */
  async getUsedRange(
    spreadsheetId: string,
    sheetId?: string,
  ): Promise<
    & { sheetId: string }
    & ReturnType<typeof computeUsedRange>
  > {
    const ss = await this.getSpreadsheet(spreadsheetId);
    const resolvedId = sheetId ?? ss.activeSheetId ?? ss.sheets[0]?.id;
    const sheet = ss.sheets.find((s) => s.id === resolvedId);
    if (!sheet) throw new Error(`Sheet not found: ${resolvedId}`);
    return { sheetId: sheet.id, ...computeUsedRange(sheet.cells) };
  }

  // -----------------------------------------------------------------------
  // Column / Row sizing
  // -----------------------------------------------------------------------

  async setColumnWidth(
    spreadsheetId: string,
    sheetId: string,
    column: string,
    width: number,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const colIndex = letterToColumn(column);
    sheet.colWidths[colIndex] = width;
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async setRowHeight(
    spreadsheetId: string,
    sheetId: string,
    row: number,
    height: number,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    sheet.rowHeights[row] = height;
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  async exportCsv(spreadsheetId: string, sheetId: string): Promise<string> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const cells = evaluateSheet(sheet, ss.sheets);

    let maxRow = 0;
    let maxCol = 0;
    for (const addr of Object.keys(cells)) {
      try {
        const { col, row } = parseCellAddress(addr);
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, col);
      } catch {
        // skip invalid
      }
    }

    const lines: string[] = [];
    for (let r = 0; r <= maxRow; r++) {
      const cols: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        const addr = formatCellAddress(c, r);
        const cell = cells[addr];
        let val = cell ? (cell.computed ?? cell.value) : "";
        // SECURITY (CSV/formula injection): neutralize cells whose first
        // character can trigger formula evaluation in Excel/Sheets by
        // prefixing an apostrophe before RFC-4180 quoting, so attacker- or
        // agent-controlled text like `=cmd|'/c calc'!A1` round-trips as inert
        // text instead of auto-executing when the export is opened.
        if (/^[=+\-@\t\r]/.test(val)) {
          val = "'" + val;
        }
        if (val.includes(",") || val.includes("\n") || val.includes('"')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        cols.push(val);
      }
      lines.push(cols.join(","));
    }
    return lines.join("\n");
  }

  async exportJson(spreadsheetId: string): Promise<string> {
    const ss = await this.getSpreadsheet(spreadsheetId);
    return JSON.stringify(ss, null, 2);
  }

  // -----------------------------------------------------------------------
  // CSV Import
  // -----------------------------------------------------------------------

  async importCsv(
    spreadsheetId: string,
    sheetId: string,
    csvContent: string,
    startCell = "A1",
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    const rows = parseCsv(csvContent);
    const { col: sc, row: sr } = parseCellAddress(startCell);

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const addr = formatCellAddress(sc + c, sr + r);
        const existing = sheet.cells[addr];
        sheet.cells[addr] = {
          ...existing,
          value: rows[r][c],
          format: existing?.format,
        };
      }
    }

    sheet.cells = evaluateSheet(sheet, ss.sheets);
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  // -----------------------------------------------------------------------
  // Conditional Formatting
  // -----------------------------------------------------------------------

  async addConditionalRule(
    spreadsheetId: string,
    sheetId: string,
    rule: ConditionalRule,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    if (!sheet.conditionalRules) sheet.conditionalRules = [];
    sheet.conditionalRules.push(rule);
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async removeConditionalRule(
    spreadsheetId: string,
    sheetId: string,
    ruleId: string,
  ): Promise<void> {
    const { ss, sheet } = await this.getSheet(spreadsheetId, sheetId);
    if (!sheet.conditionalRules) return;
    sheet.conditionalRules = sheet.conditionalRules.filter(
      (r) => r.id !== ruleId,
    );
    this.touch(ss);
    await this.persist(spreadsheetId);
  }

  async listConditionalRules(
    spreadsheetId: string,
    sheetId: string,
  ): Promise<ConditionalRule[]> {
    const { sheet } = await this.getSheet(spreadsheetId, sheetId);
    return sheet.conditionalRules ?? [];
  }
}

// ---------------------------------------------------------------------------
// Utility (private)
// ---------------------------------------------------------------------------

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
