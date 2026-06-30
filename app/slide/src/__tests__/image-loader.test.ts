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

test("isFetchableImageHost blocks IPv4-mapped/embedded IPv6 SSRF targets", () => {
  for (
    const blocked of [
      "http://[::ffff:127.0.0.1]/a.png", // mapped loopback
      "http://[::ffff:7f00:1]/a.png", // mapped loopback (hex form)
      "http://[::ffff:169.254.169.254]/latest/meta-data", // mapped metadata
      "http://[::ffff:10.0.0.5]/a.png", // mapped RFC1918
      "http://[::ffff:192.168.1.10]/a.png",
      "http://[::]/a.png", // unspecified
      "http://[fe80::1]/a.png", // link-local
      "http://[fc00::1]/a.png", // unique-local
      "http://[fd12:3456::1]/a.png", // unique-local
      "http://[ff02::1]/a.png", // multicast
      "http://[::127.0.0.1]/a.png", // deprecated v4-compatible loopback
    ]
  ) {
    expect(isFetchableImageHost(blocked)).toBe(false);
  }
});

test("isFetchableImageHost still allows public IPv6 (incl. mapped public v4)", () => {
  expect(isFetchableImageHost("http://[2606:4700::1]/a.png")).toBe(true);
  expect(isFetchableImageHost("http://[::ffff:8.8.8.8]/a.png")).toBe(true);
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

test("loadImageForExport never issues the internal request on a redirect to a private host", async () => {
  const requested: string[] = [];
  const redirectingFetch = (input: string) => {
    requested.push(input);
    if (input === "https://example.com/a.png") {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
      );
    }
    throw new Error("internal host must never be fetched");
  };
  const loaded = await loadImageForExport(
    "https://example.com/a.png",
    redirectingFetch,
  );
  expect(loaded).toBeNull();
  expect(requested).toEqual(["https://example.com/a.png"]);
});

test("loadImageForExport follows a redirect to another public host", async () => {
  const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const requested: string[] = [];
  const redirectingFetch = (input: string) => {
    requested.push(input);
    if (input === "https://example.com/a.png") {
      return Promise.resolve(
        new Response(null, {
          status: 301,
          headers: { location: "https://cdn.example.org/a.png" },
        }),
      );
    }
    return Promise.resolve(
      new Response(pngBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
  };
  const loaded = await loadImageForExport(
    "https://example.com/a.png",
    redirectingFetch,
  );
  expect(loaded?.format).toBe("PNG");
  expect(requested).toEqual([
    "https://example.com/a.png",
    "https://cdn.example.org/a.png",
  ]);
});

test("loadImageForExport rejects a redirect loop exceeding the hop cap", async () => {
  let count = 0;
  const loopingFetch = () => {
    count++;
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: `https://example.com/hop-${count}.png` },
      }),
    );
  };
  const loaded = await loadImageForExport(
    "https://example.com/start.png",
    loopingFetch,
  );
  expect(loaded).toBeNull();
  // Initial request + at most MAX_REDIRECTS (5) follow-ups.
  expect(count).toBeLessThanOrEqual(6);
});

test("loadImageForExport rejects a redirect with no Location header", async () => {
  const noLocationFetch = () =>
    Promise.resolve(new Response(null, { status: 302 }));
  const loaded = await loadImageForExport(
    "https://example.com/a.png",
    noLocationFetch,
  );
  expect(loaded).toBeNull();
});
