import { afterEach, expect, test } from "bun:test";
import { createTakosStorageClient } from "../shared/lib/takos-storage.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function installObjectStoreFetch(
  expectedToken = "token",
  options: { pageSize?: number; holdReads?: boolean } = {},
) {
  const objects = new Map<string, string>();
  const etags = new Map<string, string>();
  const urls: string[] = [];
  const requests: Request[] = [];
  let revision = 0;
  let inFlightReads = 0;
  let maxInFlightReads = 0;
  const heldReads: Array<() => void> = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    urls.push(url.toString());
    requests.push(request);
    if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    if (url.pathname === "/o" || url.pathname === "/o/") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const cursor = url.searchParams.get("cursor");
      const matching = [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      const offset = cursor ? Number(cursor) : 0;
      const pageSize = options.pageSize ?? matching.length;
      const page = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      return Response.json({
        objects: page.map(([key, body]) => ({ key, size: body.length })),
        truncated: nextOffset < matching.length,
        ...(nextOffset < matching.length ? { cursor: String(nextOffset) } : {}),
      });
    }
    if (!url.pathname.startsWith("/o/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const key = decodeURIComponent(url.pathname.slice(3));
    if (request.method === "PUT") {
      const currentEtag =
        etags.get(key) ?? (objects.has(key) ? '"seed"' : undefined);
      const ifMatch = request.headers.get("if-match");
      const ifNoneMatch = request.headers.get("if-none-match");
      if (
        (ifMatch && ifMatch !== currentEtag) ||
        (ifNoneMatch === "*" && objects.has(key))
      ) {
        return Response.json({ error: "precondition_failed" }, { status: 412 });
      }
      objects.set(key, await request.text());
      revision += 1;
      etags.set(key, `"r${revision}"`);
      return Response.json({ ok: true, key }, { status: 201 });
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      return Response.json({ ok: true, key });
    }
    const body = objects.get(key);
    if (body === undefined) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    inFlightReads += 1;
    maxInFlightReads = Math.max(maxInFlightReads, inFlightReads);
    if (options.holdReads) {
      await new Promise<void>((resolve) => heldReads.push(resolve));
    }
    inFlightReads -= 1;
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        etag: etags.get(key) ?? '"seed"',
      },
    });
  }) as typeof fetch;
  return {
    objects,
    etags,
    urls,
    requests,
    heldReads,
    maxInFlightReads: () => maxInFlightReads,
  };
}

test("Office records round-trip through the storage.object /o API", async () => {
  const store = installObjectStoreFetch();
  const client = createTakosStorageClient(
    "https://storage.example/o",
    "token",
    "space-A",
    "workspace/capsule/",
  );

  const folder = await client.createFolder("takos-docs");
  const file = await client.create("report.takosdoc", folder.id, {
    content: "first",
    mimeType: "application/vnd.takos.document+json",
  });

  expect((await client.list()).map((entry) => entry.name)).toEqual([
    "takos-docs",
  ]);
  expect((await client.list("takos-docs")).map((entry) => entry.id)).toEqual([
    file.id,
  ]);
  expect(await client.getContent(file.id)).toBe("first");

  await client.putContent(file.id, "second");
  expect(await client.getContent(file.id)).toBe("second");
  await client.rename(file.id, "renamed.takosdoc");
  expect((await client.get(file.id))?.name).toBe("renamed.takosdoc");

  await client.delete(folder.id);
  expect(await client.get(folder.id)).toBeNull();
  expect(await client.get(file.id)).toBeNull();
  expect(store.objects.size).toBe(0);
  expect(store.urls.every((url) => !url.includes("/api/spaces/"))).toBe(true);
});

test("Office object keys stay inside the assigned consumer prefix", async () => {
  const { objects, urls } = installObjectStoreFetch();
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "../../other-space",
    "workspace/capsule/",
  );

  const file = await client.create("safe.txt", undefined, { content: "ok" });
  await client.get("../../other-consumer");

  expect(file.path).toBe("safe.txt");
  expect(
    [...objects.keys()].every((key) =>
      key.startsWith("workspace/capsule/office/v1/records/"),
    ),
  ).toBe(true);
  expect(urls.every((url) => new URL(url).pathname.startsWith("/o"))).toBe(
    true,
  );
});

