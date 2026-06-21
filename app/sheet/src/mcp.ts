import {
  McpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpreadsheetStore } from "./spreadsheet-store.ts";
import {
  isValidCellAddress,
  isValidCellRange,
  letterToColumn,
  MAX_RANGE_CELLS,
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_ROWS,
  parseCellAddress,
} from "./lib/cell-utils.ts";
import {
  createExcelRuntimeCapabilityManifest,
  type ExcelRuntimeCapabilityManifest,
  excelScreenshotUnavailableMessage,
} from "./runtime-capabilities.ts";
import {
  bytesToBase64,
  createAppMcpServer,
  mcpError as error,
  mcpJson as json,
  mcpText as text,
} from "../../shared/mcp-factory.ts";

export type McpServerOptions = {
  nativeRendering?: boolean;
  runtimeCapabilities?: ExcelRuntimeCapabilityManifest;
};

type ToolArgs<Shape extends z.ZodRawShape> = z.objectOutputType<
  Shape,
  z.ZodTypeAny,
  "passthrough"
>;

type ToolHandler<Shape extends z.ZodRawShape> = (
  args: ToolArgs<Shape>,
) => Promise<unknown> | unknown;

function registerTool<Shape extends z.ZodRawShape>(
  mcp: McpServer,
  name: string,
  description: string,
  paramsSchema: Shape,
  cb: ToolHandler<Shape>,
) {
  return mcp.tool(
    name,
    description,
    paramsSchema,
    cb as unknown as ToolCallback<Shape>,
  );
}

const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
const MAX_CELL_VALUE_LENGTH = 50_000;
const MAX_FORMULA_LENGTH = 8_192;
const MAX_CSV_LENGTH = 1_000_000;
const MAX_FORMAT_STRING_LENGTH = 120;
const MAX_SCREENSHOT_WIDTH = 2_400;
const MAX_SCREENSHOT_HEIGHT = 1_600;

const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);
const titleSchema = z.string().max(MAX_TITLE_LENGTH);
const cellAddressSchema = z
  .string()
  .trim()
  .min(2)
  .max(6)
  .refine(isValidCellAddress, {
    message: "Invalid or out-of-bounds cell address",
  });
const cellRangeSchema = z
  .string()
  .trim()
  .min(5)
  .max(13)
  .refine(isValidCellRange, {
    message: "Invalid, too large, or out-of-bounds range",
  });
const columnSchema = z
  .string()
  .trim()
  .min(1)
  .max(3)
  .regex(/^[A-Z]+$/)
  .refine((column) => letterToColumn(column) < MAX_SPREADSHEET_COLUMNS, {
    message: "Column is out of bounds",
  });
const cellValueSchema = z.string().max(MAX_CELL_VALUE_LENGTH);
const formulaSchema = z.string().min(1).max(MAX_FORMULA_LENGTH);
const rangeValuesSchema = z
  .array(z.array(cellValueSchema).min(1).max(MAX_SPREADSHEET_COLUMNS))
  .min(1)
  .max(MAX_SPREADSHEET_ROWS)
  .refine(
    (rows) =>
      rows.reduce((count, row) => count + row.length, 0) <= MAX_RANGE_CELLS,
    { message: "Too many cells in one request" },
  );
const safeCssValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FORMAT_STRING_LENGTH)
  .refine((value) => !/[<>{};]/.test(value) && !/\burl\s*\(/i.test(value), {
    message: "Must be a safe CSS color",
  });

export function createMcpServer(
  store: SpreadsheetStore,
  options: McpServerOptions = {},
): McpServer {
  const runtimeCapabilities = options.runtimeCapabilities ??
    createExcelRuntimeCapabilityManifest({
      nativeRendering: options.nativeRendering ?? true,
    });
  return createAppMcpServer({
    name: "takos-excel",
    version: "0.1.0",
    registerTools: (mcp) => registerExcelTools(mcp, store, runtimeCapabilities),
  });
}

export function registerExcelTools(
  mcp: McpServer,
  store: SpreadsheetStore,
  runtimeCapabilities: ExcelRuntimeCapabilityManifest,
): void {
  // -----------------------------------------------------------------------
  // Spreadsheet Management
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_list",
    "List all spreadsheets",
    {},
    async (_args) => {
      try {
        return json(await store.listSpreadsheets());
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_create",
    "Create a new spreadsheet",
    { title: titleSchema.describe("Spreadsheet title") },
    async (args) => {
      try {
        const id = await store.createSpreadsheet(args.title);
        return json({ id });
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_get",
    "Get spreadsheet info (metadata + sheet names)",
    { id: idSchema.describe("Spreadsheet ID") },
    async (args) => {
      try {
        const ss = await store.getSpreadsheet(args.id);
        return json({
          id: ss.id,
          title: ss.title,
          createdAt: ss.createdAt,
          updatedAt: ss.updatedAt,
          sheets: ss.sheets.map((s) => ({ id: s.id, name: s.name })),
        });
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_delete",
    "Delete a spreadsheet",
    { id: idSchema.describe("Spreadsheet ID") },
    async (args) => {
      try {
        await store.deleteSpreadsheet(args.id);
        return text("Deleted");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_set_title",
    "Rename a spreadsheet",
    {
      id: idSchema.describe("Spreadsheet ID"),
      title: titleSchema.describe("New title"),
    },
    async (args) => {
      try {
        await store.setSpreadsheetTitle(args.id, args.title);
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Sheet Tab Operations
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_add_tab",
    "Add a new sheet tab",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      name: titleSchema.optional().describe(
        "Tab name (auto-generated if omitted)",
      ),
    },
    async (args) => {
      try {
        const sheetId = await store.addTab(args.spreadsheetId, args.name);
        return json({ sheetId });
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_remove_tab",
    "Remove a sheet tab",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
    },
    async (args) => {
      try {
        await store.removeTab(args.spreadsheetId, args.sheetId);
        return text("Removed");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_rename_tab",
    "Rename a sheet tab",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      name: titleSchema.describe("New tab name"),
    },
    async (args) => {
      try {
        await store.renameTab(args.spreadsheetId, args.sheetId, args.name);
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Cell Operations
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_get_cell",
    "Get a cell's value, computed result, and format",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      cell: cellAddressSchema.describe('Cell address, e.g. "A1"'),
    },
    async (args) => {
      try {
        return json(
          await store.getCell(args.spreadsheetId, args.sheetId, args.cell),
        );
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_set_cell",
    "Set a cell's value or formula",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      cell: cellAddressSchema.describe('Cell address, e.g. "A1"'),
      value: cellValueSchema.describe(
        'Cell value or formula, e.g. "42" or "=SUM(A1:A10)"',
      ),
    },
    async (args) => {
      try {
        await store.setCell(
          args.spreadsheetId,
          args.sheetId,
          args.cell,
          args.value,
        );
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_get_range",
    "Get a range of cell values as a 2D array",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      range: cellRangeSchema.describe('Range, e.g. "A1:C10"'),
    },
    async (args) => {
      try {
        return json(
          await store.getRange(args.spreadsheetId, args.sheetId, args.range),
        );
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_get_used_range",
    "Get the bounding box of all non-empty cells on a sheet (where the data is)",
    {
      id: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema
        .optional()
        .describe("Sheet tab ID (defaults to the active sheet)"),
    },
    async (args) => {
      try {
        const used = await store.getUsedRange(args.id, args.sheetId);
        return json({ id: args.id, ...used });
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_set_range",
    "Set a range of values from a 2D array",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      startCell: cellAddressSchema.describe('Top-left cell, e.g. "A1"'),
      values: rangeValuesSchema.describe("2D array of string values"),
    },
    async (args) => {
      try {
        const start = parseCellAddress(args.startCell);
        const maxWidth = Math.max(
          ...args.values.map((row: string[]) => row.length),
        );
        if (
          start.row + args.values.length > MAX_SPREADSHEET_ROWS ||
          start.col + maxWidth > MAX_SPREADSHEET_COLUMNS
        ) {
          return error("Range exceeds sheet bounds");
        }

        await store.setRange(
          args.spreadsheetId,
          args.sheetId,
          args.startCell,
          args.values,
        );
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_clear_range",
    "Clear all cells in a range",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      range: cellRangeSchema.describe('Range, e.g. "A1:C10"'),
    },
    async (args) => {
      try {
        await store.clearRange(args.spreadsheetId, args.sheetId, args.range);
        return text("Cleared");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  const formatSchema = {
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    textColor: safeCssValueSchema.optional().describe("CSS color string"),
    bgColor: safeCssValueSchema.optional().describe(
      "CSS background color string",
    ),
    fontSize: z.number().int().min(6).max(72).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    numberFormat: z
      .string()
      .max(MAX_FORMAT_STRING_LENGTH)
      .optional()
      .describe('Number format, e.g. "#,##0.00", "0%", "yyyy-mm-dd"'),
  };

  registerTool(
    mcp,
    "sheet_format_cell",
    "Apply formatting to a cell",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      cell: cellAddressSchema.describe('Cell address, e.g. "A1"'),
      format: z.object(formatSchema).strict().describe("Format options"),
    },
    async (args) => {
      try {
        await store.formatCell(
          args.spreadsheetId,
          args.sheetId,
          args.cell,
          args.format,
        );
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_format_range",
    "Apply formatting to a range of cells",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      range: cellRangeSchema.describe('Range, e.g. "A1:C10"'),
      format: z.object(formatSchema).strict().describe("Format options"),
    },
    async (args) => {
      try {
        await store.formatRange(
          args.spreadsheetId,
          args.sheetId,
          args.range,
          args.format,
        );
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Formula & Computation
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_evaluate",
    "Evaluate a formula without storing it in any cell",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      formula: formulaSchema.describe('Formula, e.g. "=SUM(A1:A10)"'),
    },
    async (args) => {
      try {
        const result = await store.evaluate(
          args.spreadsheetId,
          args.sheetId,
          args.formula,
        );
        return text(result);
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_get_computed",
    "Get computed/evaluated values for a range",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      range: cellRangeSchema.describe('Range, e.g. "A1:C10"'),
    },
    async (args) => {
      try {
        return json(
          await store.getComputed(args.spreadsheetId, args.sheetId, args.range),
        );
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Column / Row Operations
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_set_column_width",
    "Set the width of a column",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      column: columnSchema.describe('Column letter, e.g. "A"'),
      width: z.number().int().min(40).max(500).describe("Width in pixels"),
    },
    async (args) => {
      try {
        await store.setColumnWidth(
          args.spreadsheetId,
          args.sheetId,
          args.column,
          args.width,
        );
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_set_row_height",
    "Set the height of a row",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      row: z.number().int().min(1).max(MAX_SPREADSHEET_ROWS).describe(
        "Row number (1-based)",
      ),
      height: z.number().int().min(18).max(200).describe("Height in pixels"),
    },
    async (args) => {
      try {
        await store.setRowHeight(
          args.spreadsheetId,
          args.sheetId,
          args.row,
          args.height,
        );
        return text("OK");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Screenshot
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_screenshot",
    "Render a spreadsheet sheet as a PNG image showing the grid with values",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      rows: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of rows to show (default: 20)"),
      cols: z
        .number()
        .int()
        .min(1)
        .max(MAX_SPREADSHEET_COLUMNS)
        .optional()
        .describe("Number of columns to show (default: 10)"),
      width: z
        .number()
        .int()
        .min(320)
        .max(MAX_SCREENSHOT_WIDTH)
        .optional()
        .describe("Image width in pixels (default: 1200)"),
      height: z
        .number()
        .int()
        .min(240)
        .max(MAX_SCREENSHOT_HEIGHT)
        .optional()
        .describe("Image height in pixels (default: 800)"),
    },
    async (args) => {
      try {
        const unavailable = excelScreenshotUnavailableMessage(
          runtimeCapabilities.screenshot,
        );
        if (unavailable) return error(unavailable);

        const ss = await store.getSpreadsheet(args.spreadsheetId);
        const sheet = ss.sheets.find((s) => s.id === args.sheetId);
        if (!sheet) return error(`Sheet not found: ${args.sheetId}`);
        const rendererModule = "./lib/grid-renderer.ts";
        const { renderSheetToBuffer } = await import(
          rendererModule
        ) as typeof import("./lib/grid-renderer.ts");

        const buf = renderSheetToBuffer(sheet, {
          rows: Math.min(100, Math.max(1, Math.trunc(args.rows ?? 20))),
          cols: Math.min(
            MAX_SPREADSHEET_COLUMNS,
            Math.max(1, Math.trunc(args.cols ?? 10)),
          ),
          width: Math.min(
            MAX_SCREENSHOT_WIDTH,
            Math.max(320, Math.trunc(args.width ?? 1200)),
          ),
          height: Math.min(
            MAX_SCREENSHOT_HEIGHT,
            Math.max(240, Math.trunc(args.height ?? 800)),
          ),
        });
        const base64 = bytesToBase64(buf);
        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (e) {
        return error(`Failed to render sheet: ${String(e)}`);
      }
    },
  );

  // -----------------------------------------------------------------------
  // CSV Import
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_import_csv",
    "Import CSV content into a sheet",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      csvContent: z.string().max(MAX_CSV_LENGTH).describe("CSV content string"),
      startCell: cellAddressSchema
        .optional()
        .describe('Top-left cell to start import at (default "A1")'),
    },
    async (args) => {
      try {
        await store.importCsv(
          args.spreadsheetId,
          args.sheetId,
          args.csvContent,
          args.startCell,
        );
        return text("Imported");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Conditional Formatting
  // -----------------------------------------------------------------------

  const conditionTypeEnum = z.enum([
    "greaterThan",
    "lessThan",
    "equal",
    "notEqual",
    "between",
    "textContains",
    "isEmpty",
    "isNotEmpty",
  ]);

  registerTool(
    mcp,
    "sheet_add_conditional_rule",
    "Add a conditional formatting rule to a sheet",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      range: cellRangeSchema.describe('Cell range, e.g. "A1:C10"'),
      conditionType: conditionTypeEnum.describe("Condition type"),
      conditionValues: z
        .array(z.string().max(MAX_CELL_VALUE_LENGTH))
        .max(2)
        .optional()
        .describe("Comparison values (e.g. threshold numbers)"),
      format: z.object(formatSchema).strict().describe(
        "Format to apply when matched",
      ),
    },
    async (args) => {
      try {
        const rule = {
          id: crypto.randomUUID(),
          range: args.range,
          condition: {
            type: args.conditionType,
            values: args.conditionValues ?? [],
          },
          format: args.format,
        };
        await store.addConditionalRule(args.spreadsheetId, args.sheetId, rule);
        return json({ id: rule.id });
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_remove_conditional_rule",
    "Remove a conditional formatting rule",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
      ruleId: idSchema.describe("Conditional rule ID"),
    },
    async (args) => {
      try {
        await store.removeConditionalRule(
          args.spreadsheetId,
          args.sheetId,
          args.ruleId,
        );
        return text("Removed");
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_list_conditional_rules",
    "List conditional formatting rules for a sheet",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
    },
    async (args) => {
      try {
        return json(
          await store.listConditionalRules(args.spreadsheetId, args.sheetId),
        );
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  registerTool(
    mcp,
    "sheet_export_csv",
    "Export a sheet tab as CSV",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
      sheetId: idSchema.describe("Sheet tab ID"),
    },
    async (args) => {
      try {
        return text(await store.exportCsv(args.spreadsheetId, args.sheetId));
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerTool(
    mcp,
    "sheet_export_json",
    "Export the entire spreadsheet as JSON",
    {
      spreadsheetId: idSchema.describe("Spreadsheet ID"),
    },
    async (args) => {
      try {
        return text(await store.exportJson(args.spreadsheetId));
      } catch (e) {
        return error(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
