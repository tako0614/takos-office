import { expect, test } from "bun:test";
import { createDocumentImporter } from "../lib/document-import.ts";
import * as storage from "../lib/storage.ts";
import type { ImportedOfficeDocument } from "../lib/docx-model.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(workspace: string) {
  const keys = ["location", "localStorage", "fetch"];
  const before = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const memory = new Map<string, string>();
  let puts = 0;
  let held: (() => Promise<Response>) | undefined;
  const move = (id: string) => {
    const url = new URL(`https://office-fixture.invalid/docs/?space_id=${id}`);
    // Location.href accepts relative navigation in a browser; URL.href does not.
    Object.defineProperty(globalThis, "location", {
      configurable: true, writable: true,
      value: {href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash},
    });
  };
  move(workspace);
  Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  }});
  const requests: string[] = [];
  Object.defineProperty(globalThis, "fetch", {configurable: true, writable: true,
    value: async (url: string, init: RequestInit) => {
      expect(init.method).toBe("PUT");
      expect(new Headers(init.headers).get("If-None-Match")).toBe("*");
      puts++; requests.push(String(url));
      if (held) return held();
      return Response.json({...JSON.parse(String(init.body)), updatedAt: "2026-11-08T12:00:00.000Z"});
    },
  });
  return {move, requests, memory, puts: () => puts, hold: (fn: typeof held) => { held = fn; },
    restore() { keys.forEach((key, i) => { if(before[i]) Object.defineProperty(globalThis, key, before[i]!); else Reflect.deleteProperty(globalThis, key); }); },
  };
}
const decoded: ImportedOfficeDocument = {content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Word import"}]}]}', hasUnsupportedContent: false};
const file = () => new File(["system-boundary input"], "A report.docx");

test("DOCX import captures its Workspace before conversion and adopts the real response ACK", async () => {
  const f = fixture("import-controller-A");
  const conversion = deferred<ImportedOfficeDocument>();
  const importer = createDocumentImporter(async () => conversion.promise);
  try {
    const pending = importer.importFile(file());
    f.move("import-controller-B");
    storage.saveDocuments([]);
    const beforeB = [...f.memory.entries()];
    conversion.resolve(decoded);
    // The old route is no longer current even if its component has not cleaned up yet.
    expect(await pending).toBeNull();
    expect(f.puts()).toBe(0);
    expect([...f.memory.entries()]).toEqual(beforeB);
    f.move("import-controller-A");
    const fresh = await createDocumentImporter(async () => decoded).importFile(file());
    expect(fresh?.document.title).toBe("A report");
    expect(fresh?.document.updatedAt).toBe("2026-11-08T12:00:00.000Z");
    expect(fresh?.document.content).toBe(decoded.content);
    expect(storage.getDocumentSaveState(fresh!.document.id)).toBe("clean");
    expect(f.requests).toEqual([`/api/documents/${fresh!.document.id}?space_id=import-controller-A`]);
  } finally { importer.retire(); f.restore(); }
});

test("retirement across A to B to A cancels conversion without a row or request", async () => {
  const f = fixture("import-generation-A");
  const conversion = deferred<ImportedOfficeDocument>();
  let signal: AbortSignal | undefined;
  const importer = createDocumentImporter(async (_file, value) => { signal = value; return conversion.promise; });
  try {
    const pending = importer.importFile(file());
    f.move("import-generation-B"); importer.retire();
    f.move("import-generation-A");
    conversion.resolve(decoded);
    expect(await pending).toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(f.puts()).toBe(0);
    expect(storage.loadDocuments()).toEqual([]);
  } finally { importer.retire(); f.restore(); }
});

test("invalid DOCX has no optimistic document or API effect and a new attempt can succeed", async () => {
  const f = fixture("import-invalid");
  let fail = true;
  const importer = createDocumentImporter(async () => { if(fail) throw new Error("conversion refused"); return decoded; });
  try {
    await expect(importer.importFile(file())).rejects.toThrow("conversion refused");
    expect(f.puts()).toBe(0);
    expect(storage.loadDocuments()).toEqual([]);
    fail = false;
    expect((await importer.importFile(file()))?.document.content).toBe(decoded.content);
    expect(f.puts()).toBe(1);
  } finally { importer.retire(); f.restore(); }
});

test("retiring an in-flight import keeps its ACK in A without adopting into the next view", async () => {
  const f = fixture("import-ack-A");
  const entered = deferred<void>(), response = deferred<Response>();
  f.hold(async () => { entered.resolve(); return response.promise; });
  const importer = createDocumentImporter(async () => decoded);
  try {
    const pending = importer.importFile(file());
    await entered.promise;
    const doc = storage.loadDocuments()[0];
    f.move("import-ack-B"); importer.retire();
    storage.saveDocuments([]); const beforeB = [...f.memory.entries()].find(([key]) => key.endsWith("import-ack-B"));
    response.resolve(Response.json({...doc, updatedAt: "2026-11-08T12:00:00.000Z"}));
    expect(await pending).toBeNull();
    expect([...f.memory.entries()].find(([key]) => key.endsWith("import-ack-B"))).toEqual(beforeB);
    f.move("import-ack-A");
    expect(storage.getDocument(doc.id)?.updatedAt).toBe("2026-11-08T12:00:00.000Z");
    expect(storage.getDocumentSaveState(doc.id)).toBe("clean");
    expect(f.puts()).toBe(1);
  } finally { importer.retire(); f.restore(); }
});

test("retired import401 cannot redirect a new A view after A to B to A", async () => {
  const f = fixture("import-auth-A");
  const entered = deferred<void>(), response = deferred<Response>();
  f.hold(async () => { entered.resolve(); return response.promise; });
  const importer = createDocumentImporter(async () => decoded);
  try {
    const pending = importer.importFile(file());
    await entered.promise;
    f.move("import-auth-B"); importer.retire(); f.move("import-auth-A");
    const current = globalThis.location.href;
    response.resolve(Response.json({error: "unauthorized"}, {status: 401}));
    expect(await pending).toBeNull();
    expect(globalThis.location.href).toBe(current);
    expect(storage.loadDocuments()).toHaveLength(1); // retained failed old import; no mutation of the new view
    expect(storage.getDocumentSaveState(storage.loadDocuments()[0].id)).toBe("failed");
    expect(f.puts()).toBe(1);
  } finally { importer.retire(); f.restore(); }
});

test("the conversion-to-save boundary allows cancellation before any document write", async () => {
  const f = fixture("import-before-save");
  const importer = createDocumentImporter(async () => decoded);
  try {
    const result = await importer.importFile(file(), () => importer.retire());
    expect(result).toBeNull();
    expect(f.puts()).toBe(0);
    expect(storage.loadDocuments()).toEqual([]);
  } finally { importer.retire(); f.restore(); }
});

test("a retired import401 preserves an acknowledged newer A document and its staged draft", async () => {
  const f = fixture("import-new-draft-A");
  const entered = deferred<void>(), response = deferred<Response>();
  f.hold(async () => { entered.resolve(); return response.promise; });
  const importer = createDocumentImporter(async () => decoded);
  try {
    const pending = importer.importFile(file());
    await entered.promise;
    f.move("import-new-draft-B"); importer.retire(); f.move("import-new-draft-A");
    f.hold(undefined);
    const fresh = await storage.addDocument({id:"new-A-document",title:"New A document",content:"acknowledged new A",createdAt:"2026-11-08T00:00:00.000Z",updatedAt:"2026-11-08T00:00:00.000Z"});
    storage.captureDocumentWriter(fresh.id).stage({content:"newer unsaved A draft"});
    response.resolve(Response.json({error:"old unauthorized request"},{status:401}));
    expect(await pending).toBeNull();
    expect(storage.getDocument(fresh.id)?.content).toBe("newer unsaved A draft");
    expect(storage.getDocumentSaveState(fresh.id)).toBe("draft");
    expect(f.puts()).toBe(2);
  } finally { importer.retire(); f.restore(); }
});

test("a current import401 still clears its cache and enters the normal login flow", async () => {
  const f = fixture("import-current-auth-A");
  f.hold(async () => Response.json({error:"current unauthorized request"},{status:401}));
  const importer = createDocumentImporter(async () => decoded);
  try {
    await expect(importer.importFile(file())).rejects.toThrow();
    expect(storage.loadDocuments()).toEqual([]);
    expect(globalThis.location.href).toStartWith("/api/auth/login?return_to=");
    expect(f.puts()).toBe(1);
  } finally { importer.retire(); f.restore(); }
});
