import { expect, test } from "bun:test";
import assert from "node:assert/strict";

import * as client from "../lib/storage.ts";
import * as backend from "../document-store.ts";
import type {
  TakosStorageClient,
  StorageFile,
} from "../../../shared/lib/takos-storage.ts";
import type { Document } from "../types/index.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function installFixture(workspace: string) {
  const descriptors = Object.fromEntries(
    ["fetch", "localStorage", "location"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const memory = new Map<string, string>();
  let lastCacheKey: string | undefined;
  const locationFor = (scope: string) =>
    new URL(`https://office-fixture.invalid/docs/fixture?space_id=${scope}`);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        lastCacheKey = key;
        memory.set(key, String(value));
      },
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    writable: true,
    value: locationFor(workspace),
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error("Unexpected fixture fetch: external network denied");
    },
  });
  return {
    dump() {
      return [...memory.entries()];
    },
    lastCacheSnapshot() {
      assert.equal(typeof lastCacheKey, "string");
      return { key: lastCacheKey!, bytes: memory.get(lastCacheKey!) ?? null };
    },
    cacheBytes(key: string) {
      return memory.get(key) ?? null;
    },
    setWorkspace(scope: string) {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        writable: true,
        value: locationFor(scope),
      });
    },
    restore() {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

function document(id: string, content: string) {
  return {
    id,
    title: `Synthetic ${id}`,
    content,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

test("sequential saves use acknowledged server revision without a false conflict", async () => {
  const fixture = installFixture("write-scope");
  try {
    const initial = document("sequential-doc", "initial");
    let stored = structuredClone(initial);
    let objectRevision = 0;
    let writes = 0;
    const metadata = (): StorageFile => ({
      id: "fixture-file",
      name: `${initial.id}.takosdoc`,
      type: "file",
      createdAt: initial.createdAt,
      updatedAt: stored.updatedAt,
      revision: `fixture-object-${objectRevision}`,
    });
    const backing: TakosStorageClient = {
      async ready() {},
      async rename() {},
      async delete() {},
      async list(prefix?: string) {
        assert.ok(prefix === undefined || prefix === "takos-docs");
        return prefix === undefined
          ? [
              {
                id: "fixture-folder",
                name: "takos-docs",
                type: "folder",
                createdAt: initial.createdAt,
                updatedAt: initial.updatedAt,
              },
            ]
          : [metadata()];
      },
      async get(id: string) {
        assert.equal(id, "fixture-file");
        return metadata();
      },
      async getContent(id: string) {
        assert.equal(id, "fixture-file");
        return JSON.stringify(stored);
      },
      async putContent(
        id: string,
        content: string,
        _mime: string,
        options?: { expectedRevision?: string },
      ) {
        assert.equal(id, "fixture-file");
        assert.equal(options?.expectedRevision, metadata().revision);
        stored = JSON.parse(content);
        objectRevision += 1;
        writes += 1;
      },
      async create() {
        throw new Error("Unexpected fixture create");
      },
      async createFolder() {
        throw new Error("Unexpected fixture createFolder");
      },
    };
    const store = new backend.TakosDocumentStore(backing);
    const entered = deferred();
    const release = deferred();
    const requests: Array<{ expected: string | null }> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (url: string, init: RequestInit) => {
        assert.equal(
          String(url),
          `/api/documents/${initial.id}?space_id=write-scope`,
        );
        assert.equal(init.method, "PUT");
        assert.ok(
          requests.length < 2,
          "No retry or unrelated request is permitted",
        );
        const expected = new Headers(init.headers).get("If-Match");
        requests.push({ expected });
        if (requests.length === 1) {
          entered.resolve();
          await release.promise;
        }
        try {
          return Response.json(
            await store.upsert(JSON.parse(String(init.body)), {
              expectedUpdatedAt: expected ?? undefined,
            }),
          );
        } catch (error) {
          if (error instanceof backend.DocumentConflictError) {
            return Response.json(
              { error: "conflict", current: error.current },
              { status: 409 },
            );
          }
          throw error;
        }
      },
    });
    client.saveDocuments([initial]);
    const pending = client.updateDocumentInStorage(initial.id, {
      content: "first",
    });
    await entered.promise;
    // Simulated transit separates the real client's optimistic revision from
    // the real store's subsequent server revision; no product clock changes.
    await new Promise((done) => setTimeout(done, 20));
    release.resolve();
    const firstAck = await pending;
    const cachedAfterFirst = client.getDocument(initial.id);
    let secondSaved = false;
    try {
      const second = await client.updateDocumentInStorage(initial.id, {
        content: "second",
      });
      secondSaved = second?.content === "second";
    } catch (error) {
      if (!(error instanceof client.DocumentConflictError)) throw error;
    }
    // Desired product behavior, without manual ACK reseeding/control edits.
    expect({
      firstAckCached: cachedAfterFirst?.updatedAt === firstAck?.updatedAt,
      nextUsesAck: requests[1]?.expected === firstAck?.updatedAt,
      secondSaved,
      writes,
      persistedContent: stored.content,
    }).toEqual({
      firstAckCached: true,
      nextUsesAck: true,
      secondSaved: true,
      writes: 2,
      persistedContent: "second",
    });
  } finally {
    fixture.restore();
  }
});

test("a deferred document GET keeps its original Workspace cache across navigation", async () => {
  const fixture = installFixture("read-A");
  try {
    const docA = document("scope-doc-A", "A");
    const docB = document("scope-doc-B", "B");
    client.saveDocuments([]);
    fixture.setWorkspace("read-B");
    client.saveDocuments([docB]);
    const beforeB = fixture.lastCacheSnapshot();
    fixture.setWorkspace("read-A");
    const entered = deferred();
    const release = deferred();
    let requests = 0;
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: async (url: string, init: RequestInit) => {
        requests += 1;
        assert.equal(requests, 1);
        assert.equal(String(url), `/api/documents/${docA.id}?space_id=read-A`);
        assert.ok(init.method === undefined || init.method === "GET");
        entered.resolve();
        await release.promise;
        return Response.json(docA);
      },
    });
    const pending = client.loadDocumentFromApi(docA.id);
    await entered.promise;
    fixture.setWorkspace("read-B");
    release.resolve();
    const returned = await pending;
    const afterB = fixture.cacheBytes(beforeB.key);
    fixture.setWorkspace("read-A");
    expect({
      requestCount: requests,
      returnedA: returned.id === docA.id,
      otherCacheUnchanged: afterB === beforeB.bytes,
      originalCache: client.loadDocuments(),
    }).toEqual({
      requestCount: 1,
      returnedA: true,
      otherCacheUnchanged: true,
      originalCache: [docA],
    });
  } finally {
    fixture.restore();
  }
});

