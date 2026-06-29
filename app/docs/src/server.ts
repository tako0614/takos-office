/**
 * HTTP server for takos-docs MCP endpoint.
 *
 * Starts a Hono app on the configured port with:
 * - GET  /healthz — readiness probe
 * - POST /mcp     — Streamable HTTP MCP endpoint for document tools
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { DocumentConflictError, TakosDocumentStore } from "./document-store.ts";
import { createDocsMcpServer } from "./mcp.ts";
import {
  createMcpRequestHandler,
  mcpAuthMisconfigured,
} from "../../shared/mcp-factory.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import type { Document } from "./types/index.ts";
import {
  appAuthMisconfigured,
  registerAuthRoutes,
  requireAppAuth,
} from "../../shared/app-auth.ts";
import { createDocsRuntimeCapabilityManifest } from "./runtime-capabilities.ts";
import { serverLog } from "./server-log.ts";
import {
  envFlagEnabled,
  envValue,
  nativeRenderingEnabled,
  requiredEnv,
  type RuntimeEnv,
  runtimeEnv,
} from "../../shared/runtime-env.ts";

export function createDocsApp(env: RuntimeEnv = runtimeEnv()) {
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
    // `If-Match: <updatedAt>` enables optimistic concurrency: the autosave
    // refuses to overwrite a doc that changed since it was loaded.
    const ifMatch = c.req.header("If-Match");
    try {
      const doc = await store.upsert(
        { ...body, id: current?.id ?? body.id ?? id },
        ifMatch ? { expectedUpdatedAt: ifMatch } : undefined,
      );
      return c.json(doc);
    } catch (e) {
      if (e instanceof DocumentConflictError) {
        return c.json({ error: "conflict", current: e.current }, 409);
      }
      throw e;
    }
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
