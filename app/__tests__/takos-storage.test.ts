import { afterEach, expect, test } from "bun:test";
import { createTakosStorageClient } from "../shared/lib/takos-storage.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureFetchUrls(): string[] {
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(typeof input === "string" ? input : input.toString());
    return Promise.resolve(
      new Response(JSON.stringify({ file: { id: "x", name: "x", type: "file" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return urls;
}

test("storage client percent-encodes fileId so a traversal id cannot escape the space path", async () => {
  const urls = captureFetchUrls();
  const client = createTakosStorageClient(
    "https://takos.example",
    "token",
    "space-A",
  );

  // A path-traversal id must NOT rewrite the /api/spaces/space-A/storage/ prefix.
  await client.get("../../space-B/storage/secret");
  await client.getContent("../../space-B/storage/secret");
  await client.delete("../../space-B/storage/secret");

  const prefix = "https://takos.example/api/spaces/space-A/storage/";
  for (const url of urls) {
    expect(url.startsWith(prefix)).toBe(true);
    // The slashes in the malicious id are percent-encoded, so everything after
    // the space-scoped prefix stays a SINGLE path segment (no traversal, no
    // /space-B/ segment).
    const tail = url.slice(prefix.length).split("?")[0].replace(/\/content$/, "");
    expect(tail.includes("/")).toBe(false);
  }
});

test("storage client leaves a normal UUID id intact", async () => {
  const urls = captureFetchUrls();
  const client = createTakosStorageClient(
    "https://takos.example",
    "token",
    "space-A",
  );
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  await client.get(id);
  expect(urls[0]).toBe(
    `https://takos.example/api/spaces/space-A/storage/${id}`,
  );
});
