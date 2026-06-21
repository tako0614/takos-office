/**
 * HTTP server for takos-docs MCP endpoint.
 *
 * Starts a Hono app on the configured port with:
 * - GET  /healthz — readiness probe
 * - POST /mcp     — Streamable HTTP MCP endpoint for document tools
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { TakosDocumentStore } from "./document-store.ts";
import {
  createDocsMcpServer,
  createMcpRequestHandler,
  mcpAuthMisconfigured,
} from "./mcp.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import type { Document } from "./types/index.ts";
import {
  appAuthMisconfigured,
  registerAuthRoutes,
  requireAppAuth,
} from "../../shared/app-auth.ts";
import { createDocsRuntimeCapabilityManifest } from "./runtime-capabilities.ts";
import { serverLog } from "./server-log.ts";

export type DocsServerOptions = {
  port?: number;
  shutdownGraceMs?: number;
};

export type DocsRuntimeEnv = Record<string, string | undefined>;

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
  if (!bun) throw new Error("Bun runtime is required to start takos-docs");
  return bun;
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

function runtimeEnv(): DocsRuntimeEnv {
  return { ...(processLike()?.env ?? {}) };
}

function envValue(env: DocsRuntimeEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function requiredEnv(env: DocsRuntimeEnv, name: string): string {
  const value = envValue(env, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function nativeRenderingEnabled(env: DocsRuntimeEnv): boolean {
  const value = envValue(env, "TAKOS_NATIVE_RENDERING");
  if (value) return ["1", "true", "yes"].includes(value.toLowerCase());
  return isBunRuntime();
}

function envFlagEnabled(env: DocsRuntimeEnv, name: string): boolean {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}

export function createDocsApp(env: DocsRuntimeEnv = runtimeEnv()) {
  const apiUrl = envValue(env, "TAKOS_STORAGE_API_URL") ||
    envValue(env, "TAKOS_API_URL") ||
    "http://localhost:8787";
  const token = envValue(env, "TAKOS_STORAGE_ACCESS_TOKEN") ||
    requiredEnv(env, "TAKOS_ACCESS_TOKEN");
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");

  const stores = new Map<string, TakosDocumentStore>();
  const storeForSpace = (spaceId: string): TakosDocumentStore => {
    let store = stores.get(spaceId);
    if (!store) {
      const client = createTakosStorageClient(apiUrl, token, spaceId);
      store = new TakosDocumentStore(client);
      stores.set(spaceId, store);
    }
    return store;
  };
  const requestSpaceId = (c: Context): string | null =>
    envValue(
      {
        value: c.req.query("space_id") ?? c.req.query("spaceId") ??
          defaultSpaceId,
      },
      "value",
    ) ?? null;
  const storeForRequest = (c: Context): TakosDocumentStore | Response => {
    const spaceId = requestSpaceId(c);
    if (!spaceId) {
      return c.json({ error: "space_id is required" }, 400);
    }
    return storeForSpace(spaceId);
  };
  const defaultStore = defaultSpaceId ? storeForSpace(defaultSpaceId) : null;
  const app = new Hono();

  // Health check
  const health = (c: Context) => {
    const authError = appAuthMisconfigured(env);
    if (authError) return authError;
    const mcpAuthError = mcpAuthMisconfigured(
      envValue(env, "MCP_AUTH_TOKEN"),
      envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
    );
    if (mcpAuthError) return mcpAuthError;
    return c.json({
      status: "ok",
      service: "takos-docs",
    });
  };
  app.get("/health", health);
  app.get("/healthz", health);

  registerAuthRoutes(app, env);

  app.use("/api/documents", async (c, next) => {
    const unauthorized = await requireAppAuth(env, c.req.raw, {
      spaceId: requestSpaceId(c),
    });
    if (unauthorized) return unauthorized;
    await next();
  });
  app.use("/api/documents/*", async (c, next) => {
    const unauthorized = await requireAppAuth(env, c.req.raw, {
      spaceId: requestSpaceId(c),
    });
    if (unauthorized) return unauthorized;
    await next();
  });
  app.get("/api/documents", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    return c.json(await store.list());
  });
  app.post("/api/documents", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await c.req.json<Partial<Document>>();
    if (body.id && body.title && body.createdAt && body.updatedAt) {
      const doc = await store.upsert({
        id: body.id,
        title: body.title,
        content: body.content ?? "",
        createdAt: body.createdAt,
        updatedAt: body.updatedAt,
      });
      return c.json(doc, 201);
    }
    const doc = await store.create(
      body.title || "Untitled document",
      body.content,
    );
    return c.json(doc, 201);
  });
  app.get("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const doc = await store.get(c.req.param("id"));
    return doc ? c.json(doc) : c.json({ error: "Document not found" }, 404);
  });
  app.put("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await c.req.json<Document>();
    const id = c.req.param("id");
    const current = await store.get(id);
    const doc = await store.upsert({
      ...body,
      id: current?.id ?? body.id ?? id,
    });
    return c.json(doc);
  });
  app.patch("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const doc = await store.update(c.req.param("id"), await c.req.json());
    return doc ? c.json(doc) : c.json({ error: "Document not found" }, 404);
  });
  app.delete("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    return c.json({ deleted: await store.delete(c.req.param("id")) });
  });

  app.get("/files/:id", (c) => {
    const url = new URL(c.req.url);
    // Editor lives under the unified Takos Office worker at /docs.
    url.pathname = `/docs/${encodeURIComponent(c.req.param("id"))}`;
    return c.redirect(`${url.pathname}${url.search}`, 302);
  });

  // MCP endpoint — lazy-initialized
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
    const spaceId = requestSpaceId(c);
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);
    let mcpHandler = mcpHandlers.get(spaceId);
    if (!mcpHandler) {
      const store = storeForSpace(spaceId);
      mcpHandler = createMcpRequestHandler(
        () =>
          createDocsMcpServer({
            store,
            runtimeCapabilities: createDocsRuntimeCapabilityManifest({
              nativeRendering: nativeRenderingEnabled(env),
            }),
          }),
        {
          authToken: envValue(env, "MCP_AUTH_TOKEN"),
          allowUnauthenticated: envFlagEnabled(
            env,
            "MCP_ALLOW_UNAUTHENTICATED",
          ),
        },
      );
      mcpHandlers.set(spaceId, mcpHandler);
    }
    return mcpHandler(c.req.raw);
  });

  app.onError((err, c) => {
    serverLog.error("takos-docs.server.request_error", { error: err });
    return c.json({ error: err.message }, 500);
  });

  return { app, store: defaultStore };
}

export function startDocsServer(options: DocsServerOptions = {}) {
  const env = runtimeEnv();
  const port = options.port ?? parseInt(envValue(env, "PORT") ?? "8787", 10);
  const shutdownGraceMs = options.shutdownGraceMs ??
    parseInt(envValue(env, "SHUTDOWN_GRACE_MS") ?? "15000", 10);
  const { app, store } = createDocsApp(env);

  const server = bunLike().serve({
    port,
    fetch: (request) => app.fetch(request),
  });
  serverLog.info("takos-docs.server.listening", { port });

  async function shutdown(signal: string): Promise<void> {
    serverLog.info("takos-docs.server.shutting_down", { signal });
    server.stop(false);
    serverLog.info("takos-docs.server.shutdown_complete");
    processLike()?.exit?.(0);
  }

  const forceExit = () => {
    setTimeout(() => {
      serverLog.warn("takos-docs.server.shutdown_force_exit", {
        graceMs: shutdownGraceMs,
      });
      processLike()?.exit?.(1);
    }, shutdownGraceMs);
  };

  processLike()?.on?.("SIGTERM", () => {
    forceExit();
    void shutdown("SIGTERM");
  });
  processLike()?.on?.("SIGINT", () => {
    forceExit();
    void shutdown("SIGINT");
  });

  return { app, store, server };
}

// Run if executed directly
if (import.meta.main) {
  startDocsServer();
}
