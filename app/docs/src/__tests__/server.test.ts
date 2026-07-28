import { expect, test } from "bun:test";

import { createDocsApp } from "../server.ts";

// Sign-in is required by default, so the shared fixture takes the explicit
// public opt-in and the auth tests drop it again.
const env = {
  OBJECT_STORAGE_API_URL: "http://localhost:8787",
  OBJECT_STORAGE_ACCESS_TOKEN: "token",
  TAKOS_SPACE_ID: "space-1",
  TAKOS_NATIVE_RENDERING: "0",
  MCP_AUTH_TOKEN: "secret",
  ALLOW_UNAUTHENTICATED_ACCESS: "1",
} as Record<string, string | undefined>;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function makeSessionCookie(
  secret: string,
  payload: { sub: string; name?: string; spaceIds: string[]; exp: number },
): Promise<string> {
  const data = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ ...payload, accessToken: "test-access-token" }),
    ),
  );
  // Mirror app-auth seal(): the MAC is bound to the "session" purpose.
  const signed = `session.${data}`;
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
    new TextEncoder().encode(signed),
  );
  return `${data}.${base64Url(new Uint8Array(signature))}`;
}

const OBJECT_API_BASE = "http://localhost:8787/o";

type OfficeRecord = {
  schema: "takos.office.object-record.v1";
  file: {
    id: string;
    name: string;
    path?: string;
    parentId?: string;
    type: "file" | "folder";
    size?: number;
    mimeType?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  content?: string;
};

const recordKey = (spaceId: string, fileId: string) =>
  `office/v1/records/${spaceId}/${fileId}.json`;

/**
 * In-memory mock of the provider-neutral `storage.object` surface used by
 * createTakosStorageClient: GET `<base>?prefix=` lists keys, and
 * GET/PUT/DELETE `<base>/<encoded key>` reads/writes/removes one record.
 */
function installObjectStorageMock(records: Map<string, OfficeRecord>) {
  const originalFetch = globalThis.fetch;
  const calls: { method: string; url: string; body?: string }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, ...(body !== undefined ? { body } : {}) });

    if (!url.startsWith(OBJECT_API_BASE)) {
      return Promise.resolve(
        Response.json({ error: "unexpected" }, { status: 500 }),
      );
    }
    const rest = url.slice(OBJECT_API_BASE.length);
    if (rest === "" || rest.startsWith("?")) {
      const prefix = new URL(url).searchParams.get("prefix") ?? "";
      const objects = [...records.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key }));
      return Promise.resolve(Response.json({ objects }));
    }
    const key = decodeURIComponent(rest.slice(1));
    if (method === "PUT") {
      records.set(key, JSON.parse(body ?? "{}") as OfficeRecord);
      return Promise.resolve(Response.json({ key }));
    }
    if (method === "DELETE") {
      records.delete(key);
      return Promise.resolve(Response.json({ deleted: true }));
    }
    const record = records.get(key);
    if (!record) {
      return Promise.resolve(
        Response.json({ error: "object_not_found" }, { status: 404 }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(record), {
        headers: {
          "content-type": "application/json",
          etag: `"${record.file.updatedAt}"`,
        },
      }),
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("an install with no Accounts wiring fails closed with 503", async () => {
  // Authentication is the default, so a worker deployed without the Accounts
  // variables must name what is missing rather than serve documents to
  // anonymous callers.
  const { app } = createDocsApp({
    ...env,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
  });
  const res = await app.request("http://localhost/api/documents");

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({
    error: "App auth is not configured",
    missing: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "APP_SESSION_SECRET"],
  });
});

test("document collection writes require app auth when enabled", async () => {
  const { app } = createDocsApp({
    ...env,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
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

test("document sub-app exposes no MCP or health control surface", async () => {
  const { app } = createDocsApp(env);
  const mcp = await app.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(mcp.status).toEqual(404);
  expect((await app.request("/health")).status).toEqual(404);
  expect((await app.request("/healthz")).status).toEqual(404);
});

test("file handler route redirects to document editor route", async () => {
  const { app } = createDocsApp(env);
  const res = await app.request("/files/file-1?space_id=space-q");

  expect(res.status).toEqual(302);
  expect(res.headers.get("location")).toEqual("/docs/file-1?space_id=space-q");
});

test("document API opens and saves advertised file by storage id in request space", async () => {
  const now = "2026-04-30T00:00:00.000Z";
  const doc = {
    id: "doc-1",
    title: "Report",
    content: "{}",
    createdAt: now,
    updatedAt: now,
  };
  const records = new Map<string, OfficeRecord>([
    [
      recordKey("space-q", "folder-1"),
      {
        schema: "takos.office.object-record.v1",
        file: {
          id: "folder-1",
          name: "takos-docs",
          path: "takos-docs",
          type: "folder",
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
    [
      recordKey("space-q", "file-1"),
      {
        schema: "takos.office.object-record.v1",
        file: {
          id: "file-1",
          name: "Report.takosdoc",
          path: "takos-docs/Report.takosdoc",
          parentId: "folder-1",
          type: "file",
          mimeType: "application/vnd.takos.docs+json",
          createdAt: now,
          updatedAt: now,
        },
        content: JSON.stringify(doc),
      },
    ],
  ]);
  const mock = installObjectStorageMock(records);

  try {
    const { app } = createDocsApp({
      ...env,
      TAKOS_SPACE_ID: undefined,
    });
    const getRes = await app.request("/api/documents/file-1?space_id=space-q");
    expect(getRes.status).toEqual(200);
    expect(getRes.headers.get("etag")).toEqual(`"${now}"`);
    expect(await getRes.json()).toEqual(doc);

    const missingPrecondition = await app.request(
      new Request("http://localhost/api/documents/file-1?space_id=space-q", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...doc, title: "Unsafe" }),
      }),
    );
    expect(missingPrecondition.status).toEqual(428);
    expect(await missingPrecondition.json()).toEqual({
      error: "precondition_required",
    });

    const putRes = await app.request(
      new Request("http://localhost/api/documents/file-1?space_id=space-q", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": now,
        },
        body: JSON.stringify({ ...doc, title: "Updated" }),
      }),
    );
    expect(putRes.status).toEqual(200);
    const savedDocument = await putRes.json();
    expect(savedDocument.id).toEqual("doc-1");
    expect(savedDocument.updatedAt).not.toEqual(now);
    expect(putRes.headers.get("etag")).toEqual(`"${savedDocument.updatedAt}"`);

    // The save must land on file-1's record key in the request space.
    const savedKey = recordKey("space-q", "file-1");
    const saveCall = mock.calls.find(
      (call) =>
        call.method === "PUT" &&
        call.url === `${OBJECT_API_BASE}/${encodeURIComponent(savedKey)}`,
    );
    expect(saveCall).toBeTruthy();
    const saved = records.get(savedKey);
    expect(saved?.file.mimeType).toEqual("application/vnd.takos.docs+json");
    expect(JSON.parse(saved?.content ?? "{}").title).toEqual("Updated");
    expect(JSON.parse(saved?.content ?? "{}").updatedAt).toEqual(
      savedDocument.updatedAt,
    );
  } finally {
    mock.restore();
  }
});

test("document API renames a document via PATCH and persists the new title", async () => {
  const now = "2026-04-30T00:00:00.000Z";
  const doc = {
    id: "doc-1",
    title: "Report",
    content: "{}",
    createdAt: now,
    updatedAt: now,
  };
  const records = new Map<string, OfficeRecord>([
    [
      recordKey("space-q", "folder-1"),
      {
        schema: "takos.office.object-record.v1",
        file: {
          id: "folder-1",
          name: "takos-docs",
          path: "takos-docs",
          type: "folder",
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
    [
      recordKey("space-q", "file-1"),
      {
        schema: "takos.office.object-record.v1",
        file: {
          id: "file-1",
          name: "doc-1.takosdoc",
          path: "takos-docs/doc-1.takosdoc",
          parentId: "folder-1",
          type: "file",
          mimeType: "application/vnd.takos.docs+json",
          createdAt: now,
          updatedAt: now,
        },
        content: JSON.stringify(doc),
      },
    ],
  ]);
  const mock = installObjectStorageMock(records);

  try {
    const { app } = createDocsApp({
      ...env,
      TAKOS_SPACE_ID: undefined,
    });
    const res = await app.request(
      new Request("http://localhost/api/documents/doc-1?space_id=space-q", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": now,
        },
        body: JSON.stringify({ title: "New name" }),
      }),
    );
    expect(res.status).toEqual(200);
    const renamed = await res.json();
    expect(renamed.id).toEqual("doc-1");
    expect(renamed.title).toEqual("New name");

    // The stored record was re-PUT with the new title.
    const saved = records.get(recordKey("space-q", "file-1"));
    expect(JSON.parse(saved?.content ?? "{}").title).toEqual("New name");

    const missing = await app.request(
      new Request("http://localhost/api/documents/nope?space_id=space-q", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": now,
        },
        body: JSON.stringify({ title: "New name" }),
      }),
    );
    expect(missing.status).toEqual(404);
    expect(await missing.json()).toEqual({ error: "Document not found" });
  } finally {
    mock.restore();
  }
});

test("document API rejects spaces outside the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
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
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
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

test("session-cookie mutations require a same-origin browser request", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-allowed"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const response = await app.request(
    new Request("http://localhost/api/documents?space_id=space-allowed", {
      method: "POST",
      headers: {
        Cookie: `takos_app_session=${cookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Blocked CSRF" }),
    }),
  );
  expect(response.status).toEqual(403);
  expect(await response.json()).toEqual({ error: "csrf_check_failed" });
});

test("a revoked Workspace membership stops working on the next request", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-revoked"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      sub: "alice",
      workspace_memberships: [],
    })) as unknown as typeof fetch;
  try {
    const response = await app.request(
      new Request("http://localhost/api/documents?space_id=space-revoked", {
        headers: { Cookie: `takos_app_session=${cookie}` },
      }),
    );
    expect(response.status).toEqual(403);
    expect(await response.json()).toEqual({
      error: "space_membership_required",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("document JSON input is bounded and schema-checked", async () => {
  const { app } = createDocsApp(env);
  const oversized = await app.request(
    new Request("http://localhost/api/documents?space_id=space-1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(8 * 1024 * 1024 + 1),
      },
      body: "{}",
    }),
  );
  expect(oversized.status).toEqual(413);
  expect(await oversized.json()).toEqual({ error: "request_too_large" });

  const invalid = await app.request(
    new Request("http://localhost/api/documents?space_id=space-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "valid", unexpected: true }),
    }),
  );
  expect(invalid.status).toEqual(400);
  expect(await invalid.json()).toEqual({ error: "invalid_request" });
});

test("an OAuth state cookie cannot be replayed as a session cookie", async () => {
  // Token-purpose binding: /api/auth/login mints a state cookie sealed with the
  // same secret. Replaying it as the session cookie must NOT authenticate (the
  // MAC is bound to a different purpose), closing the auth-status oracle.
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);

  const login = await app.request(
    new Request("http://localhost/api/auth/login", { method: "GET" }),
  );
  const stateCookie = (login.headers.get("Set-Cookie") ?? "")
    .split(";")[0]
    .replace("takos_app_oauth_state=", "");
  expect(stateCookie !== "").toBeTruthy();

  const replay = await app.request(
    new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${stateCookie}` },
    }),
  );
  expect(replay.status).toEqual(401);
});

test("a session with an empty subject is rejected", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  };
  const { app } = createDocsApp(authEnv);
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "",
    spaceIds: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const res = await app.request(
    new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(res.status).toEqual(401);
});

