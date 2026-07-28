import { Hono } from "hono";
import type { Context } from "hono";
import {
  SpreadsheetConflictError,
  SpreadsheetStore,
} from "./spreadsheet-store.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import type { Spreadsheet } from "./types/index.ts";
import { registerAuthRoutes, requireAppAuth } from "../../shared/app-auth.ts";
import {
  envValue,
  type RuntimeEnv,
  runtimeEnv,
} from "../../shared/runtime-env.ts";
import {
  ifMatchRevision,
  inputErrorResponse,
  preconditionRequired,
  readApiJson,
  withEntityTag,
} from "../../shared/http-policy.ts";
import {
  spreadsheetCreateSchema,
  spreadsheetSchema,
  titlePatchSchema,
} from "../../shared/office-schema.ts";

export function createServerApp(
  store: SpreadsheetStore | null,
  options: {
    env?: RuntimeEnv;
    storeForRequest?: (c: Context) => SpreadsheetStore | Response;
    requestSpaceId?: (c: Context) => string | null;
  } = {},
) {
  const app = new Hono();
  const runtimeEnvValue = options.env ?? runtimeEnv();
  const defaultSpaceIdFromEnv =
    envValue(runtimeEnvValue, "TAKOS_SPACE_ID") ?? null;
  const resolveSpaceId = (c: Context): string | null => {
    if (options.requestSpaceId) return options.requestSpaceId(c);
    return (
      envValue(
        {
          value:
            c.req.query("space_id") ??
            c.req.query("spaceId") ??
            defaultSpaceIdFromEnv ??
            undefined,
        },
        "value",
      ) ?? null
    );
  };
  const currentStore = (c: Context): SpreadsheetStore | Response => {
    if (options.storeForRequest) return options.storeForRequest(c);
    if (!store) return c.json({ error: "space_id is required" }, 400);
    return store;
  };

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
    const body = await readApiJson(c.req.raw, spreadsheetCreateSchema);
    const id = await store.createSpreadsheet(
      body.title || "Untitled Spreadsheet",
    );
    const created = await store.getSpreadsheet(id);
    return withEntityTag(c.json(created, 201), created.updatedAt);
  });
  app.get("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    try {
      const spreadsheet = await store.getSpreadsheet(c.req.param("id"));
      return withEntityTag(c.json(spreadsheet), spreadsheet.updatedAt);
    } catch {
      return c.json({ error: "Spreadsheet not found" }, 404);
    }
  });
  app.put("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    const body = await readApiJson(c.req.raw, spreadsheetSchema);
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
    const expectedUpdatedAt = ifMatchRevision(c.req.raw);
    if (current && !expectedUpdatedAt) return preconditionRequired(c);
    if (!current && c.req.header("if-none-match") !== "*") {
      return preconditionRequired(c);
    }
    try {
      const saved = await store.replaceSpreadsheet(
        {
          ...body,
          id: current?.id ?? id,
        },
        current ? { expectedUpdatedAt: expectedUpdatedAt! } : undefined,
      );
      return withEntityTag(c.json(saved), saved.updatedAt);
    } catch (error) {
      if (error instanceof SpreadsheetConflictError) {
        return c.json({ current: error.current }, 409);
      }
      throw error;
    }
  });
  app.patch("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    const id = c.req.param("id");
    let current: Spreadsheet;
    try {
      current = await store.getSpreadsheet(id);
    } catch {
      return c.json({ error: "Spreadsheet not found" }, 404);
    }
    const expectedUpdatedAt = ifMatchRevision(c.req.raw);
    if (!expectedUpdatedAt) return preconditionRequired(c);
    const body = await readApiJson(c.req.raw, titlePatchSchema);
    try {
      const saved = await store.replaceSpreadsheet(
        {
          ...current,
          title: body.title.trim(),
          updatedAt: new Date().toISOString(),
        },
        { expectedUpdatedAt },
      );
      return withEntityTag(c.json(saved), saved.updatedAt);
    } catch (error) {
      if (error instanceof SpreadsheetConflictError) {
        return c.json({ error: "conflict", current: error.current }, 409);
      }
      throw error;
    }
  });
  app.delete("/api/spreadsheets/:id", async (c) => {
    const store = currentStore(c);
    if (store instanceof Response) return store;
    try {
      const current = await store.getSpreadsheet(c.req.param("id"));
      const expectedUpdatedAt = ifMatchRevision(c.req.raw);
      if (!expectedUpdatedAt) return preconditionRequired(c);
      if (current.updatedAt !== expectedUpdatedAt) {
        return c.json({ error: "conflict", current }, 409);
      }
      await store.deleteSpreadsheet(c.req.param("id"), {
        expectedUpdatedAt,
      });
      return c.json({ deleted: true });
    } catch (error) {
      if (error instanceof SpreadsheetConflictError) {
        return c.json({ error: "conflict", current: error.current }, 409);
      }
      return c.json({ deleted: false });
    }
  });

  app.get("/files/:id", (c) => {
    const url = new URL(c.req.url);
    url.pathname = `/sheet/${encodeURIComponent(c.req.param("id"))}`;
    return c.redirect(`${url.pathname}${url.search}`, 302);
  });

  app.onError((error, c) => {
    const input = inputErrorResponse(error, c);
    if (input) return input;
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export function createExcelAppFromEnv(env: RuntimeEnv = runtimeEnv()) {
  const apiUrl =
    envValue(env, "OBJECT_STORAGE_API_URL") || "http://localhost:8787";
  const token = envValue(env, "OBJECT_STORAGE_ACCESS_TOKEN");
  const keyPrefix = envValue(env, "OBJECT_STORAGE_KEY_PREFIX") ?? "";
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  const managedWorkspaceId = envValue(env, "APP_WORKSPACE_ID");
  const storageUnavailable = (c: Context) =>
    c.json({ error: "object_storage_not_configured" }, 503);
  const stores = new Map<string, SpreadsheetStore>();
  const storeForSpace = (spaceId: string): SpreadsheetStore => {
    let store = stores.get(spaceId);
    if (!store) {
      const client = createTakosStorageClient(
        apiUrl,
        token!,
        spaceId,
        keyPrefix,
      );
      store = new SpreadsheetStore(client);
      stores.set(spaceId, store);
    }
    return store;
  };
  const selectedSpaceId = (c: Context): string | null =>
    envValue(
      {
        value:
          c.req.query("space_id") ?? c.req.query("spaceId") ?? defaultSpaceId,
      },
      "value",
    ) ?? null;
  const requestSpaceId = (c: Context): string | null =>
    managedWorkspaceId ?? selectedSpaceId(c);
  const defaultStore =
    defaultSpaceId && token ? storeForSpace(defaultSpaceId) : null;
  return createServerApp(defaultStore, {
    env,
    requestSpaceId,
    storeForRequest: (c) => {
      const requested = selectedSpaceId(c);
      if (managedWorkspaceId && requested && requested !== managedWorkspaceId) {
        return c.json({ error: "workspace_owner_mismatch" }, 403);
      }
      const spaceId = requestSpaceId(c);
      if (!spaceId) return c.json({ error: "space_id is required" }, 400);
      if (!token) return storageUnavailable(c);
      return storeForSpace(spaceId);
    },
  });
}
