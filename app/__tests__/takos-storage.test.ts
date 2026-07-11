import { afterEach, expect, test } from "bun:test";
import { createTakosStorageClient } from "../shared/lib/takos-storage.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function installObjectStoreFetch(expectedToken = "token") {
  const objects = new Map<string, string>();
  const urls: string[] = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    urls.push(url.toString());
    if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
      return Response.json({ error: "invalid_token" }, { status: 401 });
    }
    if (url.pathname === "/o" || url.pathname === "/o/") {
      const prefix = url.searchParams.get("prefix") ?? "";
      return Response.json({
        objects: [...objects.entries()].flatMap(([key, body]) =>
          key.startsWith(prefix) ? [{ key, size: body.length }] : [],
        ),
        truncated: false,
      });
    }
    if (!url.pathname.startsWith("/o/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const key = decodeURIComponent(url.pathname.slice(3));
    if (request.method === "PUT") {
      objects.set(key, await request.text());
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
    return new Response(body, {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { objects, urls };
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
  // encodeKeyPart(fileId) = encodeURIComponent with "%" folded to "~": the
  // malicious "/" separators become "~2F", so the whole id stays ONE key
  // segment under space-A's records prefix.
  const maliciousKey =
    "office/v1/records/space-A/..~2F..~2Fspace-B~2Fstorage~2Fsecret.json";
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
