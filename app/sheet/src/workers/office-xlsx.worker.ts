import { exportXlsx, importXlsx } from "../lib/xlsx.ts";
import type { Spreadsheet } from "../types/index.ts";
import { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";

const worker = globalThis as unknown as { onmessage: (event: MessageEvent<unknown>) => void; postMessage(value: unknown): void };
worker.onmessage = async ({ data }) => {
  try {
    if (!data || typeof data !== "object") throw new OfficeFileError("invalid");
    const task = data as Record<string, unknown>;
    if (task.kind === "import" && task.bytes instanceof ArrayBuffer) {
      if (task.bytes.byteLength > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
      worker.postMessage({ kind: "ok", result: await importXlsx(new Uint8Array(task.bytes)) });
    } else if (task.kind === "export" && task.spreadsheet && typeof task.spreadsheet === "object") {
      if (new TextEncoder().encode(JSON.stringify(task.spreadsheet)).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
      worker.postMessage({ kind: "ok", result: await exportXlsx(task.spreadsheet as Spreadsheet) });
    } else throw new OfficeFileError("invalid");
  } catch (error) {
    worker.postMessage({ kind: "error", code: error instanceof OfficeFileError ? error.code : "invalid" });
  }
};
