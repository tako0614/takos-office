import { expect, test } from "bun:test";
import { requireAppAuth } from "../shared/app-auth.ts";
import { createOfficeApp } from "../server.ts";
import { verifyInterfaceOAuthBearer } from "../shared/interface-oauth-auth.ts";

const sessionSecret = "synthetic-office-session-secret";
const env = {
  OIDC_ISSUER_URL: "https://accounts.example",
  OIDC_CLIENT_ID: "office-public",
  APP_SESSION_SECRET: sessionSecret,
  APP_CAPSULE_ID: "office_app",
  APP_WORKSPACE_ID: "internal_partition",
};

async function sessionCookie(
  spaceIds: string[] = [],
  expiresAt = Math.floor(Date.now() / 1000) + 600,
  subject = "fixture_principal",
  accessToken = "synthetic-runtime-principal",
) {
  const payload = Buffer.from(JSON.stringify({
    sub: subject,
    spaceIds,
    accessToken,
    exp: expiresAt,
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`session.${payload}`),
  );
  return `takos_app_session=${payload}.${Buffer.from(signature).toString("base64url")}`;
}

test.each(["owner", "member"])(
  "current app %s without Workspace claims reaches its configured storage namespace",
  async (role) => {
    let userInfoCalls = 0;
    const response = await requireAppAuth(
      env,
      new Request("https://office.example/docs/api/documents", {
        headers: { cookie: await sessionCookie() },
      }),
      {
        spaceId: "internal_partition",
        fetchImpl: async (input, init) => {
          userInfoCalls++;
          expect(String(input)).toBe("https://accounts.example/oauth/userinfo");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer synthetic-runtime-principal",
          );
          return Response.json({
            sub: "fixture_principal",
            takosumi: { capsule_id: "office_app", app_role: role },
          });
        },
      },
    );
    expect(response).toBeNull();
    expect(userInfoCalls).toBe(1);
  },
);

async function exercise(
  claims: Record<string, unknown>,
  options: {
    capturedSpaces?: string[];
    namespace?: string;
    envPatch?: Record<string, string | undefined>;
    userInfoStatus?: number;
    method?: string;
    origin?: string;
    expiresAt?: number;
    cookie?: string;
  } = {},
) {
  let userInfoCalls = 0;
  const response = await requireAppAuth(
    { ...env, ...options.envPatch },
    new Request("https://office.example/docs/api/documents", {
      method: options.method ?? "GET",
      headers: {
        cookie: options.cookie ?? await sessionCookie(options.capturedSpaces, options.expiresAt),
        ...(options.origin ? { origin: options.origin } : {}),
      },
    }),
    {
      spaceId: options.namespace ?? "internal_partition",
      fetchImpl: async () => {
        userInfoCalls++;
        return Response.json(
          { sub: "fixture_principal", ...claims },
          { status: options.userInfoStatus ?? 200 },
        );
      },
    },
  );
  return { response, userInfoCalls };
}

const memberClaims = {
  takosumi: { capsule_id: "office_app", app_role: "member" },
};

test("a valid app member cannot choose a different storage namespace", async () => {
  const { response, userInfoCalls } = await exercise(memberClaims, {
    namespace: "other_partition",
  });
  expect(response?.status).toBe(403);
  expect(await response?.json()).toEqual({ error: "workspace_owner_mismatch" });
  expect(userInfoCalls).toBe(1);
});

test("app identity does not invent a storage namespace when deployment configuration is missing", async () => {
  const { response } = await exercise(memberClaims, {
    envPatch: { APP_WORKSPACE_ID: undefined },
  });
  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({ error: "app_storage_namespace_not_configured" });
});

test("the standalone configured storage namespace remains usable without Workspace identity claims", async () => {
  const { response } = await exercise(memberClaims, {
    envPatch: { APP_WORKSPACE_ID: undefined, TAKOS_SPACE_ID: "internal_partition" },
  });
  expect(response).toBeNull();
});