// Storage is the external system boundary. Both browser saves and independent
// writes below run through the real DocumentStore and its real revision/CAS.
function server(initial?: Document) {
  const records = new Map<string, Document>();
  if (initial) records.set(initial.id, initial);
  let revision = 0;
  const file = (doc: Document): StorageFile => ({
    id: doc.id,
    name: `${doc.id}.takosdoc`,
    type: "file",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    revision: String(revision),
  });
  const backing: TakosStorageClient = {
    async ready() {},
    async rename() {},
    async delete() {},
    async list(prefix) {
      return prefix
        ? [...records.values()].map(file)
        : [
            {
              id: "folder",
              name: "takos-docs",
              type: "folder",
              createdAt: "2025-01-01",
              updatedAt: "2025-01-01",
            },
          ];
    },
    async get(id) {
      const doc = records.get(id);
      return doc ? file(doc) : null;
    },
    async getContent(id) {
      return JSON.stringify(records.get(id));
    },
    async putContent(_id, body, _mime, options) {
      assert.equal(options?.expectedRevision, String(revision));
      const doc: Document = JSON.parse(body);
      records.set(doc.id, doc);
      revision++;
    },
    async create(_name, _parent, options) {
      const doc: Document = JSON.parse(options!.content!);
      assert(!records.has(doc.id));
      records.set(doc.id, doc);
      revision++;
      return file(doc);
    },
    async createFolder() {
      throw new Error("unexpected createFolder");
    },
  };
  const store = new backend.TakosDocumentStore(backing);
  const requests: Array<{
    id: string;
    expected: string | null;
    create: string | null;
  }> = [];
  let beforePut = async (_n: number) => {};
  let loseAck = false;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input), "https://office-fixture.invalid");
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    if (!init?.method || init.method === "GET") {
      const doc = await store.get(id);
      return doc
        ? Response.json(doc)
        : Response.json({ error: "not found" }, { status: 404 });
    }
    assert.equal(init.method, "PUT");
    const headers = new Headers(init.headers);
    requests.push({
      id,
      expected: headers.get("If-Match"),
      create: headers.get("If-None-Match"),
    });
    await beforePut(requests.length);
    try {
      const ack = await store.upsert(JSON.parse(String(init.body)), {
        expectedUpdatedAt: headers.get("If-Match") ?? undefined,
      });
      if (loseAck)
        throw new Error("synthetic response lost after committed write");
      return Response.json(ack);
    } catch (error) {
      if (error instanceof backend.DocumentConflictError)
        return Response.json({ current: error.current }, { status: 409 });
      throw error;
    }
  }) as typeof fetch;
  return {
    store,
    requests,
    hold: (f: typeof beforePut) => {
      beforePut = f;
    },
    loseAck: () => {
      loseAck = true;
    },
    restoreAck: () => {
      loseAck = false;
    },
  };
}

