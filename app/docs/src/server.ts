/**
 * HTTP server for takos-docs MCP endpoint.
 *
 * Mounted below `/docs` by the single Takos Office worker.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { DocumentConflictError, TakosDocumentStore } from "./document-store.ts";
import { createTakosStorageClient } from "../../shared/lib/takos-storage.ts";
import { registerAuthRoutes, requireAppAuth } from "../../shared/app-auth.ts";
import { serverLog } from "./server-log.ts";
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
  documentCreateSchema,
  documentSchema,
  titlePatchSchema,
} from "../../shared/office-schema.ts";

export function createDocsApp(env: RuntimeEnv = runtimeEnv()) {
  const apiUrl =
    envValue(env, "OBJECT_STORAGE_API_URL") || "http://localhost:8787";
  const token = envValue(env, "OBJECT_STORAGE_ACCESS_TOKEN");
  const keyPrefix = envValue(env, "OBJECT_STORAGE_KEY_PREFIX") ?? "";
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  const managedWorkspaceId = envValue(env, "APP_WORKSPACE_ID");
  const storageUnavailable = (c: Context) =>
    c.json({ error: "object_storage_not_configured" }, 503);

  const stores = new Map<string, TakosDocumentStore>();
  const storeForSpace = (spaceId: string): TakosDocumentStore => {
    let store = stores.get(spaceId);
    if (!store) {
      const client = createTakosStorageClient(
        apiUrl,
        token!,
        spaceId,
        keyPrefix,
      );
      store = new TakosDocumentStore(client);
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
  const storeForRequest = (c: Context): TakosDocumentStore | Response => {
    const mismatch = workspaceMismatch(c);
    if (mismatch) return mismatch;
    const spaceId = requestSpaceId(c);
    if (!spaceId) {
      return c.json({ error: "space_id is required" }, 400);
    }
    if (!token) return storageUnavailable(c);
    return storeForSpace(spaceId);
  };
  const defaultStore =
    defaultSpaceId && token ? storeForSpace(defaultSpaceId) : null;
  const app = new Hono();

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
    const body = await readApiJson(c.req.raw, documentCreateSchema);
    const doc = await store.create(
      body.title || "Untitled document",
      body.content,
    );
    return withEntityTag(c.json(doc, 201), doc.updatedAt);
  });
  app.get("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const doc = await store.get(c.req.param("id"));
    return doc
      ? withEntityTag(c.json(doc), doc.updatedAt)
      : c.json({ error: "Document not found" }, 404);
  });
  app.put("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const body = await readApiJson(c.req.raw, documentSchema);
    const id = c.req.param("id");
    const current = await store.get(id);
    const ifMatch = ifMatchRevision(c.req.raw);
    if (current && !ifMatch) return preconditionRequired(c);
    if (!current && c.req.header("if-none-match") !== "*") {
      return preconditionRequired(c);
    }
    try {
      const doc = await store.upsert(
        { ...body, id: current?.id ?? id },
        current ? { expectedUpdatedAt: ifMatch! } : undefined,
      );
      return withEntityTag(c.json(doc), doc.updatedAt);
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
    const current = await store.get(c.req.param("id"));
    if (!current) return c.json({ error: "Document not found" }, 404);
    const ifMatch = ifMatchRevision(c.req.raw);
    if (!ifMatch) return preconditionRequired(c);
    const body = await readApiJson(c.req.raw, titlePatchSchema);
    try {
      const doc = await store.update(c.req.param("id"), body, {
        expectedUpdatedAt: ifMatch,
      });
      return doc
        ? withEntityTag(c.json(doc), doc.updatedAt)
        : c.json({ error: "Document not found" }, 404);
    } catch (error) {
      if (error instanceof DocumentConflictError) {
        return c.json({ error: "conflict", current: error.current }, 409);
      }
      throw error;
    }
  });
  app.delete("/api/documents/:id", async (c) => {
    const store = storeForRequest(c);
    if (store instanceof Response) return store;
    const current = await store.get(c.req.param("id"));
    if (!current) return c.json({ deleted: false });
    const ifMatch = ifMatchRevision(c.req.raw);
    if (!ifMatch) return preconditionRequired(c);
    if (ifMatch !== current.updatedAt) {
      return c.json({ error: "conflict", current }, 409);
    }
    try {
      return c.json({
        deleted: await store.delete(c.req.param("id"), {
          expectedUpdatedAt: ifMatch,
        }),
      });
    } catch (error) {
      if (error instanceof DocumentConflictError) {
        return c.json({ error: "conflict", current: error.current }, 409);
      }
      throw error;
    }
  });

  app.get("/files/:id", (c) => {
    const url = new URL(c.req.url);
    // Editor lives under the unified Takos Office worker at /docs.
    url.pathname = `/docs/${encodeURIComponent(c.req.param("id"))}`;
    return c.redirect(`${url.pathname}${url.search}`, 302);
  });

  app.onError((err, c) => {
    const input = inputErrorResponse(err, c);
    if (input) return input;
    serverLog.error("takos-docs.server.request_error", { error: err });
    return c.json({ error: "internal_error" }, 500);
  });

  return { app, store: defaultStore };
}