test.each([
  { capsule_id: "office_app" },
  { capsule_id: "other_app", app_role: "owner" },
  { capsule_id: "office_app", app_role: "viewer" },
  { capsule_id: "office_app", app_role: ["owner"] },
  { app_role: "owner" },
])("missing, foreign or malformed app-role evidence grants no access: %j", async (takosumi) => {
  const { response } = await exercise({ takosumi });
  expect(response?.status).toBe(403);
});

test("an invocation-only Interface token never grants a browser app role", async () => {
  const { response } = await exercise({ ...memberClaims, token_use: "interface_oauth" });
  expect(response?.status).toBe(403);
});

test("a foreign app role cannot fall back to a co-tenant Workspace membership", async () => {
  const { response } = await exercise({
    workspace_memberships: ["internal_partition"],
    takosumi: {
      capsule_id: "other_app", app_role: "owner", workspace_id: "internal_partition",
    },
  }, { capturedSpaces: ["internal_partition"] });
  expect(response?.status).toBe(403);
});

test("legacy membership still needs both the captured namespace and current live evidence", async () => {
  const legacyClaims = {
    workspace_memberships: ["internal_partition"],
    takosumi: { capsule_id: "office_app", workspace_id: "internal_partition", role: "member" },
  };
  expect((await exercise(legacyClaims, { capturedSpaces: ["internal_partition"] })).response).toBeNull();
  expect((await exercise(legacyClaims)).response?.status).toBe(403);
  expect((await exercise({}, { capturedSpaces: ["internal_partition"] })).response?.status).toBe(403);
  expect((await exercise({
    workspace_memberships: ["other_partition"],
    takosumi: { capsule_id: "office_app", workspace_id: "other_partition", role: "member" },
  }, { capturedSpaces: ["other_partition"], namespace: "other_partition" })).response?.status).toBe(403);
});

test("legacy deployments without an App id keep their captured and live Workspace membership checks", async () => {
  const claims = { workspace_memberships: ["internal_partition"] };
  expect((await exercise(claims, {
    capturedSpaces: ["internal_partition"], envPatch: { APP_CAPSULE_ID: undefined },
  })).response).toBeNull();
  const denied = await exercise(claims, { envPatch: { APP_CAPSULE_ID: undefined } });
  expect(denied.response?.status).toBe(403);
  expect(denied.userInfoCalls).toBe(0);
});

test("the current subject and current app role are revalidated for every request", async () => {
  const cookie = await sessionCookie();
  expect((await exercise(memberClaims, { cookie })).response).toBeNull();
  expect((await exercise({ takosumi: { capsule_id: "office_app" } }, { cookie })).response?.status).toBe(403);
  expect((await exercise({ ...memberClaims, sub: "other_principal" }, { cookie })).response?.status).toBe(401);
});

test.each([401, 403, 503])("UserInfo failure %i is never replaced by cookie authority", async (userInfoStatus) => {
  const { response } = await exercise(memberClaims, { userInfoStatus });
  expect(response?.status).toBe(userInfoStatus === 503 ? 503 : 401);
});

test("expired sessions and cross-origin writes remain rejected before UserInfo", async () => {
  const expired = await exercise(memberClaims, { expiresAt: 1 });
  expect(expired.response?.status).toBe(401);
  expect(expired.userInfoCalls).toBe(0);
  const crossOrigin = await exercise(memberClaims, { method: "POST", origin: "https://other.example" });
  expect(crossOrigin.response?.status).toBe(403);
  expect(crossOrigin.userInfoCalls).toBe(0);
  expect((await exercise(memberClaims, { method: "POST", origin: "https://office.example" })).response).toBeNull();
});

const contentPaths = [
  "/api/office/items", "/api/office/search",
  "/docs/api/documents", "/slide/api/presentations", "/sheet/api/spreadsheets",
] as const;

