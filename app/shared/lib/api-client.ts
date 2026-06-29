import { withCurrentSpaceId } from "./space-id.ts";

/**
 * Shared frontend storage-API client for the office editors.
 *
 * Each editor (docs / slide / sheet) talks to its own `${base}/api/<kind>`
 * endpoints with the same scaffold: resolve the subpath base, carry the active
 * Workspace via `space_id`, send same-origin credentials, and on a 401 clear
 * the local cache and bounce to the login flow. `createApiClient` is that
 * scaffold; the per-editor module supplies its API suffix and cache key.
 */

// Subpath base under the unified Takos Office worker (vite injects "/docs/"
// etc. at build; falls back to "" under bun test where BASE_URL is unset).
const RAW_BASE = import.meta.env.BASE_URL;
const BASE_PATH = (typeof RAW_BASE === "string" ? RAW_BASE : "/").replace(
  /\/+$/,
  "",
);

export interface ApiClient {
  /** Absolute API path: BASE_PATH + the given suffix (e.g. "/docs/api/documents"). */
  apiPath: string;
  /** Drop this editor's localStorage cache entry. */
  clearCache(): void;
  /** Redirect to the login flow, preserving the current location as return_to. */
  redirectToLogin(): void;
  /** Append the active Workspace id (`space_id`) query to a path. */
  withCurrentSpaceId(path: string): string;
  /** Fetch JSON with same-origin creds; clears cache + redirects on 401. */
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}

export function createApiClient(
  apiPathSuffix: string,
  storageKey: string,
): ApiClient {
  const apiPath = `${BASE_PATH}${apiPathSuffix}`;

  function clearCache(): void {
    localStorage.removeItem(storageKey);
  }

  function redirectToLogin(): void {
    const location = globalThis.location;
    if (!location) return;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    location.href = `${BASE_PATH}/api/auth/login?return_to=${
      encodeURIComponent(returnTo)
    }`;
  }

  async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(withCurrentSpaceId(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      credentials: "same-origin",
    });
    if (response.status === 401) {
      clearCache();
      redirectToLogin();
    }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return await response.json() as T;
  }

  return {
    apiPath,
    clearCache,
    redirectToLogin,
    withCurrentSpaceId,
    requestJson,
  };
}