test("create then update uses the actual created ACK", async () => {
  const fixture = installFixture("create-update");
  try {
    const remote = server();
    const doc = document("created", "new");
    const ack = await client.addDocument(doc);
    await client.updateDocumentInStorage(doc.id, { content: "edited" });
    expect(remote.requests.map((x) => [x.expected, x.create])).toEqual([
      [null, "*"],
      [ack.updatedAt, null],
    ]);
    expect((await remote.store.get(doc.id))?.content).toBe("edited");
  } finally {
    fixture.restore();
  }
});

test("in-flight edits serialize with the first ACK and retain the newer draft", async () => {
  const fixture = installFixture("inflight");
  const entered = deferred(),
    release = deferred(),
    enteredSecond = deferred(),
    releaseSecond = deferred();
  let pending: Promise<unknown>[] = [];
  try {
    const doc = document("inflight-doc", "initial");
    const remote = server(doc);
    remote.hold(async (n) => {
      if (n === 1) {
        entered.resolve();
        await release.promise;
      } else {
        enteredSecond.resolve();
        await releaseSecond.promise;
      }
    });
    client.saveDocuments([doc]);
    const first = client.updateDocumentInStorage(doc.id, { content: "first" });
    pending.push(first);
    await entered.promise;
    const second = client.updateDocumentInStorage(doc.id, { content: "newer" });
    pending.push(second);
    const writesBeforeFirstAck = remote.requests.length;
    release.resolve();
    const ack = await first;
    await enteredSecond.promise;
    const duringSecond = client.getDocument(doc.id)?.content;
    releaseSecond.resolve();
    const outcomes = await Promise.allSettled(pending);
    expect({
      writesBeforeFirstAck,
      duringSecond,
      final: (await remote.store.get(doc.id))?.content,
      usesAck: remote.requests[1]?.expected === ack?.updatedAt,
      failures: outcomes.filter((x) => x.status === "rejected").length,
    }).toEqual({
      writesBeforeFirstAck: 1,
      duringSecond: "newer",
      final: "newer",
      usesAck: true,
      failures: 0,
    });
  } finally {
    release.resolve();
    releaseSecond.resolve();
    await Promise.allSettled(pending);
    fixture.restore();
  }
});

