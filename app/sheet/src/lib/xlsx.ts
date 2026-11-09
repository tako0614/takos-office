import ExcelJS from "exceljs";
import { XMLSerializer } from "@xmldom/xmldom";
import type { CellData, CellFormat, CellValueType, Sheet, Spreadsheet } from "../types/index.ts";
import { readOfficePackage, isOfficeRelationship, safeOfficeLink } from "../../../shared/lib/office-package.ts";
import { readOfficeArchive, writeOfficeArchive, parseOfficeXml } from "../../../shared/lib/office-archive.ts";
import { MAX_OFFICE_EDITOR_BYTES, MAX_OFFICE_FILE_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";
import { spreadsheetSchema } from "../../../shared/office-schema.ts";
import { looksNumeric } from "./formula.ts";

const spreadsheetNamespaces = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);
const MAX_ROWS = 1_000, MAX_COLUMNS = 100, MAX_CELLS = 10_000;
const mainType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
export interface ImportedSpreadsheet { spreadsheet: Spreadsheet; hasUnsupportedContent: boolean }

function safeFormula(formula: string): void {
  // Quoted display strings are data; external workbooks and DDE are not.
  const expression = formula.replace(/"(?:[^"]|"")*"/g, (literal) => " ".repeat(literal.length));
  if (/\b(?:WEBSERVICE|RTD|CALL|REGISTER\.ID|EXEC|IMAGE)\s*\(/i.test(expression)
    || /\|/.test(expression.replace(/'(?:[^']|'')*'/g, "''"))
    || /(?:^|[=,(+*/-])\s*'?\[[^\]]+\][^'!]*'?!/.test(expression)) throw new OfficeFileError("unsafe");
  for (const match of expression.matchAll(/\bHYPERLINK\s*\(/gi)) {
    const literal = /^\s*"((?:[^"]|"")*)"\s*[,;)]/.exec(formula.slice(match.index! + match[0].length));
    if (!literal) throw new OfficeFileError("unsupported");
    if (!safeOfficeLink(literal[1].replaceAll('""', '"'))) throw new OfficeFileError("unsafe");
  }
}

function scalar(value: unknown): { value: string; type: CellValueType } | undefined {
  if (value === null || value === undefined) return;
  if (typeof value === "string") return { value, type: "text" };
  if (typeof value === "number" && Number.isFinite(value)) return { value: String(value), type: "number" };
  if (typeof value === "boolean") return { value: value ? "TRUE" : "FALSE", type: "boolean" };
  if (value instanceof Date && Number.isFinite(value.getTime())) return { value: String(25569 + value.getTime() / 86400000), type: "number" };
  if (typeof value === "object" && "error" in value && typeof value.error === "string") return { value: value.error, type: "error" };
  throw new OfficeFileError("unsupported");
}

