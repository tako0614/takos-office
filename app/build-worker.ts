/**
 * Unified Takos Office worker bundler.
 *
 * Collects the three editor SPA builds (app/{docs,slide,sheet}/dist) into one
 * base64 asset map keyed by their served subpath (docs/…, slide/…, sheet/…),
 * generates a worker entry that delegates app routes to the unified Hono app
 * and serves static assets / per-editor SPA fallbacks, then esbuilds it to
 * dist/worker.js.
 *
 * Run after the three `vite build`s (see package.json `build:spa`).
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { build, stop } from "esbuild";

type StaticAsset = { contentType: string; body: string };

const outDir = new URL("../dist/", import.meta.url);
const tempEntryFile = new URL(
  "../dist/worker-entry.generated.ts",
  import.meta.url,
);
const workerFile = new URL("../dist/worker.js", import.meta.url);

const editors = ["docs", "slide", "sheet"] as const;
const assets: Record<string, StaticAsset> = {};

function contentTypeFor(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function collectAssets(dir: URL, prefix: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(
      `Missing build output at ${dir.pathname} — run the SPA builds first (bun run build:spa).`,
    );
  }
  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    const url = new URL(entry.name, dir);
    if (entry.isDirectory()) {
      await collectAssets(new URL(`${entry.name}/`, dir), `${relativePath}/`);
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = await readFile(url);
    assets[relativePath] = {
      contentType: contentTypeFor(relativePath),
      body: bytesToBase64(bytes),
    };
  }
}

function createEntrySource(): string {
  return `import { createOfficeApp } from "../app/server.ts";
import type { OfficeRuntimeEnv } from "../app/server.ts";

const EDITORS = ${JSON.stringify(editors)};
const ASSETS = ${JSON.stringify(assets)};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isNavigationRequest(request) {
  return request.method === "GET" &&
    (request.headers.get("accept") ?? "").includes("text/html");
}

function hasFileExtension(pathname) {
  const segment = pathname.split("/").pop() ?? "";
  return segment.includes(".");
}

function isAppRoute(pathname) {
  if (pathname === "/" || pathname === "/mcp" || pathname === "/health" || pathname === "/healthz") {
    return true;
  }
  if (pathname.includes("/api/") || pathname.includes("/files/")) return true;
  if (pathname.endsWith("/mcp") || pathname.endsWith("/health") || pathname.endsWith("/healthz")) {
    return true;
  }
  return false;
}

function resolveAssetPath(pathname) {
  let p = decodeURIComponent(pathname);
  if (p === "" || p === "/") return "index.html";
  if (p.endsWith("/")) p += "index.html";
  return p.startsWith("/") ? p.slice(1) : p;
}

function spaFallback(pathname) {
  const seg = pathname.split("/")[1];
  return EDITORS.includes(seg) ? seg + "/index.html" : null;
}

function assetResponse(assetPath, request) {
  const asset = ASSETS[assetPath];
  if (!asset) return new Response("Not found", { status: 404 });
  const body = request.method === "HEAD" ? null : decodeBase64(asset.body);
  return new Response(body, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": assetPath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    },
  });
}

let app = null;
function getApp(env) {
  app ??= createOfficeApp(env).app;
  return app;
}

function withManagedWorkerDefaults(env) {
  return { ...env, TAKOS_NATIVE_RENDERING: env.TAKOS_NATIVE_RENDERING ?? "0" };
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isAppRoute(url.pathname)) {
      const runtimeEnv = withManagedWorkerDefaults(env);
      return getApp(runtimeEnv).fetch(request, runtimeEnv, ctx);
    }
    const assetPath = resolveAssetPath(url.pathname);
    if (ASSETS[assetPath]) return assetResponse(assetPath, request);
    if (!hasFileExtension(assetPath) && isNavigationRequest(request)) {
      const fallback = spaFallback(url.pathname);
      if (fallback && ASSETS[fallback]) return assetResponse(fallback, request);
    }
    return new Response("Not found", { status: 404 });
  },
};
`;
}

for (const editor of editors) {
  await collectAssets(
    new URL(`./${editor}/dist/`, import.meta.url),
    `${editor}/`,
  );
}
await mkdir(outDir, { recursive: true });
await writeFile(tempEntryFile, createEntrySource());

try {
  await build({
    entryPoints: [tempEntryFile.pathname],
    outfile: workerFile.pathname,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    external: ["canvas", "node:*"],
    logLevel: "warning",
  });
  // eslint-disable-next-line no-console
  console.log(
    `Built ${workerFile.pathname} (${Object.keys(assets).length} assets)`,
  );
} finally {
  stop();
  await rm(tempEntryFile).catch(() => undefined);
}

void outDir;
