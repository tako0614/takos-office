import type {
  ObjectStorageAuthorization,
  ObjectStorageFetch,
  ObjectStoragePermission,
} from "./lib/takos-storage.ts";
import { createTakosStorageClient } from "./lib/takos-storage.ts";
import { appRuntimeAccessToken } from "./app-auth.ts";
import type { OfficeServerFetchOptions } from "./server-options.ts";
import { envValue, type RuntimeEnv } from "./runtime-env.ts";

export type OfficeStorageOptions = OfficeServerFetchOptions & {
  runtimeFetch?: ObjectStorageFetch;
};

export function usesRuntimeStorage(env: RuntimeEnv): boolean {
  return env.TAKOSUMI_CONTROL_API_URL !== undefined;
}

export function hasOfficeStorage(env: RuntimeEnv): boolean {
  return !!(usesRuntimeStorage(env) || envValue(env, "OBJECT_STORAGE_ACCESS_TOKEN"));
}

/** Stores with runtime credentials belong to the incoming request, not a shared user cache. */
export function createOfficeStorageClient(
  env: RuntimeEnv,
  request: Request | undefined,
  spaceId: string,
  options: OfficeStorageOptions = {},
) {
  const runtimeStorage = usesRuntimeStorage(env);
  const controlApiUrl = env.TAKOSUMI_CONTROL_API_URL;
  if (runtimeStorage && !request) throw new RuntimeStorageError("storage_runtime_session_required", 401);
  let principal: Promise<string> | undefined;
  const authorizationForOperation = runtimeStorage
    ? createRuntimeStorageAuthorization({
        controlApiUrl: controlApiUrl ?? "",
        fetchImpl: options.runtimeFetch,
        signal: request?.signal,
        accessToken: () => principal ??= (async () => {
          const result = await appRuntimeAccessToken(env, request!, { spaceId, fetchImpl: options.appUserInfoFetch });
          if (result instanceof Response) {
            throw new RuntimeStorageError("storage_runtime_session_required", result.status);
          }
          return result;
        })(),
      })
    : undefined;
  return createTakosStorageClient(
    envValue(env, "OBJECT_STORAGE_API_URL") ?? "http://localhost:8787",
    envValue(env, "OBJECT_STORAGE_ACCESS_TOKEN") ?? "",
    spaceId,
    envValue(env, "OBJECT_STORAGE_KEY_PREFIX") ?? "",
    { fetchImpl: options.storageFetch, authorizationForOperation, signal: request?.signal },
  );
}

export function runtimeStorageErrorResponse(error: unknown): Response | undefined {
  return error instanceof RuntimeStorageError
    ? Response.json({ error: error.code }, { status: error.status })
    : undefined;
}

type RuntimeStorageOptions = {
  controlApiUrl: string;
  accessToken: () => Promise<string>;
  fetchImpl?: ObjectStorageFetch;
  now?: () => number;
  signal?: AbortSignal;
};

type SelectedStorage = { id: string; resource: string };

export class RuntimeStorageError extends Error {
  constructor(readonly code: string, readonly status = 503) {
    super(code);
    this.name = "RuntimeStorageError";
  }
}

/** One authenticated HTTP request owns this closure; never cache it by Workspace. */
export function createRuntimeStorageAuthorization(options: RuntimeStorageOptions) {
  const configuredBase = credentialFreeHttpsUrl(options.controlApiUrl);
  if (!configuredBase) throw new RuntimeStorageError("storage_control_url_invalid");
  const base = configuredBase;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let selected: Promise<SelectedStorage> | undefined;

  async function coreRequest(path: string, token: string, init?: RequestInit) {
    if (!validBearer(token)) {
      throw new RuntimeStorageError("storage_runtime_session_required", 401);
    }
    const signal = AbortSignal.any([
      AbortSignal.timeout(5000),
      ...(options.signal ? [options.signal] : []),
    ]);
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(new URL(path, `${base.replace(/\/$/u, "")}/`), {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
        redirect: "manual",
        signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new RuntimeStorageError(
          response.status === 401 || response.status === 403
            ? "storage_runtime_authorization_denied"
            : "storage_runtime_unavailable",
          response.status === 401 || response.status === 403 ? response.status : 503,
        );
      }
      return await readJson(response, signal);
    } catch (error) {
      if (error instanceof RuntimeStorageError) throw error;
      throw new RuntimeStorageError("storage_runtime_unavailable");
    }
  }

  async function discover(permission: ObjectStoragePermission, token: string) {
    const query = new URLSearchParams({
      type: "storage.object",
      phase: "Resolved",
      permission,
      limit: "2",
    });
    const body = await coreRequest(`api/v1/interfaces?${query}`, token);
    if (
      !isRecord(body) ||
      !Array.isArray(body.interfaces) ||
      body.interfaces.length !== 1 ||
      body.nextCursor !== undefined
    ) {
      throw new RuntimeStorageError("storage_interface_selection_required");
    }
    const iface = body.interfaces[0];
    if (
      !isRecord(iface) || !isRecord(iface.metadata) ||
      typeof iface.metadata.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(iface.metadata.id) ||
      !isRecord(iface.spec) || iface.spec.type !== "storage.object" ||
      iface.spec.version !== "1" || !isRecord(iface.spec.access) ||
      typeof iface.spec.access.resourceUriInput !== "string" ||
      !isRecord(iface.status) || iface.status.phase !== "Resolved" ||
      !isRecord(iface.status.resolvedInputs)
    ) {
      throw new RuntimeStorageError("storage_interface_invalid");
    }
    const resource = credentialFreeHttpsUrl(
      iface.status.resolvedInputs[iface.spec.access.resourceUriInput],
    );
    if (!resource || !new URL(resource).pathname.endsWith("/o")) {
      throw new RuntimeStorageError("storage_interface_invalid");
    }
    return { id: iface.metadata.id, resource };
  }

  return async (permission: ObjectStoragePermission): Promise<ObjectStorageAuthorization> => {
    const principalToken = await options.accessToken();
    // A rejected selection stays rejected for this request; never rediscover a replacement.
    selected ??= discover(permission, principalToken);
    const target = await selected;
    const body = await coreRequest(
      `api/v1/interfaces/${encodeURIComponent(target.id)}/token`,
      principalToken,
      { method: "POST", body: JSON.stringify({ permission, dataScope: "app-shared.v1" }) },
    );
    const expiresAt = isRecord(body) && typeof body.expires_at === "string"
      ? Date.parse(body.expires_at)
      : NaN;
    const currentTime = now();
    if (
      !isRecord(body) || !validBearer(body.access_token) ||
      body.token_type !== "Bearer" || body.token_use !== "interface_app_data" || body.scope !== permission ||
      body.resource !== target.resource ||
      !Number.isSafeInteger(body.expires_in) ||
      (body.expires_in as number) <= 0 || (body.expires_in as number) > 60 ||
      !Number.isFinite(expiresAt) || expiresAt <= currentTime ||
      expiresAt > currentTime + 60_000
    ) {
      throw new RuntimeStorageError("storage_invocation_authorization_invalid");
    }
    return { apiUrl: target.resource, accessToken: body.access_token };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validBearer(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !/\s/u.test(value);
}

function credentialFreeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim() || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return;
    return url.href;
  } catch { return; }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RuntimeStorageError("storage_runtime_response_invalid");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 32 * 1024) {
        await reader.cancel();
        throw new RuntimeStorageError("storage_runtime_response_invalid");
      }
      chunks.push(part.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    void reader.cancel().catch(() => {});
    throw new RuntimeStorageError("storage_runtime_response_invalid");
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
