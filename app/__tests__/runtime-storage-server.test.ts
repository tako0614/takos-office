import { createOfficeApp } from "../server.ts";
import { expect, test } from "bun:test";
import { createRuntimeStorageAuthorization, createOfficeStorageClient } from "../shared/runtime-storage.ts";
import { Hono } from "hono";
import { appRuntimeAccessToken, registerAuthRoutes, requireAppAuth } from "../shared/app-auth.ts";

const now = Date.parse("2026-11-05T00:00:00Z");
const selectedInterface = {
  metadata: { id: "interface_storage" },
  spec: { type: "storage.object", version: "1", access: { resourceUriInput: "endpoint" } },
  status: { phase: "Resolved", resolvedInputs: { endpoint: "https://storage.example/o" } },
};

function fixture(options: { tokenChange?: Record<string, unknown>; interfaces?: unknown[]; nextCursor?: string; tokenStatus?: number } = {}) {
  const requests: Request[] = [];
  const authorize = createRuntimeStorageAuthorization({
    controlApiUrl: "https://control.example/",
    accessToken: async () => "synthetic-runtime-principal",
    now: () => now,
    async fetchImpl(input, init) {
      const request = new Request(input, init); requests.push(request);
      expect(request.headers.get("authorization")).toBe("Bearer synthetic-runtime-principal");
      expect(request.redirect).toBe("manual");
      if (request.method === "GET") {
        expect(new URL(request.url).searchParams.get("workspaceId")).toBeNull();
        return Response.json({ interfaces: options.interfaces ?? [selectedInterface], ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}) });
      }
      const body = await request.json();
      expect(body).toEqual({ permission: body.permission, dataScope: "app-shared.v1" });
      const { permission } = body;
      return Response.json({ access_token: `synthetic-invocation-${requests.length}`, token_type: "Bearer", token_use: "interface_app_data", scope: permission, resource: "https://storage.example/o", expires_in: 60, expires_at: new Date(now + 60_000).toISOString(), ...options.tokenChange }, { status: options.tokenStatus ?? 200 });
    },
  });
  return { authorize, requests };
}

test("one request pins authorized discovery and gets a new exact-scope token for every operation", async () => {
  const { authorize, requests } = fixture();
  const list = await authorize("storage.object.list");
  const read = await authorize("storage.object.read");
  const listAgain = await authorize("storage.object.list");
  expect(list.apiUrl).toBe("https://storage.example/o");
  expect(read.accessToken).not.toBe(list.accessToken);
  expect(listAgain.accessToken).not.toBe(list.accessToken);
  expect(requests.filter((request) => request.method === "GET")).toHaveLength(1);
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(3);
});

for (const tokenChange of [
  { scope: "storage.object.write" }, { resource: "https://other.example/o" },
  { expires_in: 61 }, { expires_in: 0 }, { expires_at: new Date(now).toISOString() },
  { expires_at: new Date(now + 61_000).toISOString() }, { access_token: "" },
  { access_token: "token\nheader" }, { token_type: "Basic" }, { token_use: "interface_oauth" }, { token_use: undefined },
]) {
  test(`invalid invocation response is refused: ${JSON.stringify(tokenChange)}`, async () => {
    await expect(fixture({ tokenChange }).authorize("storage.object.list")).rejects.toThrow("storage_invocation_authorization_invalid");
  });
}

test("ambiguous or paginated discovery never chooses another provider", async () => {
  for (const options of [{ interfaces: [] }, { interfaces: [selectedInterface, selectedInterface] }, { nextCursor: "more" }]) {
    const { authorize, requests } = fixture(options);
    await expect(authorize("storage.object.list")).rejects.toThrow("storage_interface_selection_required");
    await expect(authorize("storage.object.read")).rejects.toThrow("storage_interface_selection_required");
    expect(requests).toHaveLength(1);
  }
});

test("revoked authority is returned without a retry, discovery fallback or error-body disclosure", async () => {
  const { authorize, requests } = fixture({ tokenStatus: 403 });
  await expect(authorize("storage.object.list")).rejects.toThrow("storage_runtime_authorization_denied");
  expect(requests).toHaveLength(2);
});

test("configured control origins cannot carry credentials", () => {
  expect(() => createRuntimeStorageAuthorization({ controlApiUrl: "https://user:secret@control.example", accessToken: async () => "token" })).toThrow("storage_control_url_invalid");
});

test("caller cancellation after headers closes a pending Core response body", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const authorize = createRuntimeStorageAuthorization({
    controlApiUrl: "https://control.example",
    accessToken: async () => "synthetic-principal",
    signal: controller.signal,
    fetchImpl: async () => {
      controller.abort();
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    },
  });
  await expect(authorize("storage.object.list")).rejects.toThrow("storage_runtime_response_invalid");
  expect(cancelled).toBe(true);
});

