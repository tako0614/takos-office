import { MAX_OFFICE_EDITOR_BYTES, MAX_OFFICE_FILE_BYTES, OfficeFileError } from "../../../shared/lib/office-file.ts";
import type { ImportedOfficeDocument } from "./docx-model.ts";

const deadlineMs = 15_000;
type ExportedDocument = {blob: Blob; hasUnsupportedContent: boolean};

function task<T>(
  prepare: () => Promise<{message: unknown; transfer?: Transferable[]}>,
  validate: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    let worker: Worker | undefined, settled=false;
    const finish=(error?: unknown, result?: T)=>{
      if(settled) return;
      settled=true; clearTimeout(timer); signal?.removeEventListener("abort",abort); worker?.terminate();
      if(error === undefined && result !== undefined) resolve(result); else reject(error ?? new OfficeFileError("invalid"));
    };
    const abort=()=>finish(signal?.reason ?? new DOMException("Import cancelled","AbortError"));
    const timer=setTimeout(()=>finish(new OfficeFileError("timeout")),deadlineMs);
    signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted) { abort(); return; }
    void prepare().then(({message,transfer})=>{
      if(settled) return;
      if(typeof Worker === "undefined") throw new OfficeFileError("unsupported");
      worker=new Worker(new URL("../workers/office-docx.worker.ts",import.meta.url),{type:"module",name:"office-docx"});
      worker.onmessage=({data}: MessageEvent<unknown>)=>{
        if(!data || typeof data !== "object") { finish(new OfficeFileError("invalid")); return; }
        const reply=data as Record<string,unknown>;
        if(reply.kind === "ok" && validate(reply.result)) finish(undefined,reply.result);
        else {
          const code=reply.code;
          finish(new OfficeFileError(code === "too-large" || code === "unsafe" || code === "unsupported" || code === "timeout" ? code : "invalid"));
        }
      };
      worker.onerror=(event)=>{ event.preventDefault(); finish(new OfficeFileError("invalid",{cause:event.message})); };
      worker.onmessageerror=()=>finish(new OfficeFileError("invalid"));
      worker.postMessage(message,transfer ?? []);
    }).catch(error=>finish(error));
  });
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
