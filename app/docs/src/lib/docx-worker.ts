import { MAX_OFFICE_EDITOR_BYTES, MAX_OFFICE_FILE_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";
import type { ImportedOfficeDocument } from "./docx-model.ts";

import { runOfficeConversionTask } from "../../../shared/lib/office-conversion-task.ts";
type ExportedDocument = {blob: Blob; hasUnsupportedContent: boolean};

function task<T>(
  prepare: () => Promise<{message: unknown; transfer?: Transferable[]}>,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  return runOfficeConversionTask(
    () => new Worker(new URL("../workers/office-docx.worker.ts", import.meta.url), {type:"module", name:"office-docx"}),
    prepare, validate, signal,
  );
}

export function importDocxFile(file: File, signal?: AbortSignal): Promise<ImportedOfficeDocument> {
  return task(async()=>{
    if(!/\.docx$/i.test(file.name)) throw new OfficeFileError("unsupported");
    if(file.size > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    const bytes=await file.arrayBuffer();
    if(bytes.byteLength > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    return {message:{kind:"import",bytes},transfer:[bytes]};
  },(value): value is ImportedOfficeDocument=>{
    if(!value || typeof value !== "object") return false;
    const result=value as ImportedOfficeDocument;
    return typeof result.content === "string" && new TextEncoder().encode(result.content).byteLength <= MAX_OFFICE_EDITOR_BYTES
      && (result.title === undefined || typeof result.title === "string") && typeof result.hasUnsupportedContent === "boolean";
  },signal);
}

export function exportDocxFile(title: string, content: string, signal?: AbortSignal): Promise<ExportedDocument> {
  return task(async()=>{
    if(new TextEncoder().encode(content).byteLength > MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
    return {message:{kind:"export",title,content}};
  },(value): value is ExportedDocument=>{
    if(!value || typeof value !== "object") return false;
    const result=value as ExportedDocument;
    return result.blob instanceof Blob && result.blob.size > 0 && typeof result.hasUnsupportedContent === "boolean";
  },signal);
}
