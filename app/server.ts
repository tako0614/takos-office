/**
 * Unified Takos Office worker.
 *
 * Mounts the three editor sub-apps under subpaths and exposes one office-wide
 * MCP endpoint:
 *   - GET  /healthz          — readiness probe (manifest readiness)
 *   - GET  /                 — redirect to /docs
 *   - POST /mcp              — unified MCP (docs + slide + sheet tools)
 *   - /docs/*                — takos-docs SPA + /docs/api/* + /docs/files/:id
 *   - /slide/*               — takos-slide SPA + /slide/api/* + /slide/files/:id
 *   - /sheet/*               — takos-excel SPA + /sheet/api/* + /sheet/files/:id
 *
 * Each editor sub-app keeps its own per-space stores and auth; the unified
 * /mcp builds the three space-scoped stores itself and aggregates their tools.
 */

import { Hono } from "hono";
import type { Context } from "hono";

import { createDocsApp } from "./docs/src/server.ts";
import { createSlideAppFromEnv } from "./slide/src/server.ts";
import { createExcelAppFromEnv } from "./sheet/src/server.ts";

import { createTakosStorageClient } from "./shared/lib/takos-storage.ts";
import { TakosDocumentStore } from "./docs/src/document-store.ts";
import { createPresentationStore } from "./slide/src/presentation-store.ts";
import { SpreadsheetStore } from "./sheet/src/spreadsheet-store.ts";

import { createOfficeMcpServer } from "./mcp.ts";
import {
  createMcpRequestHandler,
  mcpAuthMisconfigured,
} from "./shared/mcp-factory.ts";
import { appAuthMisconfigured } from "./shared/app-auth.ts";

export type OfficeRuntimeEnv = Record<string, string | undefined>;

export type OfficeServerOptions = {
  port?: number;
  shutdownGraceMs?: number;
};

type ProcessLike = {
  env?: Record<string, string | undefined>;
  exit?: (code?: number) => never;
  on?: (event: "SIGTERM" | "SIGINT", listener: () => void) => void;
};

type BunLike = {
  serve(options: {
    port: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }): { stop: (closeActiveConnections?: boolean) => void };
};

function processLike(): ProcessLike | undefined {
  return (globalThis as { process?: ProcessLike }).process;
}

function bunLike(): BunLike {
  const bun = (globalThis as { Bun?: BunLike }).Bun;
  if (!bun) throw new Error("Bun runtime is required to start takos-office");
  return bun;
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function runtimeEnv(): OfficeRuntimeEnv {
  return { ...(processLike()?.env ?? {}) };
}

function envValue(env: OfficeRuntimeEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function requiredEnv(env: OfficeRuntimeEnv, name: string): string {
  const value = envValue(env, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function envFlagEnabled(env: OfficeRuntimeEnv, name: string): boolean {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}

function nativeRenderingEnabled(env: OfficeRuntimeEnv): boolean {
  const value = envValue(env, "TAKOS_NATIVE_RENDERING");
  if (value) return ["1", "true", "yes"].includes(value.toLowerCase());
  return isBunRuntime();
}

export function createOfficeApp(env: OfficeRuntimeEnv = runtimeEnv()) {
  const app = new Hono();

  // ---- Office-wide readiness probe ----
  const health = (c: Context) => {
    const authError = appAuthMisconfigured(env);
    if (authError) return authError;
    const mcpAuthError = mcpAuthMisconfigured(
      envValue(env, "MCP_AUTH_TOKEN"),
      envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
    );
    if (mcpAuthError) return mcpAuthError;
    return c.json({ status: "ok", service: "takos-office" });
  };
  app.get("/health", health);
  app.get("/healthz", health);

  // ---- Root → default editor ----
  app.get("/", (c) => c.redirect("/docs"));

  // ---- Unified office MCP (docs + slide + sheet) ----
  const apiUrl =
    envValue(env, "TAKOS_STORAGE_API_URL") ||
    envValue(env, "TAKOS_API_URL") ||
    "http://localhost:8787";
  const token =
    envValue(env, "TAKOS_STORAGE_ACCESS_TOKEN") ||
    requiredEnv(env, "TAKOS_ACCESS_TOKEN");
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  const mcpHandlers = new Map<
    string,
    (request: Request) => Promise<Response>
  >();

  app.all("/mcp", (c) => {
    const configError = mcpAuthMisconfigured(
      envValue(env, "MCP_AUTH_TOKEN"),
      envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
    );
    if (configError) return configError;
    const spaceId =
      c.req.query("space_id") ?? c.req.query("spaceId") ?? defaultSpaceId;
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);

    let handler = mcpHandlers.get(spaceId);
    if (!handler) {
      const client = createTakosStorageClient(apiUrl, token, spaceId);
      const docsStore = new TakosDocumentStore(client);
      const slideStore = createPresentationStore(client);
      const sheetStore = new SpreadsheetStore(client);
      handler = createMcpRequestHandler(
        () =>
          createOfficeMcpServer({
            docsStore,
            slideStore,
            sheetStore,
            nativeRendering: nativeRenderingEnabled(env),
          }),
        {
          authToken: envValue(env, "MCP_AUTH_TOKEN"),
          allowUnauthenticated: envFlagEnabled(
            env,
            "MCP_ALLOW_UNAUTHENTICATED",
          ),
        },
      );
      mcpHandlers.set(spaceId, handler);
    }
    return handler(c.req.raw);
  });

  // ---- Mount editor sub-apps (UI + /api/* + /files/:id under each prefix) ----
  app.route("/docs", createDocsApp(env).app);
  app.route("/slide", createSlideAppFromEnv(env));
  app.route("/sheet", createExcelAppFromEnv(env));

  return { app };
}

export function startOfficeServer(options: OfficeServerOptions = {}) {
  const env = runtimeEnv();
  const port = options.port ?? parseInt(envValue(env, "PORT") ?? "8787", 10);
  const { app } = createOfficeApp(env);
  const server = bunLike().serve({
    port,
    fetch: (request) => app.fetch(request),
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ event: "takos-office.listening", port }));

  const shutdownGraceMs =
    options.shutdownGraceMs ??
    parseInt(envValue(env, "SHUTDOWN_GRACE_MS") ?? "15000", 10);
  const shutdown = (signal: string) => {
    server.stop(false);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: "takos-office.shutdown", signal }));
    processLike()?.exit?.(0);
  };
  const forceExit = () =>
    setTimeout(() => processLike()?.exit?.(1), shutdownGraceMs);
  processLike()?.on?.("SIGTERM", () => {
    forceExit();
    shutdown("SIGTERM");
  });
  processLike()?.on?.("SIGINT", () => {
    forceExit();
    shutdown("SIGINT");
  });

  return { app, server };
}

if (import.meta.main) {
  startOfficeServer();
}
