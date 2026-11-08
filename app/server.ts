/**
 * Unified Takos Office worker.
 *
 * Mounts the three editor sub-apps under subpaths and exposes one office-wide
 * MCP endpoint:
 *   - GET  /healthz          — readiness probe (manifest readiness)
 *   - GET  /                 — Office shell (cross-editor nav + recent + search)
 *   - GET  /api/office/items — recent items across docs/slide/sheet
 *   - GET  /api/office/search— cross-app title/content search
 *   - POST /mcp              — unified MCP (docs + slide + sheet tools)
 *   - /docs/*                — takos-docs SPA + /docs/api/* + /docs/files/:id
 *   - /slide/*               — takos-slide SPA + /slide/api/* + /slide/files/:id
 *   - /sheet/*               — takos-excel SPA + /sheet/api/* + /sheet/files/:id
 *
 * Each editor sub-app keeps its own per-space stores and auth; the unified
 * /mcp builds the three space-scoped stores itself and aggregates their tools.
 */

import { Hono } from "hono";
import { officePublicUrl } from "./shared/public-url.ts";
import type { Context } from "hono";

import { createDocsApp } from "./docs/src/server.ts";
import { createSlideAppFromEnv } from "./slide/src/server.ts";
import { createExcelAppFromEnv } from "./sheet/src/server.ts";

import {
  createOfficeStorageClient,
  hasOfficeStorage,
  usesRuntimeStorage,
  runtimeStorageErrorResponse,
  type OfficeStorageOptions,
} from "./shared/runtime-storage.ts";
import { createTakosStorageClient } from "./shared/lib/takos-storage.ts";
import { TakosDocumentStore } from "./docs/src/document-store.ts";
import { createPresentationStore } from "./slide/src/presentation-store.ts";
import { SpreadsheetStore } from "./sheet/src/spreadsheet-store.ts";

import { createOfficeMcpServer } from "./mcp.ts";
import {
  createMcpRequestHandler,
  mcpAuthMisconfigured,
} from "./shared/mcp-factory.ts";
import {
  canonicalInterfaceResourceUri,
  hasValidInterfaceOAuthConfiguration,
} from "./shared/interface-oauth-auth.ts";
import {
  appAuthMisconfigured,
  appRuntimeAuthConfigured,
  registerAuthRoutes,
  requireAppAuth,
} from "./shared/app-auth.ts";
import {
  collectOfficeItems,
  type OfficeStores,
  searchOfficeItems,
} from "./office-items.ts";
import { renderShellPage } from "./shell-page.ts";
import {
  bunLike,
  envFlagEnabled,
  envValue,
  nativeRenderingEnabled,
  type RuntimeEnv,
  runtimeEnv,
  processLike,
} from "./shared/runtime-env.ts";

export type OfficeRuntimeEnv = RuntimeEnv;

export type OfficeServerOptions = {
  port?: number;
  shutdownGraceMs?: number;
};

export type OfficeAppOptions = OfficeStorageOptions & {
  interfaceUserInfoFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
};

function mcpResourceUri(publicUrl?: string): string | undefined {
  const canonical = publicUrl ? canonicalInterfaceResourceUri(publicUrl) : null;
  if (!canonical) return undefined;
  return new URL("mcp", canonical.endsWith("/") ? canonical : `${canonical}/`)
    .href;
}

