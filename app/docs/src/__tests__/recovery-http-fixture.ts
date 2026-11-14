import { createDocsApp } from "../server.ts";
import type { Document } from "../types/index.ts";

/** Actual Docs HTTP/store/client, with synthetic object-protocol backing only. */
export function docsRecoveryHttpFixture() {
  const originals = new Map(["fetch", "location", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map<string, string>(), objects = new Map<string, { body: string; etag: string }>();
  let serial = 0, loseWrite = false;
  const { app } = createDocsApp({ OBJECT_STORAGE_API_URL: "http://docs-object-fixture.local", OBJECT_STORAGE_ACCESS_TOKEN: "synthetic-docs-objects", ALLOW_UNAUTHENTICATED_ACCESS: "1" }, {
    async storageFetch(input, init) {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin !== "http://docs-object-fixture.local" || request.headers.get("authorization") !== "Bearer synthetic-docs-objects") throw new Error("Unexpected synthetic object request");
      if (url.pathname === "/o") {
        const prefix = url.searchParams.get("prefix") ?? "";
        return Response.json({ objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false });
      }
      const key = decodeURIComponent(url.pathname.slice(3)), current = objects.get(key);
      if (request.method === "GET") return current ? new Response(current.body, { headers: { etag: current.etag, "content-type": "application/json" } }) : new Response(null, { status: 404 });
      if (request.method === "PUT") {
        const match = request.headers.get("if-match"), none = request.headers.get("if-none-match");
        if (!(none === "*" ? !current : match !== null && match === current?.etag)) return new Response(null, { status: match || none ? 412 : 428 });
        const body = await request.text();JSON.parse(body);
        const etag = '"r' + (++serial) + '"';objects.set(key, { body, etag });
        return new Response(null, { status: 200, headers: { etag } });
      }
      throw new Error("Unexpected object operation in recovery fixture");
    },
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {values.set(key, value);},
    removeItem: (key: string) => {values.delete(key);},
  } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("http://localhost/docs/?space_id=A") });
  const calls: Array<{ method: string; revision: string | null; status?: number }> = [];
  const active = new Set<Promise<Response>>(), releases = new Set<() => void>();
  let hold: { method: string; waiting: () => void; released: Promise<void> } | undefined;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), "http://localhost"), init), url = new URL(request.url);
    if (url.origin !== "http://localhost" || !url.pathname.startsWith("/api/documents")) throw new Error("Unexpected frontend request");
    const call: typeof calls[number] = { method: request.method, revision: request.headers.get("if-match") };calls.push(call);
    const gate = hold?.method === request.method ? hold : undefined;if (gate) hold = undefined;
    const task = (async () => {
      let response = await app.fetch(request);
      if (gate) {gate.waiting();await gate.released;}
      if (request.method === "PUT" && response.ok && loseWrite) {loseWrite = false;response = Response.json({ error: "synthetic lost ACK after commit" }, {status: 500});}
      call.status = response.status;return response;
    })();
    active.add(task);void task.finally(() => active.delete(task)).catch(() => undefined);return task;
  }) as typeof fetch;
  return {
    app, values, calls,
    loseNextWrite() {loseWrite = true;},
    holdNext(method: string) {
      let waiting!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {waiting = resolve;}), released = new Promise<void>((resolve) => {release = resolve;});
      releases.add(release);hold = {method, waiting, released};
      return {started, release: () => {releases.delete(release);release();}};
    },
    async seed() {
      const response = await app.request("/api/documents?space_id=A", {method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({title:"Recovery document"})});
      if (!response.ok) throw new Error("Actual Docs seed refused: " + response.status);
      return await response.json() as Document;
    },
    async read(id: string) {return app.request("/api/documents/"+encodeURIComponent(id)+"?space_id=A");},
    async close() {
      for (const release of releases) release();await Promise.allSettled([...active]);
      for (const [key, descriptor] of originals) {if (descriptor) Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
    },
  };
}
