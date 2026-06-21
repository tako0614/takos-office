// CANONICAL COPY (owner): takos-apps/takos-docs/src/app-auth.ts
// This file is byte-identical across takos-docs / takos-slide / takos-excel.
// The copies are deliberately vendored rather than factored into a shared
// package because each takos-app ships as a standalone git repo / OpenTofu
// module installable from a Git URL; a cross-submodule alias library would
// break that standalone build.
//
// Edit ONLY this canonical copy, then propagate to the other apps with
// `bun run check:takos-apps-dedupe --fix` (ecosystem root). Verify mode
// (`bun run check:takos-apps-dedupe`) is wired into `bun run check:all` and
// fails if any copy drifts.

import type { Hono } from "hono";

const SESSION_COOKIE = "takos_app_session";
const STATE_COOKIE = "takos_app_oauth_state";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;

type OAuthState = {
  state: string;
  codeVerifier: string;
  returnTo: string;
  exp: number;
};

type AppSession = {
  sub: string;
  name?: string;
  spaceIds: string[];
  exp: number;
};

export type RequireAppAuthOptions = {
  /**
   * If provided, the subject's session must include the spaceId in its
   * `space_memberships` claim. Otherwise the request is rejected with 403
   * `space_membership_required`.
   */
  spaceId?: string | null;
};

type AppRuntimeEnv = Record<string, string | undefined>;

function envValue(env: AppRuntimeEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function flagEnabled(env: AppRuntimeEnv, name: string): boolean {
  const value = envValue(env, name);
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}

function authConfig(env: AppRuntimeEnv) {
  return {
    required: flagEnabled(env, "APP_AUTH_REQUIRED"),
    issuer: envValue(env, "OIDC_ISSUER_URL") ??
      envValue(env, "OAUTH_ISSUER_URL"),
    tokenEndpoint: envValue(env, "OIDC_TOKEN_URL") ??
      envValue(env, "OAUTH_TOKEN_URL"),
    userinfoEndpoint: envValue(env, "OIDC_USERINFO_URL") ??
      envValue(env, "OAUTH_USERINFO_URL"),
    clientId: envValue(env, "OIDC_CLIENT_ID") ??
      envValue(env, "OAUTH_CLIENT_ID"),
    clientSecret: envValue(env, "OIDC_CLIENT_SECRET") ??
      envValue(env, "OAUTH_CLIENT_SECRET"),
    sessionSecret: envValue(env, "APP_SESSION_SECRET"),
  };
}

function authMissing(env: AppRuntimeEnv): string[] {
  const config = authConfig(env);
  if (!config.required) return [];
  const requiredValues: Array<[string, string | undefined]> = [
    ["OIDC_ISSUER_URL", config.issuer],
    ["OIDC_CLIENT_ID", config.clientId],
    ["OIDC_CLIENT_SECRET", config.clientSecret],
    ["APP_SESSION_SECRET", config.sessionSecret],
  ];
  return requiredValues.flatMap(([name, value]) => value ? [] : [name]);
}

export function appAuthMisconfigured(env: AppRuntimeEnv): Response | null {
  const missing = authMissing(env);
  if (missing.length === 0) return null;
  return Response.json({
    error: "App auth is not configured",
    missing,
  }, { status: 503 });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<string> {
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
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(signature));
}

async function seal(value: unknown, secret: string): Promise<string> {
  const payload = base64UrlJson(value);
  return `${payload}.${await sign(payload, secret)}`;
}

async function unseal<T>(token: string, secret: string): Promise<T | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (await sign(payload, secret) !== signature) return null;
  return parseBase64UrlJson<T>(payload);
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function parseCookie(
  header: string | null | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=") || null;
  }
  return null;
}

