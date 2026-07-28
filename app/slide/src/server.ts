/**
 * Slide routes mounted below `/slide` by the single Takos Office worker.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import {
  createPresentationStore,
  PresentationConflictError,
} from "./presentation-store.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import type { Presentation } from "./types/index.ts";
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
  presentationCreateSchema,
  presentationSchema,
  titlePatchSchema,
} from "../../shared/office-schema.ts";

export function createSlideAppFromEnv(env: RuntimeEnv = runtimeEnv()) {
  const apiUrl =
    envValue(env, "OBJECT_STORAGE_API_URL") || "http://localhost:8787";
  const token = envValue(env, "OBJECT_STORAGE_ACCESS_TOKEN");
  const keyPrefix = envValue(env, "OBJECT_STORAGE_KEY_PREFIX") ?? "";
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  const managedWorkspaceId = envValue(env, "APP_WORKSPACE_ID");
  const storageUnavailable = (c: Context) =>
    c.json({ error: "object_storage_not_configured" }, 503);
  const stores = new Map<string, ReturnType<typeof createPresentationStore>>();
  const storeForSpace = (spaceId: string) => {
    let store = stores.get(spaceId);
    if (!store) {
      const client = createTakosStorageClient(
        apiUrl,
        token!,
        spaceId,
        keyPrefix,
      );
      store = createPresentationStore(client);
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
  const workspaceMismatch = (c: Context): Response | null => {
    const requested = selectedSpaceId(c);
    return managedWorkspaceId && requested && requested !== managedWorkspaceId
      ? c.json({ error: "workspace_owner_mismatch" }, 403)
      : null;
  };
  const storeForRequest = (
    c: Context,
  ): ReturnType<typeof createPresentationStore> | Response => {
    const mismatch = workspaceMismatch(c);
    if (mismatch) return mismatch;
    const spaceId = requestSpaceId(c);
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);
    if (!token) return storageUnavailable(c);
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
    // Single loadAll pass returns the full presentations; previously this
    // listed (loading every body) then re-get() each id (loading them again).
    return c.json(await store.listFull());
  });
  app.post("/api/presentations", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await readApiJson(c.req.raw, presentationCreateSchema);
    const created = await store.create(body.title || "Untitled Presentation");
    return withEntityTag(c.json(created, 201), created.updatedAt);
  });
  app.get("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const presentation = await store.get(c.req.param("id"));
    return presentation
      ? withEntityTag(c.json(presentation), presentation.updatedAt)
      : c.json({ error: "Presentation not found" }, 404);
  });
  app.put("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await readApiJson(c.req.raw, presentationSchema);
    const id = c.req.param("id");
    const current = await store.get(id);
    // Optimistic concurrency: If-Match carries the version the browser loaded;
    // a stale match means a concurrent (e.g. MCP) write landed, so reject with
    // 409 + the current presentation instead of clobbering it.
    const expectedUpdatedAt = ifMatchRevision(c.req.raw);
    if (current && !expectedUpdatedAt) return preconditionRequired(c);
    if (!current && c.req.header("if-none-match") !== "*") {
      return preconditionRequired(c);
    }
    try {
      const saved = await store.replace(
        { ...body, id: current?.id ?? id },
        current ? { expectedUpdatedAt: expectedUpdatedAt! } : undefined,
      );
      return withEntityTag(c.json(saved), saved.updatedAt);
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return c.json({ current: error.current }, 409);
      }
      throw error;
    }
  });
  app.patch("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const current = await store.get(c.req.param("id"));
    if (!current) return c.json({ error: "Presentation not found" }, 404);
    const expectedUpdatedAt = ifMatchRevision(c.req.raw);
    if (!expectedUpdatedAt) return preconditionRequired(c);
    const body = await readApiJson(c.req.raw, titlePatchSchema);
    try {
      const saved = await store.replace(
        {
          ...current,
          title: body.title.trim(),
          updatedAt: new Date().toISOString(),
        },
        { expectedUpdatedAt },
      );
      return withEntityTag(c.json(saved), saved.updatedAt);
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return c.json({ error: "conflict", current: error.current }, 409);
      }
      return c.json({ error: "Presentation not found" }, 404);
    }
  });
  app.delete("/api/presentations/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const current = await store.get(c.req.param("id"));
    if (!current) return c.json({ deleted: false });
    const expectedUpdatedAt = ifMatchRevision(c.req.raw);
    if (!expectedUpdatedAt) return preconditionRequired(c);
    if (current.updatedAt !== expectedUpdatedAt) {
      return c.json({ error: "conflict", current }, 409);
    }
    try {
      return c.json({
        deleted: await store.delete(c.req.param("id"), {
          expectedUpdatedAt,
        }),
      });
    } catch (error) {
      if (error instanceof PresentationConflictError) {
        return c.json({ error: "conflict", current: error.current }, 409);
      }
      throw error;
    }
  });

  app.get("/files/:id", (c) => {
    const url = new URL(c.req.url);
    url.pathname = `/slide/${encodeURIComponent(c.req.param("id"))}`;
    return c.redirect(`${url.pathname}${url.search}`, 302);
  });

  app.onError((error, c) => {
    const input = inputErrorResponse(error, c);
    if (input) return input;
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
