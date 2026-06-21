import { expect, test } from "bun:test";
import {
  isFetchableImageHost,
  loadImageForExport,
  parseDataImageUrl,
} from "../lib/image-loader.ts";

test("parseDataImageUrl accepts supported base64 image data URLs", () => {
  const url =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const parsed = parseDataImageUrl(url);
  expect(parsed?.format).toBe("PNG");
  expect(parsed?.dataUrl).toBe(url);
});

test("parseDataImageUrl rejects non-image / malformed data URLs", () => {
  expect(parseDataImageUrl("https://example.com/a.png")).toBeNull();
  expect(parseDataImageUrl("data:text/plain;base64,aGk=")).toBeNull();
  expect(parseDataImageUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
});

test("isFetchableImageHost blocks SSRF targets", () => {
  for (
    const blocked of [
      "http://localhost/a.png",
      "http://127.0.0.1/a.png",
      "http://10.0.0.5/a.png",
      "http://192.168.1.10/a.png",
      "http://172.16.4.4/a.png",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/a.png",
      "http://service.internal/a.png",
    ]
  ) {
    expect(isFetchableImageHost(blocked)).toBe(false);
  }
});

test("isFetchableImageHost allows public hosts", () => {
  expect(isFetchableImageHost("https://example.com/a.png")).toBe(true);
  expect(isFetchableImageHost("https://cdn.example.org/x/y.jpg")).toBe(true);
  expect(isFetchableImageHost("http://8.8.8.8/a.png")).toBe(true);
});

test("loadImageForExport returns the inline image without fetching", async () => {
  const url =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  let called = false;
  const noFetch = () => {
    called = true;
    throw new Error("should not fetch for data URLs");
  };
  const loaded = await loadImageForExport(url, noFetch);
  expect(loaded?.dataUrl).toBe(url);
  expect(called).toBe(false);
});

test("loadImageForExport refuses to fetch a private host", async () => {
  let called = false;
  const noFetch = () => {
    called = true;
    throw new Error("should not fetch a blocked host");
  };
  const loaded = await loadImageForExport("http://10.1.2.3/a.png", noFetch);
  expect(loaded).toBeNull();
  expect(called).toBe(false);
});

test("loadImageForExport rejects non-image content types", async () => {
  const htmlFetch = () =>
    Promise.resolve(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
  const loaded = await loadImageForExport(
    "https://example.com/page.html",
    htmlFetch,
  );
  expect(loaded).toBeNull();
});

test("loadImageForExport embeds a fetched image as a data URL", async () => {
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const okFetch = () =>
    Promise.resolve(
      new Response(pngBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
  const loaded = await loadImageForExport(
    "https://example.com/a.png",
    okFetch,
  );
  expect(loaded?.format).toBe("PNG");
  expect(loaded?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
});
