import { OfficeFileError } from "./office-file.ts";

const deadlineMs = 15_000;

export function runOfficeConversionTask<T>(
  createWorker: () => Worker,
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
      worker=createWorker();
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