function routedFixture() {
  const objects = new Map<string, { body: string; etag: string }>();
  const identities = new Map<string, Record<string, unknown>>();
  const cookies = new Map<string, Promise<string>>();
  let storageCalls = 0;
  let userInfoCalls = 0;
  let revision = 0;
  const { app } = createOfficeApp({
    ...env,
    APP_URL: "https://office.example",
    TAKOS_SPACE_ID: "internal_partition",
    OBJECT_STORAGE_API_URL: "https://objects.example",
    OBJECT_STORAGE_ACCESS_TOKEN: "synthetic-object-service-token",
    MCP_AUTH_TOKEN: "synthetic-standalone-mcp-token",
  }, {
    appUserInfoFetch: async (input, init) => {
      expect(String(input)).toBe("https://accounts.example/oauth/userinfo");
      userInfoCalls++;
      const token = new Headers(init?.headers).get("authorization")?.slice(7);
      const claims = token ? identities.get(token) : undefined;
      return Response.json(claims ?? {}, { status: claims ? 200 : 401 });
    },
    storageFetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      expect(url.origin).toBe("https://objects.example");
      expect(request.headers.get("authorization")).toBe("Bearer synthetic-object-service-token");
      storageCalls++;
      if (url.pathname === "/o") {
        const prefix = url.searchParams.get("prefix") ?? "";
        return Response.json({
          objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
          truncated: false,
        });
      }
      const key = decodeURIComponent(url.pathname.slice(3));
      const stored = objects.get(key);
      if (request.method === "GET") {
        return stored
          ? new Response(stored.body, { headers: { etag: stored.etag, "content-type": "application/json" } })
          : new Response(null, { status: 404 });
      }
      if (request.method === "PUT") {
        const match = request.headers.get("if-match");
        const absent = request.headers.get("if-none-match");
        if ((absent === "*" && stored) || (match !== null && match !== stored?.etag)) {
          return new Response(null, { status: 412 });
        }
        expect(absent === "*" || match !== null).toBe(true);
        const etag = `"fixture-${++revision}"`;
        objects.set(key, { body: await request.text(), etag });
        return new Response(null, { status: 201, headers: { etag } });
      }
      throw new Error("Unexpected synthetic object operation");
    },
  });
  return {
    app, identities,
    counts: () => ({ storageCalls, userInfoCalls }),
    async request(path: string, subject: string, capturedSpaces: string[] = [], init: RequestInit = {}) {
      const key = JSON.stringify([subject, capturedSpaces]);
      let cookie = cookies.get(key);
      if (!cookie) {
        cookie = sessionCookie(capturedSpaces, undefined, subject, `synthetic-access-${subject}`);
        cookies.set(key, cookie);
      }
      const headers = new Headers(init.headers);
      headers.set("cookie", await cookie);
      return app.fetch(new Request(`https://office.example${path}`, {
        ...init,
        headers,
      }));
    },
  };
}

