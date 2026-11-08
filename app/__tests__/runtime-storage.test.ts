import { expect, test } from "bun:test";
import { createTakosStorageClient } from "../shared/lib/takos-storage.ts";

test("object calls obtain operation-specific authority without retaining a fixed invocation bearer", async () => {
  const permissions: string[] = [];
  const requests: Request[] = [];
  const client = createTakosStorageClient("https://legacy.example/o", "standing", "workspace", "", {
    async authorizationForOperation(permission) {
      permissions.push(permission);
      return {
        apiUrl: "https://storage.example/o",
        accessToken: `invocation-${permissions.length}`,
      };
    },
    async fetchImpl(input, init) {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === "PUT") return new Response(null, { status: 201 });
      if (new URL(request.url).pathname === "/o") {
        return Response.json({ objects: [], truncated: false });
      }
      return new Response(null, { status: 404 });
    },
  });

  await client.ready();
  expect(await client.get("absent")).toBeNull();
  await client.create("first.txt", undefined, { content: "draft" });
  await client.ready();
  expect(permissions).toEqual([
    "storage.object.list",
    "storage.object.read",
    "storage.object.write",
    "storage.object.list",
  ]);
  expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
    "Bearer invocation-1",
    "Bearer invocation-2",
    "Bearer invocation-3",
    "Bearer invocation-4",
  ]);
  expect(requests[2].headers.get("if-none-match")).toBe("*");
  expect(requests.every((request) => new URL(request.url).origin === "https://storage.example")).toBe(true);
});

test("failed operation authorization never falls back to a standing credential or sends an object request", async () => {
  let objectCalls = 0;
  const client = createTakosStorageClient("https://old.example", "standing", "workspace", "", {
    async authorizationForOperation() {
      throw new Error("binding revoked");
    },
    async fetchImpl() {
      objectCalls++;
      throw new Error("must not send");
    },
  });
  await expect(client.ready()).rejects.toThrow("binding revoked");
  expect(objectCalls).toBe(0);
});

test("a retired request sends neither authorization nor an object mutation", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = createTakosStorageClient("", "", "workspace", "", {
    signal: controller.signal,
    async authorizationForOperation() { calls++; throw new Error("must not authorize"); },
    async fetchImpl() { calls++; throw new Error("must not send"); },
  });
  await expect(client.create("draft.txt")).rejects.toThrow();
  expect(calls).toBe(0);
});
