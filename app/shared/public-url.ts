import { envValue, type RuntimeEnv } from "./runtime-env.ts";

/** A declared callback is exact host-delivered configuration, never request metadata. */
export function registeredOfficeCallback(env: RuntimeEnv): string | undefined {
  const value = env.OIDC_REDIRECT_URI;
  if (value === undefined) return undefined;
  const callback = httpsUrl(value);
  if (callback.pathname !== "/api/auth/callback") {
    throw new Error("registered_callback_invalid");
  }
  if (env.APP_URL !== undefined) {
    const app = httpsUrl(env.APP_URL);
    if (app.origin !== callback.origin || app.pathname !== "/") {
      throw new Error("registered_callback_invalid");
    }
  }
  return value;
}

/** Runtime binding delivery supplies a registered origin before a Worker is activated. */
export function officePublicUrl(env: RuntimeEnv): string | undefined {
  const callback = registeredOfficeCallback(env);
  return envValue(env, "APP_URL") ?? (callback ? new URL(callback).origin : undefined);
}

function httpsUrl(value: string): URL {
  try {
    if (value.length === 0 || value.length > 2048 || value !== value.trim()) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url;
  } catch {
    throw new Error("registered_callback_invalid");
  }
}
