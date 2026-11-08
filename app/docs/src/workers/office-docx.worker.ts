import { importDocx } from "../lib/docx-import.ts";
import { exportDocx } from "../lib/docx-export.ts";
import { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<unknown>) => void;
  postMessage(value: unknown): void;
};
worker.onmessage = async ({ data }) => {
  try {
    if (!data || typeof data !== "object") throw new OfficeFileError("invalid");
    const task=data as Record<string, unknown>;
    if(task.kind === "import" && task.bytes instanceof ArrayBuffer) {
      if(task.bytes.byteLength > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
      worker.postMessage({kind:"ok",result:await importDocx(new Uint8Array(task.bytes))});
    } else if(task.kind === "export" && typeof task.title === "string" && typeof task.content === "string") {
      if(new TextEncoder().encode(task.content).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
      worker.postMessage({kind:"ok",result:await exportDocx(task.title,task.content)});
    } else throw new OfficeFileError("invalid");
  } catch (error) {
    worker.postMessage({kind:"error",code:error instanceof OfficeFileError ? error.code : "invalid"});
  }
};
