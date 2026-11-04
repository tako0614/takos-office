import { createSlideAppFromEnv } from "../server.ts";
import type { Presentation } from "../types/index.ts";

/** Actual Slide routes, store and object-storage client; synthetic object protocol backing. */
export function clientStoreFixture() {
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const objects = new Map<string, { body: string; etag: string }>();
  let serial = 0, denyDelete = false;
  const backendOrigin = "http://slide-object-fixture.local";
  const objectRequest = async (request: Request): Promise<Response> => {
    if (request.headers.get("authorization") !== "Bearer local-slide-object-fixture") return new Response(null, { status: 403 });
    const url = new URL(request.url);
    if (url.pathname === "/o") {
      const prefix = url.searchParams.get("prefix") ?? "";
      return Response.json({ objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })), truncated: false });
    }
    const key = decodeURIComponent(url.pathname.slice(3)), current = objects.get(key);
    if (request.method === "GET") return current ? new Response(current.body, { headers: { etag: current.etag, "content-type": "application/json" } }) : new Response(null, { status: 404 });
    if (request.method === "PUT") {
      const match = request.headers.get("if-match"), none = request.headers.get("if-none-match");
      if (!(none === "*" ? !current : match !== null && match === current?.etag)) return new Response(null, { status: match || none ? 412 : 428 });
      const body = await request.text();
      JSON.parse(body);
      const etag = '"r' + (++serial) + '"';
      objects.set(key, { body, etag });
      return new Response(null, { status: 200, headers: { etag } });
    }
    if (request.method === "DELETE") {
      if (denyDelete) { denyDelete = false; return new Response(null, { status: 503 }); }
      if (!current) return new Response(null, { status: 404 });
      if (request.headers.get("if-match") !== current.etag) return new Response(null, { status: 412 });
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  const app = createSlideAppFromEnv({ OBJECT_STORAGE_API_URL: backendOrigin, OBJECT_STORAGE_ACCESS_TOKEN: "local-slide-object-fixture", ALLOW_UNAUTHENTICATED_ACCESS: "1", TAKOS_NATIVE_RENDERING: "0" });
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(), key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  const scope = (workspace: string) => Object.defineProperty(globalThis, "location", { value: new URL("http://localhost/slide/?space_id=" + encodeURIComponent(workspace)), configurable: true });
  scope("A");
  const calls: Array<{ method: string; url: string; revision: string | null; status?: number }> = [];
  const active = new Set<Promise<unknown>>(), releases = new Set<() => void>();
  let hold: { method: string; waiting: () => void; released: Promise<void> } | undefined;
  let loseWrite = false, failWrite = false, readStatus: number | undefined, malformedAck = false;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), "http://localhost"), init);
    const url = new URL(request.url);
    // Other suites can leave a global fetch stub installed. Keep the object
    // protocol backing explicit instead of treating that stub as native HTTP.
    if (url.origin === backendOrigin) return objectRequest(request);
    if (url.origin !== "http://localhost" || !url.pathname.startsWith("/api/presentations")) throw new Error("External fixture request refused");
    const call = { method: request.method, url: request.url, revision: request.headers.get("If-Match") } as typeof calls[number];
    calls.push(call);
    const gate = hold?.method === request.method ? hold : undefined;
    if (gate) hold = undefined;
    const failedRead = request.method === "GET" ? readStatus : undefined;
    if (failedRead) readStatus = undefined;
    const failedWrite = request.method === "PUT" && failWrite;
    if (failedWrite) failWrite = false;
    const task = (async () => {
      if (request.method !== "GET") await new Promise((resolve) => setTimeout(resolve, 20));
      let response = failedWrite ? Response.json({ error: "controlled pre-dispatch failure" }, { status: 500 }) : await app.fetch(request);
      if (failedRead) response = Response.json({ error: "controlled read failure" }, { status: failedRead });
      if (gate) { gate.waiting(); await gate.released; }
      if (request.method === "PUT" && response.ok && loseWrite) { loseWrite = false; response = Response.json({ error: "controlled lost ACK after commit" }, { status: 500 }); }
      if (request.method === "PUT" && response.ok && malformedAck) { malformedAck = false; response = Response.json({ id: "wrong-ack", updatedAt: "invalid" }); }
      call.status = response.status;
      return response;
    })();
    active.add(task);
    void task.finally(() => active.delete(task)).catch(() => undefined);
    return task;
  }) as typeof fetch;
  return {
    app, values, calls, scope,
    holdNext(method: string) {
      let waiting!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => { waiting = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      releases.add(release);hold = { method, waiting, released };
      return { started, release: () => { releases.delete(release);release(); } };
    },
    loseNextWrite() { loseWrite = true; },
    failNextWriteBeforeCommit() { failWrite = true; },
    failNextRead(status = 503) { readStatus = status; },
    malformedNextAck() { malformedAck = true; },
    failNextObjectDelete() { denyDelete = true; },
    async seed(workspace: string, title = "Deck") {
      const response = await app.request("/api/presentations?space_id=" + encodeURIComponent(workspace), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      if (!response.ok) throw new Error("actual API seed failed: " + response.status);
      return await response.json() as Presentation;
    },
    async read(workspace: string, id: string) {
      return app.request("/api/presentations/" + encodeURIComponent(id) + "?space_id=" + encodeURIComponent(workspace));
    },
    async close() {
      for (const release of releases) release();
      await Promise.allSettled([...active]);
      globalThis.fetch = originalFetch;
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation); else delete (globalThis as { location?: Location }).location;
      if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else delete (globalThis as { localStorage?: Storage }).localStorage;
    },
  };
}
