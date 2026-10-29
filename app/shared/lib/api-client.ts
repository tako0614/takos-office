import {
  currentWorkspaceId,
  withCurrentSpaceId,
  withWorkspaceId,
  workspaceStorageKey,
} from "./space-id.ts";

/** Same-origin Office API requests and immutable Workspace/cache scopes.
 * A delayed401 clears its original scope and redirects only while still there.
 */
const RAW_BASE = import.meta.env.BASE_URL;
const BASE_PATH = (typeof RAW_BASE === "string" ? RAW_BASE : "/").replace(
  /\/+$/,
  "",
);

export interface ApiClient {
  apiPath: string;
  capture(): ApiClientScope;
  clearCache(): void;
  cacheKey(): string;
  redirectToLogin(): void;
  withCurrentSpaceId(path: string): string;
  requestJson<T>(path: string, init?: RequestInit): Promise<T>;
}
export interface ApiClientScope {
  readonly workspaceId: string | null;
  readonly cacheKey: string;
  isCurrent(): boolean;
  clearCache(): void;
  redirectToLogin(): void;
  withCapturedWorkspaceId(path: string): string;
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