test.each(["owner", "member"])("routed Root/Docs/Slides/Sheets APIs admit an exact app %s without Workspace identity", async (role) => {
  const fixture = routedFixture();
  fixture.identities.set("synthetic-access-user_a", {
    sub: "user_a", takosumi: { capsule_id: "office_app", app_role: role },
  });
  for (const path of contentPaths) {
    const response = await fixture.request(path, "user_a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(path.startsWith("/api/office/") ? { items: [] } : []);
  }
  expect(fixture.counts().userInfoCalls).toBeGreaterThanOrEqual(contentPaths.length);
});

test("ordinary and cross-app users are denied by every content route before object access", async () => {
  const fixture = routedFixture();
  for (const claims of [
    { sub: "user_a", takosumi: { capsule_id: "office_app" } },
    { sub: "user_a", workspace_memberships: ["internal_partition"], takosumi: { capsule_id: "other_app", app_role: "owner", workspace_id: "internal_partition" } },
  ]) {
    fixture.identities.set("synthetic-access-user_a", claims);
    for (const path of contentPaths) {
      expect((await fixture.request(path, "user_a", ["internal_partition"])).status).toBe(403);
    }
  }
  expect(fixture.counts().storageCalls).toBe(0);
});

test("routed APIs recheck role revocation and subject changes using the same session", async () => {
  const fixture = routedFixture();
  fixture.identities.set("synthetic-access-user_a", { sub: "user_a", ...memberClaims });
  for (const path of contentPaths) expect((await fixture.request(path, "user_a")).status).toBe(200);
  const before = fixture.counts().storageCalls;
  fixture.identities.set("synthetic-access-user_a", { sub: "user_a", takosumi: { capsule_id: "office_app" } });
  for (const path of contentPaths) expect((await fixture.request(path, "user_a")).status).toBe(403);
  fixture.identities.set("synthetic-access-user_a", { sub: "other_subject", ...memberClaims });
  for (const path of contentPaths) expect((await fixture.request(path, "user_a")).status).toBe(401);
  expect(fixture.counts().storageCalls).toBe(before);
});

test("routed legacy Workspace sessions retain their captured and current membership", async () => {
  const fixture = routedFixture();
  fixture.identities.set("synthetic-access-user_a", {
    sub: "user_a", workspace_memberships: ["internal_partition"],
    takosumi: { capsule_id: "office_app", workspace_id: "internal_partition", role: "member" },
  });
  for (const path of contentPaths) {
    expect((await fixture.request(path, "user_a", ["internal_partition"])).status).toBe(200);
    expect((await fixture.request(path, "user_a")).status).toBe(403);
  }
});

test("each routed API rejects caller-selected namespace overrides without object access", async () => {
  const fixture = routedFixture();
  fixture.identities.set("synthetic-access-user_a", { sub: "user_a", ...memberClaims });
  for (const path of contentPaths) {
    expect((await fixture.request(`${path}?space_id=other_partition`, "user_a")).status).toBe(403);
  }
  expect(fixture.counts().storageCalls).toBe(0);
});

test("an app owner and another member share the configured Office document namespace", async () => {
  const fixture = routedFixture();
  fixture.identities.set("synthetic-access-user_a", { sub: "user_a", takosumi: { capsule_id: "office_app", app_role: "owner" } });
  fixture.identities.set("synthetic-access-user_b", { sub: "user_b", ...memberClaims });
  const created = await fixture.request("/docs/api/documents", "user_a", [], {
    method: "POST", headers: { origin: "https://office.example", "content-type": "application/json" },
    body: JSON.stringify({ title: "Shared fixture", content: "persisted" }),
  });
  expect(created.status).toBe(201);
  const document = await created.json();
  const read = await fixture.request(`/docs/api/documents/${document.id}`, "user_b");
  expect(read.status).toBe(200);
  expect((await read.json()).content).toBe("persisted");
});

test.each([
  { withWorkspace: true, workspaceId: undefined, expected: 200 },
  { withWorkspace: false, workspaceId: undefined, expected: 200 },
  { withWorkspace: false, workspaceId: "internal_partition", expected: 200 },
  { withWorkspace: false, workspaceId: "other_partition", expected: 401 },
])("MCP Workspace evidence and configured namespace: %j", async ({ withWorkspace, workspaceId, expected }) => {
  const { app } = createOfficeApp({
    ...env, APP_URL: "https://office.example", TAKOS_SPACE_ID: "internal_partition",
    APP_WORKSPACE_ID: withWorkspace ? env.APP_WORKSPACE_ID : undefined,
    OBJECT_STORAGE_API_URL: "https://objects.example", OBJECT_STORAGE_ACCESS_TOKEN: "synthetic-object-service-token",
  }, {
    interfaceUserInfoFetch: async () => Response.json({
      token_use: "interface_oauth", sub: "interface_principal", aud: "https://office.example/mcp", scope: "mcp.invoke",
      takosumi: { capsule_id: "office_app", interface_id: "office_mcp", interface_binding_id: "mcp_binding", interface_resolved_revision: 1, ...(workspaceId === undefined ? {} : { workspace_id: workspaceId }) },
    }),
  });
  const response = await app.fetch(new Request("https://office.example/mcp", {
    method: "POST",
    headers: { authorization: "Bearer taksrv_synthetic_interface", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } }),
  }));
  expect(response.status).toBe(expected);
  const body = await response.text();
  if (expected === 200) {
    expect(body).toContain('"protocolVersion"');
    expect(body).not.toContain('"error"');
  }
});

