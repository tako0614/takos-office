import { runOfficeConversionTask } from "../../../shared/lib/office-conversion-task.ts";
import { MAX_OFFICE_FILE_BYTES, MAX_OFFICE_EDITOR_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";
import { isValidSlideSize } from "../../../shared/lib/slide-size.ts";
import type { Presentation } from "../types/index.ts";
import type { ImportedPresentation } from "./pptx-import.ts";

const worker = () => new Worker(new URL("../workers/office-pptx.worker.ts",import.meta.url),{type:"module",name:"office-pptx"});
export function importPptxFile(file: File, signal?: AbortSignal): Promise<ImportedPresentation> {
  return runOfficeConversionTask(worker,async () => {
    if (!/\.pptx$/i.test(file.name)) throw new OfficeFileError("unsupported");
    if (file.size > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_OFFICE_FILE_BYTES) throw new OfficeFileError("too-large");
    return {message:{kind:"import",bytes},transfer:[bytes]};
  },(value): value is ImportedPresentation => {
    if (!value || typeof value !== "object") return false;
    const result = value as ImportedPresentation;
    return Array.isArray(result.slides) && result.slides.length>0 && result.slides.length<=1000 && isValidSlideSize(result.slideSize)
      && (result.title === undefined || typeof result.title === "string" && result.title.length<=512)
      && typeof result.hasUnsupportedContent === "boolean" && new TextEncoder().encode(JSON.stringify(result)).byteLength<=MAX_OFFICE_EDITOR_BYTES;
  },signal);
}
export function exportPptxFile(presentation: Presentation, signal?: AbortSignal): Promise<{blob: Blob; hasUnsupportedContent: boolean}> {
  return runOfficeConversionTask(worker,async () => {
    if (new TextEncoder().encode(JSON.stringify(presentation)).byteLength>MAX_OFFICE_EDITOR_BYTES) throw new OfficeFileError("too-large");
    return {message:{kind:"export",presentation}};
  },(value): value is {blob: Blob; hasUnsupportedContent: boolean} => {
    if (!value || typeof value !== "object") return false;
    const result = value as {blob: Blob; hasUnsupportedContent: boolean};
    return result.blob instanceof Blob && result.blob.size>0 && result.blob.size<=MAX_OFFICE_FILE_BYTES && typeof result.hasUnsupportedContent === "boolean";
  },signal);
}