/** Safely admitted package first; the library never receives untrusted ZIP headers. */
export async function importXlsx(bytes: Uint8Array): Promise<ImportedSpreadsheet> {
  try {
    const pkg = await readOfficePackage(bytes);
    const root = pkg.xmlParts.get(pkg.mainPart)!.documentElement;
    if (!root || pkg.mainContentType !== mainType || root.localName !== "workbook" || !spreadsheetNamespaces.has(root.namespaceURI ?? "")) throw new OfficeFileError("unsupported");
    let count = 0, materialized = 0, mergeArea = 0, unsupported = false;
    const canonicalParts = new Map(pkg.parts);
    const definedNames: NonNullable<Spreadsheet["definedNames"]> = [];
    const nameContainers = root.getElementsByTagName("definedNames");
    if (nameContainers.length > 1) throw new OfficeFileError("invalid");
    const namesContainer = nameContainers.item(0);
    if (namesContainer) {
      if (namesContainer.parentNode !== root || namesContainer.namespaceURI !== root.namespaceURI) throw new OfficeFileError("invalid");
      for (const node of Array.from(namesContainer.getElementsByTagNameNS(root.namespaceURI!, "definedName"))) {
        const name = node.getAttribute("name") ?? "", reference = node.textContent ?? "";
        if (!name || name.length > 256 || reference.length > 8192 || definedNames.length >= 1000) throw new OfficeFileError("too-large");
        if (/^(?:_xlnm\.)?auto_(?:open|close|activate|deactivate)$/i.test(name)) throw new OfficeFileError("unsafe");
        safeFormula(reference);
        const localSheetId = node.hasAttribute("localSheetId") ? Number(node.getAttribute("localSheetId")) : undefined;
        if (localSheetId !== undefined && (!Number.isInteger(localSheetId) || localSheetId < 0 || localSheetId > 255)) throw new OfficeFileError("invalid");
        definedNames.push({ name, reference, ...(localSheetId === undefined ? {} : { localSheetId }), ...(node.hasAttribute("hidden") ? { hidden: ["1", "true"].includes(node.getAttribute("hidden") ?? "") } : {}) });
      }
      // ExcelJS eagerly expands every defined-name range into a CellMatrix.
      // Names are symbolic workbook metadata here, never an allocation recipe.
      root.removeChild(namesContainer);
      canonicalParts.set(pkg.mainPart, new TextEncoder().encode(new XMLSerializer().serializeToString(pkg.xmlParts.get(pkg.mainPart)!)));
    }
    // ExcelJS unescapes custom number-format literals while loading. Retain
    // the original code: removing an escape can turn a literal into a token.
    const stylesPart = [...pkg.relationships.get(pkg.mainPart)!.values()].find((rel) => isOfficeRelationship(rel, "styles"))?.target;
    const styleXml = stylesPart ? pkg.xmlParts.get(stylesPart) : undefined;
    const styleNs = styleXml?.documentElement?.namespaceURI;
    const customFormats = new Map(Array.from(styleXml?.getElementsByTagNameNS(styleNs!, "numFmt") ?? []).map((node) => [Number(node.getAttribute("numFmtId")), node.getAttribute("formatCode") ?? ""]));
    const xfs = styleXml?.getElementsByTagNameNS(styleNs!, "cellXfs").item(0);
    const formatByStyle = Array.from(xfs?.getElementsByTagNameNS(styleNs!, "xf") ?? []).map((xf) => customFormats.get(Number(xf.getAttribute("numFmtId"))));
    const rawFormats = new Map<string, Map<string, string>>();
    const partByName = new Map(Array.from(root.getElementsByTagNameNS(root.namespaceURI!, "sheet")).map((node) => [node.getAttribute("name")!, pkg.relationships.get(pkg.mainPart)!.get(node.getAttribute("r:id") ?? "")?.target]));
    const worksheetParts = new Set([...pkg.relationships.get(pkg.mainPart)!.values()].filter((rel) => isOfficeRelationship(rel, "worksheet")).map((rel) => rel.target));
    if (!worksheetParts.size || worksheetParts.size > 256) throw new OfficeFileError("too-large");
    for (const [name, xml] of pkg.xmlParts) {
      if (/^xl\/(?:externalLinks|queryTables|connections)(?:\/|\.)/i.test(name)) throw new OfficeFileError("unsafe");
      if (!worksheetParts.has(name)) continue;
      const namespace = xml.documentElement!.namespaceURI!;
      if (xml.documentElement!.localName !== "worksheet" || !spreadsheetNamespaces.has(namespace)) throw new OfficeFileError("invalid");
      const allocationTags = new Set(["sheetData", "row", "c", "cols", "col", "mergeCells", "mergeCell"]);
      for (const node of Array.from(xml.getElementsByTagName("*"))) {
        if (allocationTags.has(node.tagName) && node.namespaceURI !== namespace) throw new OfficeFileError("invalid");
      }
      // This unsupported metadata also expands sqref ranges eagerly inside
      // ExcelJS. Omit it with a warning before handing bytes to that parser.
      const validations = Array.from(xml.getElementsByTagName("dataValidations"));
      if (validations.length) {
        unsupported = true;
        for (const node of validations) node.parentNode?.removeChild(node);
        canonicalParts.set(name, new TextEncoder().encode(new XMLSerializer().serializeToString(xml)));
      }
      const formats = new Map<string, string>(); rawFormats.set(name, formats);
      const positions = new Set<string>();
      for (const cell of Array.from(xml.getElementsByTagNameNS(namespace, "c"))) {
        const address = /^([A-Z]+)([1-9]\d*)$/.exec(cell.getAttribute("r") ?? "");
        if (!address) throw new OfficeFileError("invalid");
        const column = [...address[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
        if (++count > MAX_CELLS || Number(address[2]) > MAX_ROWS || column > MAX_COLUMNS) throw new OfficeFileError("too-large");
        if (positions.has(address[0])) throw new OfficeFileError("invalid");
        positions.add(address[0]);
        const code = formatByStyle[Number(cell.getAttribute("s") ?? "0")];
        if (code !== undefined) formats.set(address[0], code);
      }
      for (const row of Array.from(xml.getElementsByTagNameNS(namespace, "row"))) {
        const index = Number(row.getAttribute("r"));
        if (!Number.isSafeInteger(index) || index < 1) throw new OfficeFileError("invalid");
        if (index > MAX_ROWS) throw new OfficeFileError("too-large");
      }
      for (const col of Array.from(xml.getElementsByTagNameNS(namespace, "col"))) {
        const min = Number(col.getAttribute("min")), max = Number(col.getAttribute("max"));
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || min > max) throw new OfficeFileError("invalid");
        if (max > MAX_COLUMNS) throw new OfficeFileError("too-large");
      }
      // ExcelJS expands merge ranges during load, before our model exists.
      // Bound the geometry and total work before it can allocate those cells.
      for (const merge of Array.from(xml.getElementsByTagNameNS(namespace, "mergeCell"))) {
        const match = /^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/.exec(merge.getAttribute("ref") ?? "");
        if (!match) throw new OfficeFileError("invalid");
        const column = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
        const left = column(match[1]), right = column(match[3]), top = Number(match[2]), bottom = Number(match[4]);
        if (left > right || top > bottom) throw new OfficeFileError("invalid");
        if (right > MAX_COLUMNS || bottom > MAX_ROWS || (mergeArea += (right - left + 1) * (bottom - top + 1)) > MAX_CELLS) throw new OfficeFileError("too-large");
        for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) positions.add(`${col}:${row}`);
      }
      // Count explicit and expanded coordinates once, rather than rejecting a
      // normal merge merely because its master already has a <c> element.
      const explicit = Array.from(xml.getElementsByTagNameNS(namespace, "c"));
      for (const cell of explicit) {
        const address = /^([A-Z]+)([1-9]\d*)$/.exec(cell.getAttribute("r")!)!;
        const col = [...address[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
        positions.delete(address[0]); positions.add(`${col}:${address[2]}`);
      }
      materialized += positions.size;
      if (materialized > MAX_CELLS) throw new OfficeFileError("too-large");
      for (const formula of Array.from(xml.getElementsByTagNameNS(namespace, "f"))) safeFormula(formula.textContent ?? "");
      if (["drawing", "legacyDrawing", "mergeCells", "conditionalFormatting", "dataValidations", "tableParts", "extLst", "autoFilter"].some((tag) => xml.getElementsByTagNameNS(namespace, tag).length)) unsupported = true;
    }
    const canonical = await writeOfficeArchive(canonicalParts);
    const data = new Uint8Array(canonical.length); data.set(canonical);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data.buffer);
    const sheets: Sheet[] = [];
    const color = (value: Partial<ExcelJS.Color> | undefined): string | undefined => {
      if (!value) return;
      if (typeof value.argb === "string" && /^[0-9a-f]{8}$/i.test(value.argb)) return "#" + value.argb.slice(2) + (value.argb.slice(0, 2).toUpperCase() === "FF" ? "" : value.argb.slice(0, 2));
      // Default theme ink is already the editor's default; other theme colors
      // need an explicit warning rather than a fabricated RGB approximation.
      if (value.theme !== 1) unsupported = true;
    };
    const format = (cell: ExcelJS.Cell, rawNumberFormat?: string): CellFormat | undefined => {
      const result: CellFormat = {};
      if (cell.font?.bold !== undefined) result.bold = cell.font.bold;
      if (cell.font?.italic !== undefined) result.italic = cell.font.italic;
      if (cell.font?.underline) { result.underline = true; if (cell.font.underline !== true && cell.font.underline !== "single") unsupported = true; }
      if (cell.font?.size !== undefined) result.fontSize = cell.font.size * 4 / 3;
      if (cell.font?.name && cell.font.name !== "Calibri") unsupported = true;
      const ink = color(cell.font?.color); if (ink) result.textColor = ink;
      if (cell.fill?.type === "pattern" && cell.fill.pattern === "solid") {
        const fill = color(cell.fill.fgColor); if (fill) result.bgColor = fill;
      } else if (cell.fill && (cell.fill.type !== "pattern" || cell.fill.pattern !== "none")) unsupported = true;
      const alignment = cell.alignment?.horizontal;
      if (alignment && ["left", "center", "right"].includes(alignment)) result.textAlign = alignment as CellFormat["textAlign"];
      else if (alignment) unsupported = true;
      if (rawNumberFormat !== undefined) result.numberFormat = rawNumberFormat;
      else if (cell.numFmt && cell.numFmt !== "General") result.numberFormat = cell.numFmt;
      if (cell.alignment?.wrapText || cell.alignment?.textRotation || Object.values(cell.border ?? {}).some((edge) => edge?.style)) unsupported = true;
      return Object.keys(result).length ? result : undefined;
    };
    for (const worksheet of workbook.worksheets) {
      const formats = rawFormats.get(partByName.get(worksheet.name) ?? "");
      const sheet: Sheet = { id: crypto.randomUUID(), name: worksheet.name, cells: {}, colWidths: {}, rowHeights: {} };
      worksheet.columns?.forEach((column, index) => { if (column.width !== undefined) sheet.colWidths[index] = column.width * 7 + 5; if (column.hidden) unsupported = true; });
      worksheet.eachRow({ includeEmpty: true }, (row, index) => {
        if (row.height !== undefined) sheet.rowHeights[index - 1] = row.height * 4 / 3;
        if (row.hidden) unsupported = true;
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.type === ExcelJS.ValueType.Merge) { unsupported = true; return; }
          const record: CellData = { value: "" }, style = format(cell, formats?.get(cell.address));
          if (style) record.format = style;
          if (cell.formula) {
            safeFormula(cell.formula); record.value = "=" + cell.formula;
            const cached = scalar(cell.result);
            if (cached) { record.computed = cached.value; record.computedType = cached.type; record.computedSource = "file"; }
          } else {
            let value: unknown = cell.value;
            if (value && typeof value === "object" && ("richText" in value || "hyperlink" in value)) { value = cell.text; unsupported = true; }
            const literal = scalar(value);
            if (literal) { record.value = literal.value; record.valueType = literal.type; }
          }
          if (cell.note) unsupported = true;
          if (cell.value !== null || style) sheet.cells[cell.address] = record;
        });
      });
      if (worksheet.state !== "visible") unsupported = true;
      sheets.push(sheet);
    }
    const now = new Date().toISOString(), active = workbook.views?.[0]?.activeTab ?? 0;
    const spreadsheet: Spreadsheet = { id: crypto.randomUUID(), title: (workbook.title ?? "").trim().slice(0, 512), sheets, activeSheetId: sheets[active]?.id ?? sheets[0]?.id, createdAt: now, updatedAt: now };
    if (definedNames.length) spreadsheet.definedNames = definedNames;
    if (new TextEncoder().encode(JSON.stringify(spreadsheet)).length > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
    if (!spreadsheetSchema.safeParse(spreadsheet).success) throw new OfficeFileError("unsupported");
    return { spreadsheet, hasUnsupportedContent: unsupported };
  } catch (cause) {
    if (cause instanceof OfficeFileError) throw cause;
    throw new OfficeFileError("invalid", { cause });
  }
}

