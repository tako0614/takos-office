import { expect, test } from "bun:test";
import { Hono } from "hono";
import { registerAuthRoutes } from "../shared/app-auth.ts";
import { createOfficeApp } from "../server.ts";

const env = {
  OIDC_ISSUER_URL: "https://accounts.example",
  OIDC_CLIENT_ID: "office-public",
  OIDC_REDIRECT_URI: "https://office.example/api/auth/callback",
  APP_SESSION_SECRET: "synthetic-session-secret",
  APP_CAPSULE_ID: "office-app",
  APP_WORKSPACE_ID: "workspace",
  TAKOS_SPACE_ID: "workspace",
  TAKOSUMI_CONTROL_API_URL: "https://control.example",
};

function login(environment: Record<string, string | undefined>) {
  const app = new Hono();
  registerAuthRoutes(app, environment);
  return app.request("https://worker-internal.example/api/auth/login");
}

test("runtime-delivered registered callback is used without inferring the request Host", async () => {
  const response = await login(env);
  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri"))
    .toBe(env.OIDC_REDIRECT_URI);
});

test("registered callback supplies public audience for session-free runtime configuration readiness", async () => {
  let calls = 0;
  const never = async () => { calls++; throw new Error("configuration check must not dispatch"); };
  const { app } = createOfficeApp(env, { appUserInfoFetch: never, runtimeFetch: never, storageFetch: never });
  const response = await app.request("https://worker-internal.example/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ storage: "per_request_authorization", storageProbed: false });
  expect(calls).toBe(0);
});

for (const value of ["", " ", "http://office.example/api/auth/callback", "https://user:secret@office.example/api/auth/callback", "https://office.example/other", "https://office.example/api/auth/callback?code=bad", "https://office.example/api/auth/callback#fragment"]) {
  test(`invalid declared callback fails closed even with a valid APP_URL: ${JSON.stringify(value)}`, async () => {
    const response = await login({ ...env, APP_URL: "https://office.example", OIDC_REDIRECT_URI: value });
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
}

test("an explicitly different public app origin is not replaced by the registered callback", async () => {
  const response = await login({ ...env, APP_URL: "https://other.example" });
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
});

for (const APP_URL of ["", " ", "http://office.example", "https://user:secret@office.example", "https://office.example/nested"]) {
  test(`invalid explicit APP_URL is not hidden by a valid registered callback: ${JSON.stringify(APP_URL)}`, async () => {
    const response = await login({ ...env, APP_URL });
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
}

test("legacy auth without registered delivery retains its existing request-origin callback", async () => {
  const response = await login({ ...env, OIDC_REDIRECT_URI: undefined });
  expect(response.status).toBe(302);
  expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri"))
    .toBe("https://worker-internal.example/api/auth/callback");
});
