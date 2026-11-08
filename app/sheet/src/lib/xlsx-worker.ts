import { runOfficeConversionTask } from "../../../shared/lib/office-conversion-task.ts";
import { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";
import { spreadsheetSchema } from "../../../shared/office-schema.ts";
import type { Spreadsheet } from "../types/index.ts";
import type { ImportedSpreadsheet } from "./xlsx.ts";

const worker = () => new Worker(new URL("../workers/office-xlsx.worker.ts", import.meta.url), { type: "module", name: "office-xlsx" });
export function importXlsxFile(file: File, signal?: AbortSignal): Promise<ImportedSpreadsheet> {
  return runOfficeConversionTask(worker, async () => {
    if (!/\.xlsx$/i.test(file.name)) throw new OfficeFileError("unsupported");
    if (file.size > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    return { message: { kind: "import", bytes }, transfer: [bytes] };
  }, (value): value is ImportedSpreadsheet => {
    if (!value || typeof value !== "object") return false;
    const result = value as ImportedSpreadsheet;
    return typeof result.hasUnsupportedContent === "boolean" && spreadsheetSchema.safeParse(result.spreadsheet).success
      && new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_OFFICE_EDITOR_BYTES;
  }, signal);
}
export function exportXlsxFile(spreadsheet: Spreadsheet, signal?: AbortSignal): Promise<{ blob: Blob; hasUnsupportedContent: boolean }> {
  return runOfficeConversionTask(worker, async () => ({ message: { kind: "export", spreadsheet } }), (value): value is { blob: Blob; hasUnsupportedContent: boolean } => {
    if (!value || typeof value !== "object") return false;
    const result = value as { blob?: unknown; hasUnsupportedContent?: unknown };
    return result.blob instanceof Blob && result.blob.size > 0 && result.blob.size <= MAX_OFFICE_FILE_BYTES && typeof result.hasUnsupportedContent === "boolean";
  }, signal);
}