test("a genuine other-writer409 pauses further writes and keeps the latest local draft", async () => {
  const fixture = installFixture("real-conflict");
  try {
    const doc = document("conflict-doc", "initial");
    const remote = server(doc);
    client.saveDocuments([doc]);
    await remote.store.upsert(
      { ...doc, content: "other writer" },
      { expectedUpdatedAt: doc.updatedAt },
    );
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "local" }),
    ).rejects.toBeInstanceOf(client.DocumentConflictError);
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "newest local" }),
    ).rejects.toBeInstanceOf(Error);
    expect({
      requests: remote.requests.length,
      local: client.getDocument(doc.id)?.content,
      remote: (await remote.store.get(doc.id))?.content,
    }).toEqual({ requests: 1, local: "newest local", remote: "other writer" });
  } finally {
    fixture.restore();
  }
});

test("an unknown ACK does not trigger an automatic write retry or discard the draft on GET", async () => {
  const fixture = installFixture("lost-ack");
  try {
    const doc = document("lost-ack-doc", "initial");
    const remote = server(doc);
    remote.loseAck();
    client.saveDocuments([doc]);
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "local" }),
    ).rejects.toThrow();
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "newer local" }),
    ).rejects.toThrow();
    const loaded = await client.loadDocumentFromApi(doc.id);
    expect({
      requests: remote.requests.length,
      returned: loaded.content,
      cache: client.getDocument(doc.id)?.content,
    }).toEqual({ requests: 1, returned: "newer local", cache: "newer local" });
  } finally {
    fixture.restore();
  }
});

test("unknown ACK survives a fresh client module and explicit retry reconciles without reseeding ACK", async () => {
  const fixture = installFixture("reload-unknown");
  try {
    const doc = document("reload-doc", "initial");
    const remote = server(doc);
    remote.loseAck();
    client.saveDocuments([doc]);
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "draft" }),
    ).rejects.toThrow();
    // Bun caches ESM despite URL queries. Use a real fresh process, retaining
    // only this fixture's serialized localStorage, not queue/module memory.
    const child = Bun.spawn(
      [
        process.execPath,
        "--eval",
        `
      const memory = new Map(JSON.parse(process.env.CUSTODY_CACHE));
      globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
      globalThis.location = new URL('https://office-fixture.invalid/docs/fixture?space_id=reload-unknown');
      let puts = 0;
      globalThis.fetch = async (_url, init) => { if (init?.method === 'PUT') { puts++; throw Error('unexpected PUT'); } return Response.json(JSON.parse(process.env.CUSTODY_REMOTE)); };
      const fresh = await import(process.env.CUSTODY_MODULE);
      const state = fresh.getDocumentSaveState('reload-doc');
      const loaded = await fresh.loadDocumentFromApi('reload-doc');
      let rejected = false;
      try { await fresh.updateDocumentInStorage('reload-doc', {content:'draft'}); } catch { rejected = true; }
      console.log(JSON.stringify({state, loaded:loaded.content, cached:fresh.getDocument('reload-doc').content, rejected, puts}));
    `,
      ],
      {
        env: {
          ...process.env,
          CUSTODY_CACHE: JSON.stringify(fixture.dump()),
          CUSTODY_REMOTE: JSON.stringify(await remote.store.get(doc.id)),
          CUSTODY_MODULE: new URL("../lib/storage.ts", import.meta.url)
            .pathname,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    try {
      const [output, errors, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ exit, errors, result: JSON.parse(output) }).toEqual({
        exit: 0,
        errors: "",
        result: {
          state: "failed",
          loaded: "draft",
          cached: "draft",
          rejected: true,
          puts: 0,
        },
      });
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await child.exited;
      }
    }
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "recovered draft" }),
    ).rejects.toThrow();
    expect(remote.requests.length).toBe(1);
    remote.restoreAck();
    await client.retryDocumentAfterConflict(doc.id);
    expect({
      saved: (await remote.store.get(doc.id))?.content,
      cache: client.getDocument(doc.id)?.content,
      state: client.getDocumentSaveState(doc.id),
    }).toEqual({
      saved: "recovered draft",
      cache: "recovered draft",
      state: "clean",
    });
  } finally {
    fixture.restore();
  }
});