test("storage client key-encodes fileId so a traversal id cannot escape the space records prefix", async () => {
  const { objects, urls } = installObjectStoreFetch();
  const client = createTakosStorageClient(
    "https://takos.example",
    "token",
    "space-A",
  );
  const maliciousId = "../../space-B/storage/secret";
  // encodeKeyPart(fileId) leaves encodeURIComponent's percent escapes intact:
  // the malicious "/" separators become "%2F", so the whole id stays ONE key
  // segment under space-A's records prefix.
  const maliciousKey =
    "office/v1/records/space-A/..%2F..%2Fspace-B%2Fstorage%2Fsecret.json";
  const now = "2026-04-30T00:00:00.000Z";
  objects.set(
    maliciousKey,
    JSON.stringify({
      schema: "takos.office.object-record.v1",
      file: {
        id: maliciousId,
        name: "secret.takosdoc",
        type: "file",
        createdAt: now,
        updatedAt: now,
      },
      content: "body",
    }),
  );

  await client.get(maliciousId);
  await client.getContent(maliciousId);
  await client.putContent(maliciousId, "overwritten");
  await client.delete(maliciousId);

  const base = "https://takos.example/o";
  const spacePrefix = "office/v1/records/space-A/";
  expect(urls.length > 0).toBe(true);
  for (const url of urls) {
    expect(
      url.startsWith(`${base}?prefix=`) || url.startsWith(`${base}/`),
    ).toBe(true);
    if (url.startsWith(`${base}?prefix=`)) {
      // Listings stay scoped to space-A's records prefix.
      expect(decodeURIComponent(url.slice(`${base}?prefix=`.length))).toBe(
        spacePrefix,
      );
      continue;
    }
    // Every object request targets `<base>/<one url-encoded key>`: the tail
    // is a SINGLE path segment (no raw "/", no query smuggling).
    const tail = url.slice(`${base}/`.length);
    expect(tail.includes("/")).toBe(false);
    expect(tail.includes("?")).toBe(false);
    // Decoding that segment once yields a key inside space-A's prefix whose
    // fileId part contains no raw "/" — the id cannot introduce a
    // `.../space-B/...` segment to escape into another space's prefix.
    const key = decodeURIComponent(tail);
    expect(key.startsWith(spacePrefix)).toBe(true);
    expect(key.slice(spacePrefix.length).includes("/")).toBe(false);
  }
  // The malicious id resolved to exactly the expected single-segment key ...
  expect(urls).toContain(`${base}/${encodeURIComponent(maliciousKey)}`);
  // ... and the delete removed only that record inside space-A's prefix.
  expect(objects.size).toBe(0);
});

test("storage client maps a normal UUID id to its space-scoped record key", async () => {
  const { objects, urls } = installObjectStoreFetch();
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const key = `office/v1/records/space-A/${id}.json`;
  const now = "2026-04-30T00:00:00.000Z";
  objects.set(
    key,
    JSON.stringify({
      schema: "takos.office.object-record.v1",
      file: {
        id,
        name: `${id}.takosdoc`,
        type: "file",
        createdAt: now,
        updatedAt: now,
      },
      content: "body",
    }),
  );
  const client = createTakosStorageClient(
    "https://takos.example",
    "token",
    "space-A",
  );

  const file = await client.get(id);

  expect(urls[0]).toBe(`https://takos.example/o/${encodeURIComponent(key)}`);
  expect(file?.id).toBe(id);
});

test("storage key encoding is injective for literal escape-like ids", async () => {
  const { objects } = installObjectStoreFetch();
  const client = createTakosStorageClient(
    "https://takos.example",
    "token",
    "space-A",
  );
  const now = "2026-04-30T00:00:00.000Z";
  const seed = (id: string, content: string) =>
    JSON.stringify({
      schema: "takos.office.object-record.v1",
      revision: `revision:${id}`,
      file: {
        id,
        name: `${content}.txt`,
        type: "file",
        createdAt: now,
        updatedAt: now,
      },
      content,
    });
  objects.set("office/v1/records/space-A/%2F.json", seed("/", "slash"));
  objects.set("office/v1/records/space-A/%252F.json", seed("%2F", "literal"));

  expect(await client.getContent("/")).toBe("slash");
  expect(await client.getContent("%2F")).toBe("literal");
  expect(objects.size).toBe(2);
});