test("a pre-cancelled Core lookup never sends a request", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const authorize = createRuntimeStorageAuthorization({
    controlApiUrl: "https://control.example", accessToken: async () => "synthetic-principal",
    signal: controller.signal,
    fetchImpl: async () => { calls++; throw new Error("must not send"); },
  });
  await expect(authorize("storage.object.list")).rejects.toThrow("storage_runtime_unavailable");
  expect(calls).toBe(0);
});

async function fixtureSessionCookie(subject = "fixture_principal", accessToken = "synthetic-runtime-principal") {
  const payload = Buffer.from(JSON.stringify({
    sub: subject, spaceIds: [], accessToken,
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("synthetic-session-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`session.${payload}`));
  return `takos_app_session=${payload}.${Buffer.from(signature).toString("base64url")}`;
}

test("the real auth guard uses the existing app-role policy and keeps Workspace as storage context", async () => {
  const cookie = await fixtureSessionCookie();
  const env = { APP_CAPSULE_ID: "office_app", TAKOS_SPACE_ID: "internal_partition", OIDC_ISSUER_URL: "https://accounts.example", OIDC_CLIENT_ID: "office-public", APP_SESSION_SECRET: "synthetic-session-secret" };
  for (const [claims, expected] of [
    [{ capsule_id: "office_app", app_role: "owner" }, 200],
    [{ capsule_id: "office_app", app_role: "member" }, 200],
    [{ capsule_id: "office_app" }, 403],
    [{ capsule_id: "other_app", app_role: "owner" }, 403],
    [{ capsule_id: "office_app", app_role: "viewer" }, 403],
  ] as const) {
    const response = await requireAppAuth(env, new Request("https://office.example/docs/api/documents", { headers: { cookie } }), {
      spaceId: "internal_partition",
      fetchImpl: async () => Response.json({ sub: "fixture_principal", takosumi: claims }),
    });
    expect(response?.status ?? 200).toBe(expected);
  }
});


test("Office login requests the runtime read grant only for configured app storage", async () => {
  for (const runtime of [false, true]) {
    const app = new Hono();
    registerAuthRoutes(app, {
      OIDC_ISSUER_URL: "https://accounts.example", OIDC_CLIENT_ID: "office-public",
      APP_SESSION_SECRET: "synthetic-session-secret",
      ...(runtime ? { TAKOSUMI_CONTROL_API_URL: "https://control.example" } : {}),
    });
    const response = await app.request("https://office.example/api/auth/login");
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.get("scope"))
      .toBe(runtime ? "openid profile email capsules:read" : "openid profile email");
  }
});


for (const url of ["", " ", "http://control.example", "https://user:secret@control.example", "https://control.example/?token=bad"]) {
  test(`invalid explicit runtime URL never falls back to static storage: ${JSON.stringify(url)}`, () => {
    expect(() => createOfficeStorageClient({
      TAKOSUMI_CONTROL_API_URL: url, OBJECT_STORAGE_API_URL: "https://legacy.example/o",
      OBJECT_STORAGE_ACCESS_TOKEN: "standing",
    }, new Request("https://office.example"), "workspace")).toThrow("storage_control_url_invalid");
  });
}

test("an invocation Authorization bearer is not substituted for an app login session", async () => {
  const result = await appRuntimeAccessToken({
    OIDC_ISSUER_URL: "https://accounts.example", OIDC_CLIENT_ID: "office-public",
    APP_SESSION_SECRET: "synthetic-session-secret", APP_CAPSULE_ID: "office_app",
  }, new Request("https://office.example/api/documents", { headers: { authorization: "Bearer invocation" } }), { spaceId: "workspace" });
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(401);
});


test("routed Suite APIs acquire authority from each incoming person instead of a Workspace cache", async () => {
  const runtimePrincipals: string[] = [];
  let serial = 0;
  const options = {
    async appUserInfoFetch(input: RequestInfo | URL, init?: RequestInit) {
      const bearer = new Request(input, init).headers.get("authorization");
      expect(["Bearer app-owner", "Bearer app-member"]).toContain(bearer ?? "");
      const who = bearer === "Bearer app-owner" ? "owner" : "member";
      return Response.json({ sub: who, takosumi: { capsule_id: "office_app", app_role: who } });
    },
    async runtimeFetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(input, init);
      runtimePrincipals.push(request.headers.get("authorization")!);
      if (request.method === "GET") return Response.json({ interfaces: [selectedInterface] });
      const body = await request.json();
      expect(body).toEqual({ permission: body.permission, dataScope: "app-shared.v1" });
      return Response.json({ access_token: `synthetic-invocation-${++serial}`, token_type: "Bearer",
        token_use: "interface_app_data", scope: body.permission, resource: "https://storage.example/o",
        expires_in: 60, expires_at: new Date(Date.now() + 60_000).toISOString() });
    },
    async storageFetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(input, init);
      expect(request.headers.get("authorization")).toMatch(/^Bearer synthetic-invocation-[0-9]+$/);
      expect(request.redirect).toBe("manual");
      if (request.method === "PUT") return new Response(null, { status: 201 });
      return new URL(request.url).pathname === "/o"
        ? Response.json({ objects: [] })
        : new Response(null, { status: 404 });
    },
  };
  const { app } = createOfficeApp({
    APP_URL: "https://office.example", APP_WORKSPACE_ID: "workspace", APP_CAPSULE_ID: "office_app",
    TAKOS_SPACE_ID: "workspace", OIDC_ISSUER_URL: "https://accounts.example", OIDC_CLIENT_ID: "office-public",
    APP_SESSION_SECRET: "synthetic-session-secret", TAKOSUMI_CONTROL_API_URL: "https://control.example",
    MCP_AUTH_TOKEN: "synthetic-mcp-auth",
  }, options);
  for (const path of ["/docs/api/documents", "/slide/api/presentations", "/sheet/api/spreadsheets", "/api/office/items", "/api/office/search?q=shared"]) {
    for (const who of ["owner", "member"]) {
      const start = runtimePrincipals.length;
      const response = await app.request(`https://office.example${path}`, { headers: { cookie: await fixtureSessionCookie(who, `app-${who}`) } });
      expect(response.status).toBe(200);
      expect(runtimePrincipals.length).toBeGreaterThan(start);
      expect(runtimePrincipals.slice(start).every(value => value === `Bearer app-${who}`)).toBe(true);
    }
  }
});


const runtimeBrowserEnv = {
  APP_URL: "https://office.example", APP_WORKSPACE_ID: "workspace", TAKOS_SPACE_ID: "workspace",
  APP_CAPSULE_ID: "office_app", OIDC_ISSUER_URL: "https://accounts.example", OIDC_CLIENT_ID: "office-public",
  APP_SESSION_SECRET: "synthetic-session-secret", TAKOSUMI_CONTROL_API_URL: "https://control.example",
  MCP_AUTH_TOKEN: "synthetic-mcp-auth", OBJECT_STORAGE_API_URL: "https://legacy.example/o",
  OBJECT_STORAGE_ACCESS_TOKEN: "synthetic-standing-storage", TAKOS_NATIVE_RENDERING: "0",
};

test("runtime health is session-free configuration readiness and labels storage as unprobed", async () => {
  let calls = 0;
  const never = async () => { calls++; throw new Error("health must not manufacture person authority"); };
  const { app } = createOfficeApp(runtimeBrowserEnv, { storageFetch: never, runtimeFetch: never, appUserInfoFetch: never });
  for (const path of ["/health", "/healthz"]) {
    const response = await app.request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "takos-office", storage: "per_request_authorization", storageProbed: false });
  }
  expect(calls).toBe(0);
});