test("explicit discard loads the actual other writer after preserving a conflict draft", async () => {
  const fixture = installFixture("discard-conflict");
  try {
    const doc = document("discard-doc", "initial");
    const remote = server(doc);
    client.saveDocuments([doc]);
    await remote.store.upsert(
      { ...doc, content: "other" },
      { expectedUpdatedAt: doc.updatedAt },
    );
    await expect(
      client.updateDocumentInStorage(doc.id, { content: "local" }),
    ).rejects.toThrow();
    expect(client.getDocument(doc.id)?.content).toBe("local");
    const read = await client.loadDocumentFromApi(doc.id, {
      discardLocal: true,
    });
    expect({
      returned: read.content,
      cache: client.getDocument(doc.id)?.content,
      requests: remote.requests.length,
      state: client.getDocumentSaveState(doc.id),
    }).toEqual({
      returned: "other",
      cache: "other",
      requests: 1,
      state: "clean",
    });
  } finally {
    fixture.restore();
  }
});

test("a stale GET finishing after a successful save cannot roll back the acknowledged cache", async () => {
  const fixture = installFixture("stale-read");
  const entered = deferred(),
    release = deferred();
  try {
    const doc = document("stale-doc", "old");
    const remote = server(doc);
    const writeFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      if (init?.method === "PUT") return writeFetch(input, init);
      entered.resolve();
      await release.promise;
      return Response.json(doc);
    }) as typeof fetch;
    client.saveDocuments([doc]);
    const read = client.loadDocumentFromApi(doc.id);
    await entered.promise;
    const ack = await client.updateDocumentInStorage(doc.id, {
      content: "new",
    });
    release.resolve();
    await read;
    expect(client.getDocument(doc.id)).toEqual(ack!);
    expect((await remote.store.get(doc.id))?.content).toBe("new");
  } finally {
    release.resolve();
    fixture.restore();
  }
});

test("list GET retains its captured Workspace and preserves a pending draft", async () => {
  const fixture = installFixture("list-A");
  const entered = deferred(),
    release = deferred();
  try {
    const doc = document("list-doc", "old");
    client.saveDocuments([doc]);
    fixture.setWorkspace("list-B");
    client.saveDocuments([document("B", "B")]);
    const beforeB = fixture.lastCacheSnapshot();
    fixture.setWorkspace("list-A");
    globalThis.fetch = (async (input) => {
      assert.equal(String(input), "/api/documents?space_id=list-A");
      entered.resolve();
      await release.promise;
      return Response.json([doc]);
    }) as typeof fetch;
    const read = client.loadDocumentsFromApi();
    await entered.promise;
    client.saveDocuments([
      { ...doc, content: "new draft", updatedAt: "2030-01-01T00:00:00.000Z" },
    ]);
    fixture.setWorkspace("list-B");
    release.resolve();
    const returned = await read;
    expect(fixture.cacheBytes(beforeB.key)).toBe(beforeB.bytes);
    fixture.setWorkspace("list-A");
    expect({
      returned: returned[0].content,
      cache: client.getDocument(doc.id)?.content,
    }).toEqual({ returned: "new draft", cache: "new draft" });
  } finally {
    release.resolve();
    fixture.restore();
  }
});

test("ACK adoption compares the submitted draft, not only a reused timestamp", async () => {
  const fixture = installFixture("same-stamp");
  const entered = deferred(),
    release = deferred();
  let pending: Promise<unknown> | undefined;
  try {
    const doc = document("same-stamp-doc", "initial");
    const remote = server(doc);
    client.saveDocuments([doc]);
    remote.hold(async () => {
      entered.resolve();
      await release.promise;
    });
    pending = client.updateDocumentInStorage(doc.id, { content: "submitted" });
    await entered.promise;
    const draft = client.getDocument(doc.id)!;
    client.saveDocuments([{ ...draft, content: "new local content" }]);
    release.resolve();
    await pending;
    expect(client.getDocument(doc.id)?.content).toBe("new local content");
    expect((await remote.store.get(doc.id))?.content).toBe("submitted");
  } finally {
    release.resolve();
    await pending?.catch(() => {});
    fixture.restore();
  }
});

