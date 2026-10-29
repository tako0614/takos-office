import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { createOfficeApp } from "../server.ts";

// Home-screen install contract. app/public/ is collected into the Worker asset
// map at the root by app/build-worker.ts, which also probes the built Worker for
// these routes and their content types.
const PUBLIC_DIR = new URL("../public/", import.meta.url);
const EDITOR_PAGES = ["docs", "sheet", "slide"] as const;
const MANIFEST_LINK = '<link rel="manifest" href="/manifest.webmanifest" />';
const TOUCH_ICON_LINK =
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />';

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

function manifest(): { icons: ManifestIcon[] } & Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL("manifest.webmanifest", PUBLIC_DIR), "utf8"),
  );
}

function pngSize(path: string): { width: number; height: number } {
  expect(path.startsWith("/")).toBe(true);
  const bytes = new Uint8Array(readFileSync(new URL(path.slice(1), PUBLIC_DIR)));
  // PNG signature, then the IHDR chunk: width/height are big-endian u32 at 16/20.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

test("one suite-wide manifest covers the shell and every editor", () => {
  expect(manifest()).toMatchObject({
    id: "/",
    name: "Takos Office",
    short_name: "Office",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#ffffff",
    background_color: "#f7f8fa",
  });
  expect(String(manifest().description).length).toBeGreaterThan(0);
});

test("every declared icon exists at its declared pixel size", () => {
  const icons = manifest().icons;
  expect(icons.map((icon) => `${icon.sizes}:${icon.purpose}`).sort()).toEqual([
    "192x192:any",
    "512x512:any",
    "512x512:maskable",
  ]);
  for (const icon of icons) {
    expect(icon.type).toBe("image/png");
    const [width, height] = icon.sizes.split("x").map(Number);
    expect(pngSize(icon.src)).toEqual({ width, height });
  }
  expect(pngSize("/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
});

test("each editor page links the manifest, apple-touch-icon and theme-color", () => {
  for (const editor of EDITOR_PAGES) {
    const html = readFileSync(
      new URL(`../${editor}/index.html`, import.meta.url),
      "utf8",
    );
    expect(html).toContain(MANIFEST_LINK);
    expect(html).toContain(TOUCH_ICON_LINK);
    expect(html).toContain('<meta name="theme-color" content="#');
  }
});

test("the shell page at / links the same manifest", async () => {
  const { app } = createOfficeApp({ ALLOW_UNAUTHENTICATED_ACCESS: "1" });
  const response = await app.request("/");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(MANIFEST_LINK);
  expect(html).toContain(TOUCH_ICON_LINK);
  expect(html).toContain('<meta name="theme-color" content="#ffffff"');
});