function cookieHeader(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Reject any control character (U+0000..U+001F or U+007F) so it can't survive
// into a Location header.
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeReturnTo(value: string | null): string {
  // SECURITY (open redirect): only accept a same-origin local path. The prior
  // `startsWith("/") && !startsWith("//")` check still accepted `/\evil.com`
  // and `/\/evil.com`, which browsers normalize to `//evil.com` (an external
  // origin) when emitted verbatim as a post-login `Location:` header. Reject
  // backslashes and control characters, then resolve against a fixed dummy
  // origin and confirm the result stays same-origin, returning only the local
  // path+query+hash.
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || hasControlChar(value)) return "/";
  try {
    const base = "https://app.invalid";
    const u = new URL(value, base);
    if (u.origin !== base) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

function appBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function callbackUrl(request: Request): string {
  return new URL("/api/auth/callback", appBaseUrl(request)).toString();
}

async function exchangeCode(
  env: AppRuntimeEnv,
  request: Request,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const config = authConfig(env);
  const issuer = config.issuer!;
  const tokenEndpoint = config.tokenEndpoint ||
    `${issuer.replace(/\/$/, "")}/oauth/token`;
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId!,
      client_secret: config.clientSecret!,
      redirect_uri: callbackUrl(request),
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${res.status}`);
  }
  const body = await res.json() as { access_token?: string };
  if (!body.access_token) {
    throw new Error("OAuth token response missing access_token");
  }
  return body.access_token;
}

function normalizeSpaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      seen.add(entry);
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const candidate = record.space_id ?? record.spaceId ?? record.id;
      if (typeof candidate === "string" && candidate.trim() !== "") {
        seen.add(candidate);
      }
    }
  }
  return [...seen];
}

async function fetchUserInfo(env: AppRuntimeEnv, accessToken: string) {
  const config = authConfig(env);
  const issuer = config.issuer!;
  const userinfoEndpoint = config.userinfoEndpoint ||
    `${issuer.replace(/\/$/, "")}/oauth/userinfo`;
  const res = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`OAuth userinfo failed: ${res.status}`);
  const body = await res.json() as {
    user?: { id?: string; name?: string };
    sub?: string;
    name?: string;
    space_memberships?: unknown;
    spaceMemberships?: unknown;
    takosumi?: { space_id?: unknown };
  };
  const sub = body.user?.id ?? body.sub;
  if (!sub) throw new Error("OAuth userinfo response missing subject");
  const spaceIds = normalizeSpaceIds(
    body.space_memberships ?? body.spaceMemberships,
  );
  // Backward-compat fallback: Takosumi Accounts userinfo historically emits
  // only the nested `takosumi.space_id` (a single accessible space) and no
  // flat `space_memberships` claim. Fold that single space into spaceIds so
  // membership checks work even against an issuer that predates the claim.
  const nestedSpaceId = body.takosumi?.space_id;
  if (
    typeof nestedSpaceId === "string" && nestedSpaceId.trim() !== "" &&
    !spaceIds.includes(nestedSpaceId)
  ) {
    spaceIds.push(nestedSpaceId);
  }
  return { sub, name: body.user?.name ?? body.name, spaceIds };
}

export async function requireAppAuth(
  env: AppRuntimeEnv,
  request: Request,
  options: RequireAppAuthOptions = {},
): Promise<Response | null> {
  const config = authConfig(env);
  if (!config.required) return null;
  const misconfigured = appAuthMisconfigured(env);
  if (misconfigured) return misconfigured;
  const raw = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!raw) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const session = await unseal<AppSession>(raw, config.sessionSecret!);
  if (!session || session.exp <= Math.floor(Date.now() / 1000)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requestedSpaceId = options.spaceId;
  if (typeof requestedSpaceId === "string" && requestedSpaceId !== "") {
    const memberships = Array.isArray(session.spaceIds) ? session.spaceIds : [];
    if (!memberships.includes(requestedSpaceId)) {
      return Response.json({
        error: "space_membership_required",
      }, { status: 403 });
    }
  }
  return null;
}

export function registerAuthRoutes(app: Hono, env: AppRuntimeEnv): void {
  app.get("/api/auth/login", async (c) => {
    const misconfigured = appAuthMisconfigured(env);
    if (misconfigured) return misconfigured;
    const config = authConfig(env);
    const codeVerifier = randomToken();
    const state: OAuthState = {
      state: randomToken(),
      codeVerifier,
      returnTo: safeReturnTo(c.req.query("return_to") ?? null),
      exp: Math.floor(Date.now() / 1000) + STATE_MAX_AGE_SECONDS,
    };
    const authUrl = new URL(
      `${config.issuer!.replace(/\/$/, "")}/oauth/authorize`,
    );
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", config.clientId!);
    authUrl.searchParams.set("redirect_uri", callbackUrl(c.req.raw));
    authUrl.searchParams.set("scope", "openid profile email");
    authUrl.searchParams.set("state", state.state);
    authUrl.searchParams.set(
      "code_challenge",
      await sha256Base64Url(codeVerifier),
    );
    authUrl.searchParams.set("code_challenge_method", "S256");
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        "Set-Cookie": cookieHeader(
          c.req.raw,
          STATE_COOKIE,
          await seal(state, config.sessionSecret!),
          STATE_MAX_AGE_SECONDS,
        ),
      },
    });
  });

  app.get("/api/auth/callback", async (c) => {
    const config = authConfig(env);
    const misconfigured = appAuthMisconfigured(env);
    if (misconfigured) return misconfigured;
    const code = c.req.query("code");
    const returnedState = c.req.query("state");
    const stateCookie = parseCookie(c.req.header("Cookie"), STATE_COOKIE);
    const state = stateCookie
      ? await unseal<OAuthState>(stateCookie, config.sessionSecret!)
      : null;
    if (
      !code || !returnedState || !state || state.state !== returnedState ||
      state.exp <= Math.floor(Date.now() / 1000)
    ) {
      return Response.json({ error: "Invalid OAuth state" }, { status: 400 });
    }
    const accessToken = await exchangeCode(
      env,
      c.req.raw,
      code,
      state.codeVerifier,
    );
    const user = await fetchUserInfo(env, accessToken);
    const session = await seal(
      {
        sub: user.sub,
        name: user.name,
        spaceIds: user.spaceIds,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      } satisfies AppSession,
      config.sessionSecret!,
    );
    // SECURITY (open redirect): re-validate at emit time so a tampered or
    // legacy `state` cookie can't drive an external `Location:` redirect.
    const headers = new Headers({ Location: safeReturnTo(state.returnTo) });
    headers.append("Set-Cookie", clearCookie(STATE_COOKIE));
    headers.append(
      "Set-Cookie",
      cookieHeader(c.req.raw, SESSION_COOKIE, session, SESSION_MAX_AGE_SECONDS),
    );
    return new Response(null, { status: 302, headers });
  });

  app.get("/api/auth/me", async (c) => {
    const unauthorized = await requireAppAuth(env, c.req.raw);
    if (unauthorized) return unauthorized;
    return c.json({ authenticated: true });
  });

  app.post("/api/auth/logout", () => {
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearCookie(SESSION_COOKIE),
      },
    });
  });
}