test("listing follows opaque cursors until all Office records are visible", async () => {
  const store = installObjectStoreFetch("token", { pageSize: 1 });
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
  );
  await client.create("one.txt");
  await client.create("two.txt");
  await client.create("three.txt");

  expect((await client.list()).map((file) => file.name).sort()).toEqual([
    "one.txt",
    "three.txt",
    "two.txt",
  ]);
  expect(store.urls.some((url) => url.includes("cursor="))).toBe(true);
});

test("record body reads use bounded concurrency", async () => {
  const store = installObjectStoreFetch("token", {
    pageSize: 100,
    holdReads: true,
  });
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
  );
  for (let index = 0; index < 20; index += 1) {
    const now = "2026-04-30T00:00:00.000Z";
    store.objects.set(
      `office/v1/records/space-A/file-${index}.json`,
      JSON.stringify({
        schema: "takos.office.object-record.v1",
        revision: `seed-${index}`,
        file: {
          id: `file-${index}`,
          name: `file-${index}.txt`,
          type: "file",
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  }

  let done = false;
  const listing = client.list().finally(() => {
    done = true;
  });
  while (store.heldReads.length === 0) await Promise.resolve();
  expect(store.maxInFlightReads()).toBeLessThanOrEqual(8);
  while (!done) {
    store.heldReads.splice(0).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await listing;
  expect(store.maxInFlightReads()).toBe(8);
});

test("folder creation is deterministic and create-only", async () => {
  const store = installObjectStoreFetch();
  const a = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
  );
  const b = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
  );

  const [first, second] = await Promise.all([
    a.createFolder("takos-docs"),
    b.createFolder("takos-docs"),
  ]);

  expect(first.id).toBe(second.id);
  expect(store.objects.size).toBe(1);
  expect(
    store.requests
      .filter((request) => request.method === "PUT")
      .every((request) => request.headers.get("if-none-match") === "*"),
  ).toBe(true);
});

test("content update uses the object ETag as an atomic precondition", async () => {
  const store = installObjectStoreFetch();
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
  );
  const file = await client.create("report.txt", undefined, {
    content: "first",
  });
  await client.putContent(file.id, "second");

  const update = store.requests
    .filter((request) => request.method === "PUT")
    .at(-1);
  expect(update?.headers.get("if-match")).toMatch(/^"r\d+"$/);
});

test("delete refuses a stale Office record revision", async () => {
  const store = installObjectStoreFetch();
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
  );
  const created = await client.create("report.txt", undefined, {
    content: "first",
  });
  const current = await client.get(created.id);
  expect(current?.revision).toBeDefined();

  await client.putContent(created.id, "second");
  await expect(
    client.delete(created.id, { expectedRevision: current!.revision }),
  ).rejects.toThrow("modified by another writer");
  expect(store.objects.size).toBe(1);
});

test("get hides only a missing object, not authentication failures", async () => {
  installObjectStoreFetch("different-token");
  const client = createTakosStorageClient(
    "https://storage.example/o",
    "token",
    "space-A",
    "workspace/capsule/",
  );

  await expect(client.get("missing")).rejects.toThrow(
    "Object storage API error: 401",
  );
});

test("record reads reject oversized JSON before parsing it", async () => {
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
    "",
    {
      fetchImpl: async () =>
        new Response("{}", {
          headers: {
            "content-length": String(10 * 1024 * 1024),
            etag: '"r1"',
          },
        }),
    },
  );

  await expect(client.get("too-large")).rejects.toThrow(
    "Object storage JSON response exceeded",
  );
});

test("record identity must match the object key", async () => {
  const now = "2026-04-30T00:00:00.000Z";
  const client = createTakosStorageClient(
    "https://storage.example",
    "token",
    "space-A",
    "",
    {
      fetchImpl: async () =>
        Response.json(
          {
            schema: "takos.office.object-record.v1",
            revision: "r1",
            file: {
              id: "different-file",
              name: "swapped.txt",
              type: "file",
              createdAt: now,
              updatedAt: now,
            },
          },
          { headers: { etag: '"r1"' } },
        ),
    },
  );

  await expect(client.get("expected-file")).rejects.toThrow(
    "does not match its object key",
  );
});