test("workspace-less Interface credentials retain every other invocation evidence requirement", async () => {
  const claims = {
    token_use: "interface_oauth", sub: "interface_principal",
    aud: "https://office.example/mcp", scope: "mcp.invoke",
    takosumi: { capsule_id: "office_app", interface_id: "office_mcp", interface_binding_id: "mcp_binding", interface_resolved_revision: 1 },
  };
  const verify = (body: unknown, expectedCapsuleId: string | null = "office_app") =>
    verifyInterfaceOAuthBearer(new Request("https://office.example/mcp"), "taksrv_synthetic_interface", "mcp.invoke", {
      issuerUrl: "https://accounts.example", expectedAudience: "https://office.example/mcp",
      expectedWorkspaceId: "internal_partition", expectedCapsuleId: expectedCapsuleId ?? undefined,
      fetchImpl: async () => Response.json(body),
    });
  expect(await verify(claims)).toBe(true);
  for (const invalid of [
    { ...claims, token_use: "ordinary" }, { ...claims, sub: "" },
    { ...claims, aud: "https://other.example/mcp" }, { ...claims, scope: "mcp.invoke other" },
    { ...claims, takosumi: { ...claims.takosumi, capsule_id: "other_app" } },
    { ...claims, takosumi: { ...claims.takosumi, interface_id: undefined } },
    { ...claims, takosumi: { ...claims.takosumi, interface_binding_id: undefined } },
    { ...claims, takosumi: { ...claims.takosumi, interface_resolved_revision: 0 } },
    { ...claims, takosumi: { ...claims.takosumi, workspace_id: null } },
    { ...claims, takosumi: { ...claims.takosumi, workspace_id: "other_partition" } },
  ]) expect(await verify(invalid)).toBe(false);
  expect(await verify(claims, null)).toBe(false);
  expect(await verify(claims, "")).toBe(false);
});

test("Capsule-scoped MCP cannot choose a namespace when only a standalone coordinate is configured", async () => {
  let userInfoCalls = 0;
  const { app } = createOfficeApp({
    ...env, APP_WORKSPACE_ID: undefined,
    APP_URL: "https://office.example", TAKOS_SPACE_ID: "internal_partition",
    OBJECT_STORAGE_API_URL: "https://objects.example", OBJECT_STORAGE_ACCESS_TOKEN: "synthetic-object-service-token",
  }, {
    interfaceUserInfoFetch: async () => { userInfoCalls++; throw new Error("must not invoke"); },
  });
  const response = await app.fetch(new Request("https://office.example/mcp?space_id=other_partition", { method: "POST" }));
  expect(response.status).toBe(403);
  expect(userInfoCalls).toBe(0);
});

test("Capsule-scoped MCP fails closed when the deployment has no storage namespace", async () => {
  const { app } = createOfficeApp({
    ...env, APP_WORKSPACE_ID: undefined, APP_URL: "https://office.example",
    OBJECT_STORAGE_API_URL: "https://objects.example", OBJECT_STORAGE_ACCESS_TOKEN: "synthetic-object-service-token",
  });
  const response = await app.fetch(new Request("https://office.example/mcp?space_id=chosen_by_caller", { method: "POST" }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "app_storage_namespace_not_configured" });
});
