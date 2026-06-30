import { Hono } from "hono";
import type { Context } from "hono";
import { SpreadsheetConflictError, SpreadsheetStore } from "./spreadsheet-store.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import type { Spreadsheet } from "./types/index.ts";
import {
  appAuthMisconfigured,
  registerAuthRoutes,
  requireAppAuth,
} from "../../shared/app-auth.ts";
import { createExcelRuntimeCapabilityManifest } from "./runtime-capabilities.ts";
import {
  createMcpRequestHandler,
  MAX_MCP_REQUEST_BYTES,
  mcpAuthMisconfigured,
} from "../../shared/mcp-factory.ts";
import { createMcpServer } from "./mcp.ts";
import {
  envFlagEnabled,
  envValue,
  nativeRenderingEnabled,
  requiredEnv,
  type RuntimeEnv,
  runtimeEnv,
} from "../../shared/runtime-env.ts";

export const EXCEL_MAX_MCP_REQUEST_BYTES = MAX_MCP_REQUEST_BYTES;

export function createServerApp(
  store: SpreadsheetStore | null,
  options: {
    env?: RuntimeEnv;
    nativeRendering?: boolean;
    mcpAuthToken?: string;
    mcpAllowUnauthenticated?: boolean;
    storeForRequest?: (c: Context) => SpreadsheetStore | Response;
    requestSpaceId?: (c: Context) => string | null;
  } = {},
) {
  const app = new Hono();
  const runtimeEnvValue = options.env ?? runtimeEnv();
  const mcpAuthToken = options.mcpAuthToken;
  const mcpAllowUnauthenticated = options.mcpAllowUnauthenticated === true;
  const defaultSpaceIdFromEnv = envValue(runtimeEnvValue, "TAKOS_SPACE_ID") ??
    null;
  const resolveSpaceId = (c: Context): string | null => {
    if (options.requestSpaceId) return options.requestSpaceId(c);
    return envValue(
      {
        value: c.req.query("space_id") ?? c.req.query("spaceId") ??
          defaultSpaceIdFromEnv ?? undefined,
      },
      "value",
    ) ?? null;
  };
  const currentStore = (c: Context): SpreadsheetStore | Response => {
    if (options.storeForRequest) return options.storeForRequest(c);
    if (!store) return c.json({ error: "space_id is required" }, 400);
    return store;
  };

  const health = (c: Context) => {
    const authError = appAuthMisconfigured(runtimeEnvValue);
    if (authError) return authError;
    const mcpAuthError = mcpAuthMisconfigured(
      mcpAuthToken,
      mcpAllowUnauthenticated,
    );
    if (mcpAuthError) return mcpAuthError;
    return c.json({ status: "ok" });
  };
  app.get("/health", health);
  app.get("/healthz", health);

  registerAuthRoutes(app, runtimeEnvValue);
  app.use("/api/spreadsheets", async (c, next) => {
    const unauthorized = await requireAppAuth(runtimeEnvValue, c.req.raw, {
      spaceId: resolveSpaceId(c),
    });
    if (unauthorized) return unauthorized;
    await next();
  });
  app.use("/api/spreadsheets/*", async (c, next) => {
    const unauthorized = await requireAppAuth(runtimeEnvValue, c.req.raw, {
      spaceId: resolveSpaceId(c),
    });
    if (unauthorized) return unauthorized;
    await next();
  });
  app.get("/api/spreadsheets", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    // Single loadAll pass returns the full spreadsheets; previously this
    // listed (loading every body) then re-get() each id (loading them again).
    return c.json(await store.listSpreadsheetsFull());
  });
  app.post("/api/spreadsheets", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    const body = await c.req.json<Partial<Spreadsheet>>();
    if (body.id && body.title && body.sheets && body.activeSheetId) {
      return c.json(await store.replaceSpreadsheet(body as Spreadsheet), 201);
    }
    const id = await store.createSpreadsheet(
      body.title || "Untitled Spreadsheet",
    );
    return c.json(await store.getSpreadsheet(id), 201);
  });
  app.get("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    try {
      return c.json(await store.getSpreadsheet(c.req.param("id")));
    } catch {
      return c.json({ error: "Spreadsheet not found" }, 404);
    }
  });
  app.put("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    const body = await c.req.json<Spreadsheet>();
    const id = c.req.param("id");
    let current: Spreadsheet | undefined;
    try {
      current = await store.getSpreadsheet(id);
    } catch {
      current = undefined;
    }
    // Optimistic concurrency: If-Match carries the version the browser loaded;
    // a stale match means a concurrent (e.g. MCP) write landed, so reject with
    // 409 + the current spreadsheet instead of clobbering it.
    const expectedUpdatedAt = c.req.header("If-Match") || undefined;
    try {
      return c.json(
        await store.replaceSpreadsheet({
          ...body,
          id: current?.id ?? body.id ?? id,
        }, { expectedUpdatedAt }),
      );
    } catch (error) {
      if (error instanceof SpreadsheetConflictError) {
        return c.json({ current: error.current }, 409);
      }
      throw error;
    }
  });
  app.delete("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    try {
      await store.deleteSpreadsheet(c.req.param("id"));
      return c.json({ deleted: true });
    } catch {
      return c.json({ deleted: false });
    }
  });

  app.get("/files/:id", (c) => {
    const url = new URL(c.req.url);
    url.pathname = `/sheet/${encodeURIComponent(c.req.param("id"))}`;
    return c.redirect(`${url.pathname}${url.search}`, 302);
  });

  app.all("/mcp", (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    const handler = createMcpRequestHandler(
      () =>
        createMcpServer(store, {
          runtimeCapabilities: createExcelRuntimeCapabilityManifest({
            nativeRendering: options.nativeRendering,
          }),
        }),
      {
        authToken: mcpAuthToken,
        allowUnauthenticated: mcpAllowUnauthenticated,
      },
    );
    return handler(c.req.raw);
  });

  return app;
}

export function createExcelAppFromEnv(env: RuntimeEnv = runtimeEnv()) {
  const apiUrl = envValue(env, "TAKOS_STORAGE_API_URL") ||
    envValue(env, "TAKOS_API_URL") ||
    "http://localhost:8787";
  const token = envValue(env, "TAKOS_STORAGE_ACCESS_TOKEN") ||
    requiredEnv(env, "TAKOS_ACCESS_TOKEN");
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  const stores = new Map<string, SpreadsheetStore>();
  const storeForSpace = (spaceId: string): SpreadsheetStore => {
    let store = stores.get(spaceId);
    if (!store) {
      const client = createTakosStorageClient(apiUrl, token, spaceId);
      store = new SpreadsheetStore(client);
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
  const defaultStore = defaultSpaceId ? storeForSpace(defaultSpaceId) : null;
  return createServerApp(defaultStore, {
    env,
    nativeRendering: nativeRenderingEnabled(env),
    mcpAuthToken: envValue(env, "MCP_AUTH_TOKEN"),
    mcpAllowUnauthenticated: envFlagEnabled(
      env,
      "MCP_ALLOW_UNAUTHENTICATED",
    ),
    requestSpaceId,
    storeForRequest: (c) => {
      const spaceId = requestSpaceId(c);
      if (!spaceId) return c.json({ error: "space_id is required" }, 400);
      return storeForSpace(spaceId);
    },
  });
}