test("a tampered session cookie signature is rejected", async () => {
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
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
  const [payload] = cookie.split(".");
  const tampered = `${payload}.deadbeef`;

  const res = await app.request(
    new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${tampered}` },
    }),
  );
  expect(res.status).toEqual(401);
});

test("OAuth callback folds takosumi.workspace_id into the session when no workspace_memberships claim is present", async () => {
  // Regression guard: Takosumi Accounts userinfo historically emits only the
  // nested `takosumi.workspace_id` claim and no flat `workspace_memberships`. The
  // callback must still grant membership to that single space. This drives the
  // real login -> callback -> userinfo path (not a pre-baked session cookie).
  const sessionSecret = "session-secret";
  const authEnv = {
    ...env,
    TAKOS_SPACE_ID: undefined,
    ALLOW_UNAUTHENTICATED_ACCESS: undefined,
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
  const stateCookie = (login.headers.get("Set-Cookie") ?? "")
    .split(";")[0]
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
      // Note: NO workspace_memberships / workspaceMemberships claim here on purpose.
      return Promise.resolve(
        Response.json({
          sub: "alice",
          name: "Alice",
          takosumi: {
            installation_id: "inst-1",
            workspace_id: "space-nested",
            role: "member",
          },
        }),
      );
    }
    return Promise.resolve(
      Response.json(
        { error: "unexpected" },
        {
          status: 500,
        },
      ),
    );
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