export async function exportXlsx(spreadsheet: Spreadsheet): Promise<{ blob: Blob; hasUnsupportedContent: boolean }> {
  if (new TextEncoder().encode(JSON.stringify(spreadsheet)).length > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
  if (!spreadsheetSchema.safeParse(spreadsheet).success) throw new OfficeFileError("invalid");
  try {
    const workbook = new ExcelJS.Workbook(), names = new Set<string>();
    let count = 0, unsupported = false;
    const number = (value: string) => { const n = Number(value); if (!value.trim() || !Number.isFinite(n)) throw new OfficeFileError("invalid"); return n; };
    const literal = (value: string, type?: CellValueType): string | number | boolean | ExcelJS.CellErrorValue => {
      if (type === "text") return value;
      if (type === "number" || !type && looksNumeric(value)) return number(value);
      if (type === "boolean") { if (!["TRUE", "FALSE"].includes(value)) throw new OfficeFileError("invalid"); return value === "TRUE"; }
      if (type === "error") return { error: value as ExcelJS.CellErrorValue["error"] };
      return value;
    };
    const color = (css: string): Partial<ExcelJS.Color> | undefined => {
      if (/^#[\da-f]{6}$/i.test(css)) return { argb: "FF" + css.slice(1).toUpperCase() };
      if (/^#[\da-f]{8}$/i.test(css)) return { argb: (css.slice(7) + css.slice(1, 7)).toUpperCase() };
      unsupported = true;
    };
    for (const sheet of spreadsheet.sheets) {
      if (!sheet.name || sheet.name.length > 31 || /[\[\]:*?/\\]/.test(sheet.name) || names.has(sheet.name.toLowerCase())) throw new OfficeFileError("unsupported");
      names.add(sheet.name.toLowerCase());
      const worksheet = workbook.addWorksheet(sheet.name);
      for (const [index, pixels] of Object.entries(sheet.colWidths)) {
        const column = Number(index);
        if (!Number.isInteger(column) || column < 0 || column >= MAX_COLUMNS || pixels < 5 || pixels > 1790) throw new OfficeFileError("unsupported");
        worksheet.getColumn(column + 1).width = (pixels - 5) / 7;
      }
      for (const [index, pixels] of Object.entries(sheet.rowHeights)) {
        const row = Number(index);
        if (!Number.isInteger(row) || row < 0 || row >= MAX_ROWS || pixels <= 0 || pixels * 3 / 4 > 409) throw new OfficeFileError("unsupported");
        worksheet.getRow(row + 1).height = pixels * 3 / 4;
      }
      for (const [address, record] of Object.entries(sheet.cells)) {
        const parsed = /^([A-Z]+)([1-9]\d*)$/.exec(address);
        if (!parsed) throw new OfficeFileError("invalid");
        const column = [...parsed[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
        if (++count > MAX_CELLS || Number(parsed[2]) > MAX_ROWS || column > MAX_COLUMNS) throw new OfficeFileError("too-large");
        const cell = worksheet.getCell(address);
        if (record.value.startsWith("=") && record.valueType !== "text") {
          const formula = record.value.slice(1); safeFormula(formula);
          cell.value = { formula, ...(record.computed === undefined || record.computedSource === "stale" ? {} : { result: literal(record.computed, record.computedType) }) };
        } else cell.value = literal(record.value, record.valueType);
        const style = record.format;
        if (style) {
          if (style.fontSize !== undefined && (style.fontSize <= 0 || style.fontSize * 3 / 4 > 409)) throw new OfficeFileError("unsupported");
          cell.font = { bold: style.bold, italic: style.italic, underline: style.underline, size: style.fontSize === undefined ? undefined : style.fontSize * 3 / 4, color: style.textColor ? color(style.textColor) : undefined };
          if (style.bgColor) { const fill = color(style.bgColor); if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: fill }; }
          if (style.textAlign) cell.alignment = { horizontal: style.textAlign };
          if (style.numberFormat !== undefined) cell.numFmt = style.numberFormat;
        }
      }
      if (sheet.conditionalRules?.length || sheet.filter) unsupported = true;
    }
    const active = spreadsheet.sheets.findIndex((sheet) => sheet.id === spreadsheet.activeSheetId);
    if (active < 0) throw new OfficeFileError("invalid");
    workbook.views = [{ activeTab: active } as ExcelJS.WorkbookView];
    workbook.calcProperties.fullCalcOnLoad = true;
    let output: Uint8Array = new Uint8Array(await workbook.xlsx.writeBuffer());
    if (spreadsheet.definedNames?.length) {
      const parts = await readOfficeArchive(output), xml = parseOfficeXml(parts.get("xl/workbook.xml")!);
      const root = xml.documentElement!, namespace = root.namespaceURI!;
      const container = xml.createElementNS(namespace, "definedNames");
      for (const item of spreadsheet.definedNames) {
        safeFormula(item.reference);
        if (/^(?:_xlnm\.)?auto_(?:open|close|activate|deactivate)$/i.test(item.name)) throw new OfficeFileError("unsafe");
        if (item.localSheetId !== undefined && item.localSheetId >= spreadsheet.sheets.length) throw new OfficeFileError("invalid");
        const node = xml.createElementNS(namespace, "definedName");
        node.setAttribute("name", item.name);
        if (item.localSheetId !== undefined) node.setAttribute("localSheetId", String(item.localSheetId));
        if (item.hidden !== undefined) node.setAttribute("hidden", item.hidden ? "1" : "0");
        node.appendChild(xml.createTextNode(item.reference)); container.appendChild(node);
      }
      root.insertBefore(container, root.getElementsByTagNameNS(namespace, "calcPr").item(0));
      const data = new TextEncoder().encode(new XMLSerializer().serializeToString(xml)); parseOfficeXml(data);
      parts.set("xl/workbook.xml", data); output = await writeOfficeArchive(parts);
    }
    if (output.length > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    return { blob: new Blob([new Uint8Array(output)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), hasUnsupportedContent: unsupported };
  } catch (cause) {
    if (cause instanceof OfficeFileError) throw cause;
    throw new OfficeFileError("invalid", { cause });
  }
}
