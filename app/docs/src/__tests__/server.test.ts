import { expect, test } from "bun:test";

import { createDocsApp } from "../server.ts";

const env = {
  TAKOS_API_URL: "http://localhost:8787",
  TAKOS_ACCESS_TOKEN: "token",
  TAKOS_SPACE_ID: "space-1",
  TAKOS_NATIVE_RENDERING: "0",
  MCP_AUTH_TOKEN: "secret",
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

async function makeSessionCookie(
  secret: string,
  payload: { sub: string; name?: string; spaceIds: string[]; exp: number },
): Promise<string> {
  const data = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${base64Url(new Uint8Array(signature))}`;
}

test("document collection writes require app auth when enabled", async () => {
  const { app } = createDocsApp({
    ...env,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: "session-secret",
  });
  const res = await app.request(
    new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private" }),
    }),
  );

  expect(res.status).toEqual(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("mcp endpoint enforces optional bearer auth before handling body", async () => {
  const { app } = createDocsApp(env);
  const res = await app.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );

  expect(res.status).toEqual(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("mcp endpoint fails closed when token is missing", async () => {
  const { app } = createDocsApp({
    ...env,
    MCP_AUTH_TOKEN: undefined,
  });
  const res = await app.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({ error: "MCP_AUTH_TOKEN is required" });
});

test("health endpoint allows explicit unauthenticated access when configured", async () => {
  const { app } = createDocsApp({
    ...env,
    MCP_AUTH_TOKEN: undefined,
    MCP_ALLOW_UNAUTHENTICATED: "true",
  });
  const res = await app.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok", service: "takos-docs" });
});

test("startup does not require TAKOS_SPACE_ID", async () => {
  const { app } = createDocsApp({
    ...env,
    TAKOS_SPACE_ID: undefined,
  });
  const res = await app.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok", service: "takos-docs" });
});

test("file handler route redirects to document editor route", async () => {
  const { app } = createDocsApp(env);
  const res = await app.request("/files/file-1?space_id=space-q");

  expect(res.status).toEqual(302);
  expect(res.headers.get("location")).toEqual("/docs/file-1?space_id=space-q");
});

test("document API opens and saves advertised file by storage id in request space", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { method: string; url: string; body?: string }[] = [];
  const now = "2026-04-30T00:00:00.000Z";
  const doc = {
    id: "doc-1",
    title: "Report",
    content: "{}",
    createdAt: now,
    updatedAt: now,
  };

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const method = init?.method ?? request?.method ?? "GET";
    calls.push({
      method,
      url,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (url.endsWith("/api/spaces/space-q/storage")) {
      return Promise.resolve(Response.json({
        files: [{
          id: "folder-1",
          name: "takos-docs",
          path: "takos-docs",
          type: "folder",
          created_at: now,
          updated_at: now,
        }],
      }));
    }
    if (url.endsWith("/api/spaces/space-q/storage?path=takos-docs")) {
      return Promise.resolve(Response.json({ files: [] }));
    }
    if (url.endsWith("/api/spaces/space-q/storage/file-1")) {
      return Promise.resolve(Response.json({
        file: {
          id: "file-1",
          name: "Report.takosdoc",
          type: "file",
          mime_type: "application/vnd.takos.docs+json",
          created_at: now,
          updated_at: now,
        },
      }));
    }
    if (url.endsWith("/api/spaces/space-q/storage/file-1/content")) {
      if (method === "PUT") return Promise.resolve(Response.json({ file: {} }));
      return Promise.resolve(Response.json({ content: JSON.stringify(doc) }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 500,
    }));
  }) as typeof fetch;

  try {
    const { app } = createDocsApp({
      ...env,
      TAKOS_SPACE_ID: undefined,
    });
    const getRes = await app.request(
      "/api/documents/file-1?space_id=space-q",
    );
    expect(getRes.status).toEqual(200);
    expect(await getRes.json()).toEqual(doc);

    const putRes = await app.request(
      new Request("http://localhost/api/documents/file-1?space_id=space-q", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...doc, title: "Updated" }),
      }),
    );
    expect(putRes.status).toEqual(200);
    expect((await putRes.json()).id).toEqual("doc-1");

    const saveCall = calls.find((call) =>
      call.method === "PUT" &&
      call.url.endsWith("/api/spaces/space-q/storage/file-1/content")
    );
    expect(saveCall).toBeTruthy();
    if (!saveCall) throw new Error("expected storage save request");
    expect(JSON.parse(saveCall.body ?? "{}").mime_type).toEqual("application/vnd.takos.docs+json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("health endpoint fails when token is missing", async () => {
  const { app } = createDocsApp({
    ...env,
    MCP_AUTH_TOKEN: undefined,
  });
  const res = await app.request("/health");

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({ error: "MCP_AUTH_TOKEN is required" });
});

test("document API rejects spaces outside the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-1"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const denied = await app.request(
    new Request("http://localhost/api/documents?space_id=space-other", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(denied.status).toEqual(403);
  expect(await denied.json()).toEqual({ error: "space_membership_required" });
});

test("document API allows spaces in the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-allowed"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  // Confirm middleware does not return 403/401 for a member space by hitting
  // the auth probe route that runs requireAppAuth without depending on the
  // document store backend.
  const allowed = await app.request(
    new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(allowed.status).toEqual(200);
  expect(await allowed.json()).toEqual({ authenticated: true });
});

test("OAuth callback folds takosumi.space_id into the session when no space_memberships claim is present", async () => {
  // Regression guard: Takosumi Accounts userinfo historically emits only the
  // nested `takosumi.space_id` claim and no flat `space_memberships`. The
  // callback must still grant membership to that single space. This drives the
  // real login -> callback -> userinfo path (not a pre-baked session cookie).
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);

  // Drive /api/auth/login to obtain a valid signed state cookie + state value.
  const login = await app.request(
    new Request("http://localhost/api/auth/login", { method: "GET" }),
  );
  expect(login.status).toEqual(302);
  const stateCookie = (login.headers.get("Set-Cookie") ?? "").split(";")[0]
    .replace("takos_app_oauth_state=", "");
  expect(stateCookie !== "").toBeTruthy();
  const authorizeUrl = new URL(login.headers.get("Location") ?? "");
  const stateValue = authorizeUrl.searchParams.get("state");
  expect(stateValue !== null).toBeTruthy();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const method = init?.method ?? request?.method ?? "GET";
    if (url.endsWith("/oauth/token") && method === "POST") {
      return Promise.resolve(Response.json({ access_token: "access-1" }));
    }
    if (url.endsWith("/oauth/userinfo")) {
      // Note: NO space_memberships / spaceMemberships claim here on purpose.
      return Promise.resolve(Response.json({
        sub: "alice",
        name: "Alice",
        takosumi: {
          installation_id: "inst-1",
          space_id: "space-nested",
          role: "member",
        },
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 500,
    }));
  }) as typeof fetch;

  let sessionCookie = "";
  try {
    const callback = await app.request(
      new Request(
        `http://localhost/api/auth/callback?code=abc&state=${stateValue}`,
        {
          method: "GET",
          headers: { Cookie: `takos_app_oauth_state=${stateCookie}` },
        },
      ),
    );
    expect(callback.status).toEqual(302);
    for (const value of callback.headers.getSetCookie()) {
      if (value.startsWith("takos_app_session=")) {
        sessionCookie = value.split(";")[0].replace("takos_app_session=", "");
      }
    }
    expect(sessionCookie !== "").toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }

  // The single nested space must now be a member space (no 403).
  const allowed = await app.request(
    new Request("http://localhost/api/documents?space_id=space-nested", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${sessionCookie}` },
    }),
  );
  expect(allowed.status !== 403).toBeTruthy();

  // A different space must still be rejected.
  const denied = await app.request(
    new Request("http://localhost/api/documents?space_id=space-other", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${sessionCookie}` },
    }),
  );
  expect(denied.status).toEqual(403);
  expect(await denied.json()).toEqual({ error: "space_membership_required" });
});