test("a debounced writer captured in A sends and caches only in A after navigation to B", async () => {
  const fixture = installFixture("writer-A");
  try {
    const doc = document("captured-writer", "old");
    const remote = server(doc);
    const writeFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = ((input, init) => {
      urls.push(String(input));
      return writeFetch(input, init);
    }) as typeof fetch;
    client.saveDocuments([doc]);
    const write = client.captureDocumentWriter(doc.id);
    fixture.setWorkspace("writer-B");
    client.saveDocuments([document("B-only", "B")]);
    const beforeB = fixture.lastCacheSnapshot();
    await write({ content: "A change" });
    expect(urls).toEqual(["/api/documents/captured-writer?space_id=writer-A"]);
    expect(fixture.cacheBytes(beforeB.key)).toBe(beforeB.bytes);
    fixture.setWorkspace("writer-A");
    const persisted = await remote.store.get(doc.id);
    assert(persisted);
    expect(client.getDocument(doc.id)).toEqual(persisted);
  } finally {
    fixture.restore();
  }
});

test("an in-flight document does not serialize an unrelated document behind it", async () => {
  const fixture = installFixture("independent-docs");
  const entered = deferred(),
    release = deferred();
  const pending: Promise<unknown>[] = [];
  try {
    const a = document("independent-A", "A");
    const remote = server(a);
    const b = await remote.store.upsert(document("independent-B", "B"));
    client.saveDocuments([a, b]);
    remote.hold(async (n) => {
      if (n === 1) {
        entered.resolve();
        await release.promise;
      }
    });
    pending.push(client.updateDocumentInStorage(a.id, { content: "A edit" }));
    await entered.promise;
    let bFinished = false;
    pending.push(
      client
        .updateDocumentInStorage(b.id, { content: "B edit" })
        .then((value) => {
          bFinished = true;
          return value;
        }),
    );
    // Drain immediate async mock I/O, without releasing A or a timing SLA.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(bFinished).toBe(true);
    expect((await remote.store.get(b.id))?.content).toBe("B edit");
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    fixture.restore();
  }
});

test("opening a newly created document waits for its real create ACK instead of a premature404", async () => {
  const fixture = installFixture("opening-create");
  const entered = deferred(),
    release = deferred();
  const pending: Promise<unknown>[] = [];
  try {
    const doc = document("opening-doc", "created draft");
    const remote = server();
    remote.hold(async () => {
      entered.resolve();
      await release.promise;
    });
    const create = client.addDocument(doc);
    pending.push(create);
    await entered.promise;
    const open = client.loadDocumentFromApi(doc.id);
    pending.push(open);
    const observed = open.then(
      (doc) => doc.content,
      () => "premature read failure",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    await create;
    expect(await observed).toBe("created draft");
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    fixture.restore();
  }
});

test("a failed create stays recoverable and explicit retry creates only after a fresh404", async () => {
  const fixture = installFixture("retry-create");
  try {
    const doc = document("retry-create-doc", "unsaved creation");
    const remote = server();
    remote.hold(async () => {
      throw new Error("synthetic failure before effect");
    });
    await expect(client.addDocument(doc)).rejects.toThrow();
    expect((await client.loadDocumentFromApi(doc.id)).content).toBe(
      "unsaved creation",
    );
    expect(client.getDocumentSaveState(doc.id)).toBe("failed");
    remote.hold(async () => {});
    await client.retryDocumentAfterConflict(doc.id);
    expect({
      stored: (await remote.store.get(doc.id))?.content,
      createOnly: remote.requests[1]?.create,
      expected: remote.requests[1]?.expected,
    }).toEqual({ stored: "unsaved creation", createOnly: "*", expected: null });
  } finally {
    fixture.restore();
  }
});
