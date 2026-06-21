import { expect, test } from "bun:test";

import {
  createSlideAppFromEnv,
  SLIDE_MAX_MCP_REQUEST_BYTES,
} from "../server.ts";

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

test("health endpoint returns ok", async () => {
  const app = createSlideAppFromEnv(env);
  const res = await app.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("presentation collection writes require app auth when enabled", async () => {
  const app = createSlideAppFromEnv({
    ...env,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: "session-secret",
  });
  const res = await app.request(
    new Request("http://localhost/api/presentations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Private" }),
    }),
  );

  expect(res.status).toEqual(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("mcp endpoint rejects oversized request bodies", async () => {
  const app = createSlideAppFromEnv(env);
  const res = await app.request(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Authorization": "Bearer secret",
        "content-type": "application/json",
        "content-length": String(SLIDE_MAX_MCP_REQUEST_BYTES + 1),
      },
      body: "{}",
    }),
  );

  expect(res.status).toEqual(413);
  expect(await res.json()).toEqual({ error: "Request body too large" });
});

test("mcp endpoint enforces optional bearer auth before handling body", async () => {
  const app = createSlideAppFromEnv(env);
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
  const app = createSlideAppFromEnv({
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
  const app = createSlideAppFromEnv({
    ...env,
    MCP_AUTH_TOKEN: undefined,
    MCP_ALLOW_UNAUTHENTICATED: "true",
  });
  const res = await app.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("startup does not require TAKOS_SPACE_ID", async () => {
  const app = createSlideAppFromEnv({
    ...env,
    TAKOS_SPACE_ID: undefined,
  });
  const res = await app.request("/health");

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("file handler route redirects to presentation editor route", async () => {
  const app = createSlideAppFromEnv(env);
  const res = await app.request("/files/file-1?space_id=space-q");

  expect(res.status).toEqual(302);
  expect(res.headers.get("location")).toEqual("/slide/file-1?space_id=space-q");
});

test("presentation API opens and saves advertised file by storage id in request space", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { method: string; url: string; body?: string }[] = [];
  const now = "2026-04-30T00:00:00.000Z";
  const presentation = {
    id: "pres-1",
    title: "Deck",
    slides: [{ id: "slide-1", elements: [], background: "#ffffff" }],
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
          name: "takos-slide",
          path: "takos-slide",
          type: "folder",
          created_at: now,
          updated_at: now,
        }],
      }));
    }
    if (url.endsWith("/api/spaces/space-q/storage?path=takos-slide")) {
      return Promise.resolve(Response.json({ files: [] }));
    }
    if (url.endsWith("/api/spaces/space-q/storage/file-1")) {
      return Promise.resolve(Response.json({
        file: {
          id: "file-1",
          name: "Deck.takosslide",
          type: "file",
          mime_type: "application/vnd.takos.slide+json",
          created_at: now,
          updated_at: now,
        },
      }));
    }
    if (url.endsWith("/api/spaces/space-q/storage/file-1/content")) {
      if (method === "PUT") return Promise.resolve(Response.json({ file: {} }));
      return Promise.resolve(
        Response.json({ content: JSON.stringify(presentation) }),
      );
    }
    return Promise.resolve(Response.json({ error: "unexpected" }, {
      status: 500,
    }));
  }) as typeof fetch;

  try {
    const app = createSlideAppFromEnv({
      ...env,
      TAKOS_SPACE_ID: undefined,
    });
    const getRes = await app.request(
      "/api/presentations/file-1?space_id=space-q",
    );
    expect(getRes.status).toEqual(200);
    expect(await getRes.json()).toEqual(presentation);

    const putRes = await app.request(
      new Request(
        "http://localhost/api/presentations/file-1?space_id=space-q",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...presentation, title: "Updated" }),
        },
      ),
    );
    expect(putRes.status).toEqual(200);
    expect((await putRes.json()).id).toEqual("pres-1");

    const saveCall = calls.find((call) =>
      call.method === "PUT" &&
      call.url.endsWith("/api/spaces/space-q/storage/file-1/content")
    );
    expect(saveCall).toBeTruthy();
    if (!saveCall) throw new Error("Expected storage save call");
    expect(JSON.parse(saveCall.body ?? "{}").mime_type).toEqual(
      "application/vnd.takos.slide+json",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("health endpoint fails when token is missing", async () => {
  const app = createSlideAppFromEnv({
    ...env,
    MCP_AUTH_TOKEN: undefined,
  });
  const res = await app.request("/health");

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({ error: "MCP_AUTH_TOKEN is required" });
});

test("presentation API rejects spaces outside the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const app = createSlideAppFromEnv({
    ...env,
    TAKOS_SPACE_ID: undefined,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  });
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-1"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const denied = await app.request(
    new Request("http://localhost/api/presentations?space_id=space-other", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(denied.status).toEqual(403);
  expect(await denied.json()).toEqual({ error: "space_membership_required" });
});

test("presentation API allows spaces in the subject's membership", async () => {
  const sessionSecret = "session-secret";
  const app = createSlideAppFromEnv({
    ...env,
    TAKOS_SPACE_ID: undefined,
    APP_AUTH_REQUIRED: "1",
    OAUTH_ISSUER_URL: "https://takos.example",
    OAUTH_CLIENT_ID: "client",
    OAUTH_CLIENT_SECRET: "secret",
    APP_SESSION_SECRET: sessionSecret,
  });
  const cookie = await makeSessionCookie(sessionSecret, {
    sub: "alice",
    spaceIds: ["space-allowed"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  // Probe the auth-only route to confirm middleware accepts a member subject.
  const allowed = await app.request(
    new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { Cookie: `takos_app_session=${cookie}` },
    }),
  );
  expect(allowed.status).toEqual(200);
  expect(await allowed.json()).toEqual({ authenticated: true });
});
