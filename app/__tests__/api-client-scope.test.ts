import { expect, test } from "bun:test";
import { ApiRequestError, createApiClient } from "../shared/lib/api-client.ts";

test("captured A requests and delayed401 clear only A and do not redirect B", async () => {
  const originals = new Map(
    ["location", "localStorage", "fetch"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const memory = new Map<string, string>();
  let release!: (value: Response) => void;
  const deferred = new Promise<Response>((done) => {
    release = done;
  });
  const requests: string[] = [];
  const set = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  try {
    set("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    });
    set(
      "location",
      new URL("https://office-fixture.invalid/docs/A?space_id=A"),
    );
    const api = createApiClient("/api/documents", "scope-fixture");
    const a = api.capture();
    memory.set(a.cacheKey, "A");
    set("fetch", (async (url: string) => {
      requests.push(String(url));
      return deferred;
    }) as typeof fetch);
    const request = a.requestJson("/api/documents");
    // Attach rejection observation before releasing the response.
    const observed = request.catch((error) => error);
    set(
      "location",
      new URL("https://office-fixture.invalid/docs/B?space_id=B"),
    );
    const b = api.capture();
    memory.set(b.cacheKey, "B-exact");
    const before = globalThis.location.href;
    release(new Response("", { status: 401 }));
    expect(((await observed) as ApiRequestError).status).toBe(401);
    expect({
      requests,
      a: memory.get(a.cacheKey),
      b: memory.get(b.cacheKey),
      href: globalThis.location.href,
      aCurrent: a.isCurrent(),
    }).toEqual({
      requests: ["/api/documents?space_id=A"],
      a: undefined,
      b: "B-exact",
      href: before,
      aCurrent: false,
    });
  } finally {
    release?.(new Response("", { status: 500 }));
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("a captured no-Workspace scope preserves the original cache and request shape", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "location");
  try {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("https://office-fixture.invalid/docs/"),
    });
    const scope = createApiClient("/api/documents", "no-space").capture();
    expect([
      scope.cacheKey,
      scope.withCapturedWorkspaceId("/api/documents?x=1"),
    ]).toEqual(["no-space", "/api/documents?x=1"]);
  } finally {
    if (original) Object.defineProperty(globalThis, "location", original);
    else Reflect.deleteProperty(globalThis, "location");
  }
});
