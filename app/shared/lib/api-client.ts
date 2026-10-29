import {
  currentWorkspaceId,
  withCurrentSpaceId,
  withWorkspaceId,
  workspaceStorageKey,
} from "./space-id.ts";

/**
 * Shared frontend storage-API client for the office editors.
 *
 * Each editor (docs / slide / sheet) talks to its own `${base}/api/<kind>`
 * endpoints with the same scaffold: resolve the subpath base, carry the active
 * Workspace via `space_id`, send same-origin credentials, and on a 401 clear
 * the local cache and bounce to the login flow. `createApiClient` is that
 * scaffold; the per-editor module supplies its API suffix and cache key.
 * Captured scopes keep delayed responses attached to their original Workspace.
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
  /** Freeze the Workspace and cache destination before asynchronous work. */
  capture(): ApiClientScope;
  /** Drop this editor's localStorage cache entry. */
  clearCache(): void;
  /** Current Workspace-scoped localStorage cache key. */
  cacheKey(): string;
  /** Redirect to the login flow, preserving the current location as return_to. */
  redirectToLogin(): void;
  /** Append the active Workspace id (`space_id`) query to a path. */
  withCurrentSpaceId(path: string): string;
  /** Fetch JSON with same-origin creds; clears cache + redirects on 401. */
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}
export interface ApiClientScope {
  readonly workspaceId: string | null;
  readonly cacheKey: string;
  isCurrent(): boolean;
  clearCache(): void;
  redirectToLogin(): void;
  withCapturedWorkspaceId(path: string): string;
  /** Clear only this scope on 401; redirect only if it is still current. */
  request(path: string, init?: RequestInit): Promise<Response>;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}
export class ApiRequestError extends Error {
  constructor(readonly status: number) {
    super(`Request failed: ${status}`);
    this.name = "ApiRequestError";
  }
}

export function createApiClient(
  apiPathSuffix: string,
  storageKey: string,
  // The editor can invalidate pending writes when this captured cache is cleared.
  options: { onClear?: (scope: ApiClientScope) => void } = {},
): ApiClient {
  const apiPath = `${BASE_PATH}${apiPathSuffix}`;
  const cacheKey = () => workspaceStorageKey(storageKey);
  function redirectToLogin(): void {
    const location = globalThis.location;
    if (!location) return;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    location.href = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`;
  }
  function capture(): ApiClientScope {
    const workspaceId = currentWorkspaceId();
    const key = workspaceStorageKey(storageKey, workspaceId);
    const origin = globalThis.location?.origin;
    const scope: ApiClientScope = Object.freeze({
      workspaceId,
      cacheKey: key,
      isCurrent: () => currentWorkspaceId() === workspaceId,
      clearCache: () => {
        localStorage.removeItem(key);
        options.onClear?.(scope);
      },
      redirectToLogin: () => {
        if (scope.isCurrent()) redirectToLogin();
      },
      withCapturedWorkspaceId: (path: string) =>
        withWorkspaceId(path, workspaceId, origin),
      async request(path: string, init?: RequestInit): Promise<Response> {
        const headers = new Headers(init?.headers);
        if (!headers.has("Content-Type"))
          headers.set("Content-Type", "application/json");
        const response = await fetch(scope.withCapturedWorkspaceId(path), {
          ...init,
          headers,
          credentials: "same-origin",
        });
        if (response.status === 401) {
          scope.clearCache();
          scope.redirectToLogin();
        }
        return response;
      },
      async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
        const response = await scope.request(path, init);
        if (!response.ok) throw new ApiRequestError(response.status);
        return (await response.json()) as T;
      },
    });
    return scope;
  }
  return {
    apiPath,
    capture,
    cacheKey,
    redirectToLogin,
    withCurrentSpaceId,
    clearCache: () => capture().clearCache(),
    requestJson: <T>(path: string, init?: RequestInit) =>
      capture().requestJson<T>(path, init),
  };
}