export function createOfficeApp(
  env: OfficeRuntimeEnv = runtimeEnv(),
  options: OfficeAppOptions = {},
) {
  const app = new Hono();
  let publicUrl: string | undefined;
  try { publicUrl = officePublicUrl(env); } catch {
    // Auth/configuration routes report the invalid declaration; do not infer a replacement.
  }
  const mcpAudience = mcpResourceUri(publicUrl);
  const interfaceOAuth = mcpAudience
    ? {
        issuerUrl: envValue(env, "OIDC_ISSUER_URL"),
        expectedAudience: mcpAudience,
        expectedWorkspaceId:
          envValue(env, "APP_WORKSPACE_ID") ?? envValue(env, "TAKOS_SPACE_ID"),
        expectedCapsuleId: envValue(env, "APP_CAPSULE_ID"),
        ...(options.interfaceUserInfoFetch
          ? { fetchImpl: options.interfaceUserInfoFetch }
          : {}),
      }
    : undefined;
  const interfaceOAuthConfigured = interfaceOAuth
    ? hasValidInterfaceOAuthConfiguration({
        issuerUrl: interfaceOAuth.issuerUrl,
        audience: interfaceOAuth.expectedAudience,
        workspaceId: interfaceOAuth.expectedWorkspaceId,
        capsuleId: interfaceOAuth.expectedCapsuleId,
      })
    : false;

  // ---- Office-wide readiness probe ----
  const runtimeStorage = usesRuntimeStorage(env);
  const configuredStorageUrl = envValue(env, "OBJECT_STORAGE_API_URL");
  const mcpStorageToken = envValue(env, "OBJECT_STORAGE_ACCESS_TOKEN");
  const configuredStorageWorkspace =
    envValue(env, "APP_WORKSPACE_ID") ?? envValue(env, "TAKOS_SPACE_ID");
  const health = async (c: Context) => {
    const authError = appAuthMisconfigured(env);
    if (authError) return authError;
    const mcpAuthError = mcpAuthMisconfigured(
      envValue(env, "MCP_AUTH_TOKEN"),
      envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
      interfaceOAuthConfigured,
    );
    if (mcpAuthError) return mcpAuthError;
    if (
      (!runtimeStorage && !configuredStorageUrl) ||
      !hasOfficeStorage(env) ||
      !configuredStorageWorkspace
    ) {
      return c.json({ error: "object_storage_not_configured" }, 503);
    }
    if (runtimeStorage) {
      if (!appRuntimeAuthConfigured(env)) {
        return c.json({ error: "storage_runtime_session_not_configured" }, 503);
      }
      try {
        // Configuration readiness only: a public probe has no person authority.
        // Constructing the client validates the explicit URL without obtaining a token.
        createOfficeStorageClient(env, c.req.raw, configuredStorageWorkspace, options);
      } catch (error) {
        return runtimeStorageErrorResponse(error) ?? c.json({ error: "object_storage_not_configured" }, 503);
      }
      return c.json({ status: "ok", service: "takos-office", storage: "per_request_authorization", storageProbed: false });
    }
    try {
      await createOfficeStorageClient(env, c.req.raw, configuredStorageWorkspace, options).ready();
    } catch {
      return c.json({ error: "object_storage_unavailable" }, 503);
    }
    return c.json({ status: "ok", service: "takos-office" });
  };
  app.get("/health", health);
  app.get("/healthz", health);
  registerAuthRoutes(app, env);

  // ---- Office shell landing ----
  app.get("/", (c) => c.html(renderShellPage()));

  // ---- Shared storage config ----
  const defaultSpaceId = envValue(env, "TAKOS_SPACE_ID");
  // UI/storage ownership is independent of whether MCP Interface OAuth is
  // enabled. A standalone bearer deployment may still be pinned to one
  // Workspace and must not accept a caller-selected alternate owner.
  // In App mode TAKOS_SPACE_ID is also a fixed data coordinate, never membership authority.
  const managedWorkspaceId = envValue(env, "APP_WORKSPACE_ID") ??
    (envValue(env, "APP_CAPSULE_ID") ? defaultSpaceId : undefined);
  const storageUnavailable = (c: Context) =>
    c.json({ error: "object_storage_not_configured" }, 503);

  // ---- Office shell cross-editor APIs (recent + search) ----
  const officeStores = new Map<string, OfficeStores>();
  const storesForSpace = (spaceId: string, request: Request): OfficeStores => {
    let stores = runtimeStorage ? undefined : officeStores.get(spaceId);
    if (!stores) {
      const client = createOfficeStorageClient(env, request, spaceId, options);
      stores = {
        docs: new TakosDocumentStore(client),
        slide: createPresentationStore(client),
        sheet: new SpreadsheetStore(client),
      };
      if (!runtimeStorage) officeStores.set(spaceId, stores);
    }
    return stores;
  };
  const requestedSpace = (c: Context) =>
    c.req.query("space_id") ?? c.req.query("spaceId") ?? defaultSpaceId;
  const resolveSpace = (c: Context) => managedWorkspaceId ?? requestedSpace(c);
  const workspaceMismatch = (c: Context) => {
    const requested = requestedSpace(c);
    return managedWorkspaceId && requested && requested !== managedWorkspaceId;
  };

  app.get("/api/office/items", async (c) => {
    if (workspaceMismatch(c)) {
      return c.json({ error: "workspace_owner_mismatch" }, 403);
    }
    const spaceId = resolveSpace(c);
    const unauthorized = await requireAppAuth(env, c.req.raw, { spaceId, fetchImpl: options.appUserInfoFetch });
    if (unauthorized) return unauthorized;
    if (!hasOfficeStorage(env)) return storageUnavailable(c);
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);
    return c.json({
      items: (await collectOfficeItems(storesForSpace(spaceId, c.req.raw))).slice(0, 500),
    });
  });

  app.get("/api/office/search", async (c) => {
    if (workspaceMismatch(c)) {
      return c.json({ error: "workspace_owner_mismatch" }, 403);
    }
    const spaceId = resolveSpace(c);
    const unauthorized = await requireAppAuth(env, c.req.raw, { spaceId, fetchImpl: options.appUserInfoFetch });
    if (unauthorized) return unauthorized;
    if (!hasOfficeStorage(env)) return storageUnavailable(c);
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);
    const q = c.req.query("q") ?? "";
    if (q.length > 512) return c.json({ error: "query_too_long" }, 400);
    return c.json({
      items: (await searchOfficeItems(storesForSpace(spaceId, c.req.raw), q)).slice(
        0,
        500,
      ),
    });
  });

  // ---- Unified office MCP (docs + slide + sheet) ----
  const mcpHandlers = new Map<
    string,
    (request: Request) => Promise<Response>
  >();

  app.all("/mcp", (c) => {
    if (envValue(env, "APP_CAPSULE_ID") && !managedWorkspaceId) {
      return c.json({ error: "app_storage_namespace_not_configured" }, 503);
    }
    const configError = mcpAuthMisconfigured(
      envValue(env, "MCP_AUTH_TOKEN"),
      envFlagEnabled(env, "MCP_ALLOW_UNAUTHENTICATED"),
      interfaceOAuthConfigured,
    );
    if (configError) return configError;
    const requestedSpaceId = c.req.query("space_id") ?? c.req.query("spaceId");
    if (
      managedWorkspaceId &&
      requestedSpaceId &&
      requestedSpaceId !== managedWorkspaceId
    ) {
      return c.json(
        { error: "workspace does not match managed MCP owner" },
        403,
      );
    }
    const spaceId = managedWorkspaceId ?? requestedSpaceId ?? defaultSpaceId;
    if (!mcpStorageToken) return storageUnavailable(c);
    if (!spaceId) return c.json({ error: "space_id is required" }, 400);

    let handler = mcpHandlers.get(spaceId);
    if (!handler) {
      // MCP retains its explicitly configured legacy storage route. An invocation
      // bearer is never substituted for a browser app session or used as fallback.
      const client = createTakosStorageClient(
        configuredStorageUrl || "http://localhost:8787",
        mcpStorageToken,
        spaceId,
        envValue(env, "OBJECT_STORAGE_KEY_PREFIX") ?? "",
        { fetchImpl: options.storageFetch },
      );
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
          ...(interfaceOAuth ? { interfaceOAuth } : {}),
        },
      );
      mcpHandlers.set(spaceId, handler);
    }
    return handler(c.req.raw);
  });

  // ---- Mount editor sub-apps (UI + /api/* + /files/:id under each prefix) ----
  app.route("/docs", createDocsApp(env, options).app);
  app.route("/slide", createSlideAppFromEnv(env, options));
  app.route("/sheet", createExcelAppFromEnv(env, options));

  app.onError((error) => runtimeStorageErrorResponse(error) ?? Response.json({ error: "internal_error" }, { status: 500 }));
  return { app };
}

export function startOfficeServer(options: OfficeServerOptions = {}) {
  const env = runtimeEnv();
  const port = options.port ?? parseInt(envValue(env, "PORT") ?? "8787", 10);
  const { app } = createOfficeApp(env);
  const server = bunLike("takos-office").serve({
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
