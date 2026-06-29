/**
 * Hono HTTP server for takos-slide with MCP endpoint.
 *
 * Usage:
 *   bun src/server.ts
 *
 * Endpoints:
 *   POST /mcp — MCP Streamable HTTP transport
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { createPresentationStore } from "./presentation-store.ts";
import { createSlideMcpServer } from "./mcp.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import type { Presentation } from "./types/index.ts";
import {
  appAuthMisconfigured,
  registerAuthRoutes,
  requireAppAuth,
} from "../../shared/app-auth.ts";
import { createSlideRuntimeCapabilityManifest } from "./runtime-capabilities.ts";
import {
  createMcpRequestHandler,
  MAX_MCP_REQUEST_BYTES,
  mcpAuthMisconfigured,
} from "../../shared/mcp-factory.ts";
import {
  bunLike,
  envFlagEnabled,
  envValue,
  nativeRenderingEnabled,
  requiredEnv,
  type RuntimeEnv,
  runtimeEnv,
} from "../../shared/runtime-env.ts";

export const SLIDE_MAX_MCP_REQUEST_BYTES = MAX_MCP_REQUEST_BYTES;

export function createSlideAppFromEnv(env: RuntimeEnv = runtimeEnv()) {
  const apiUrl = envValue(env, "TAKOS_STORAGE_API_URL") ||
    envValue(env, "TAKOS_API_URL") ||
    "http://localhost:8787";
  const token = envValue(env, "TAKOS_STORAGE_ACCESS_TOKEN") ||
    requiredEnv(env, "TAKOS_ACCESS_TOKEN");
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  const stores = new Map<string, ReturnType<typeof createPresentationStore>>();
  const storeForSpace = (spaceId: string) => {
    let store = stores.get(spaceId);
    if (!store) {
      const client = createTakosStorageClient(apiUrl, token, spaceId);
      store = createPresentationStore(client);
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
  const storeForRequest = (
    c: Context,
  ): ReturnType<typeof createPresentationStore> | Response => {
    const spaceId = requestSpaceId(c);
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);
    return storeForSpace(spaceId);
  };
  const app = new Hono();

  registerAuthRoutes(app, env);
  app.use("/api/presentations", async (c, next) => {
    const unauthorized = await requireAppAuth(env, c.req.raw, {
      spaceId: requestSpaceId(c),
    });
    if (unauthorized) return unauthorized;
    await next();
  });
  app.use("/api/presentations/*", async (c, next) => {
    const unauthorized = await requireAppAuth(env, c.req.raw, {
      spaceId: requestSpaceId(c),
    });
    if (unauthorized) return unauthorized;
    await next();
  });
  app.get("/api/presentations", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const summaries = await store.list();
    const presentations = await Promise.all(
      summaries.map((entry) => store.get(entry.id)),
    );
    return c.json(
      presentations.filter((entry): entry is Presentation =>
        entry !== undefined
      ),
    );
  });
  app.post("/api/presentations", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await c.req.json<Partial<Presentation>>();
    if (body.id && body.title && body.slides) {
      return c.json(await store.replace(body as Presentation), 201);
    }
    return c.json(
      await store.create(body.title || "Untitled Presentation"),
      201,
    );
  });
  app.get("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const presentation = await store.get(c.req.param("id"));
    return presentation
      ? c.json(presentation)
      : c.json({ error: "Presentation not found" }, 404);
  });
  app.put("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await c.req.json<Presentation>();
    const id = c.req.param("id");
    const current = await store.get(id);
    return c.json(
      await store.replace({ ...body, id: current?.id ?? body.id ?? id }),
    );
  });
  app.delete("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    return c.json({ deleted: await store.delete(c.req.param("id")) });
  });

  app.get("/files/:id", (c) => {
    const url = new URL(c.req.url);
    url.pathname = `/slide/${encodeURIComponent(c.req.param("id"))}`;
    return c.redirect(`${url.pathname}${url.search}`, 302);
  });

  app.all("/mcp", (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const handler = createMcpRequestHandler(
      () =>
        createSlideMcpServer(store, {
          runtimeCapabilities: createSlideRuntimeCapabilityManifest({
            nativeRendering: nativeRenderingEnabled(env),
          }),
        }),
      {
        authToken: envValue(env, "MCP_AUTH_TOKEN"),
        allowUnauthenticated: envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
      },
    );
    return handler(c.req.raw);
  });

  const health = (c: Context) => {
    const authError = appAuthMisconfigured(env);
    if (authError) return authError;
    const mcpAuthError = mcpAuthMisconfigured(
      envValue(env, "MCP_AUTH_TOKEN"),
      envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
    );
    if (mcpAuthError) return mcpAuthError;
    return c.json({ status: "ok" });
  };
  app.get("/health", health);
  app.get("/healthz", health);

  return app;
}

if (import.meta.main) {
  const env = runtimeEnv();
  const port = Number(envValue(env, "PORT") ?? "3003");
  const app = createSlideAppFromEnv(env);
  console.log(`takos-slide MCP server listening on :${port}`);
  bunLike("takos-slide").serve({ port, fetch: (request) => app.fetch(request) });
}