test("cookie-less MCP keeps its explicit standalone storage route in mixed configuration", async () => {
  let staticCalls = 0, runtimeCalls = 0;
  const { app } = createOfficeApp(runtimeBrowserEnv, {
    async runtimeFetch() { runtimeCalls++; throw new Error("MCP cannot become an Office login"); },
    async storageFetch(input, init) {
      const request = new Request(input, init); staticCalls++;
      expect(new URL(request.url).origin).toBe("https://legacy.example");
      expect(request.headers.get("authorization")).toBe("Bearer synthetic-standing-storage");
      if (request.method === "PUT") return new Response(null, { status: 201 });
      return new URL(request.url).pathname === "/o" ? Response.json({ objects: [] }) : new Response(null, { status: 404 });
    },
  });
  const response = await app.request("https://office.example/mcp", {
    method: "POST", headers: { authorization: "Bearer synthetic-mcp-auth", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "docs_list", arguments: {} } }),
  });
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).not.toContain('"isError":true');
  expect(body).toContain("documents");
  expect(staticCalls).toBeGreaterThan(0);
  expect(runtimeCalls).toBe(0);
});


test("runtime health refuses invalid configuration without taking user or backend authority", async () => {
  for (const change of [{ TAKOSUMI_CONTROL_API_URL: " " }, { APP_CAPSULE_ID: undefined }, { ALLOW_UNAUTHENTICATED_ACCESS: "1" }]) {
    let calls = 0;
    const never = async () => { calls++; throw new Error("must not dispatch"); };
    const { app } = createOfficeApp({ ...runtimeBrowserEnv, ...change }, { storageFetch: never, runtimeFetch: never, appUserInfoFetch: never });
    expect((await app.request("/healthz")).status).toBe(503);
    expect(calls).toBe(0);
  }
});

test("runtime browser mode does not invent MCP storage when explicit standalone config is absent", async () => {
  const { app } = createOfficeApp({ ...runtimeBrowserEnv, OBJECT_STORAGE_ACCESS_TOKEN: undefined });
  const response = await app.request("https://office.example/mcp", { method: "POST", headers: { authorization: "Bearer synthetic-mcp-auth" } });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "object_storage_not_configured" });
});
