import { expect, test } from "bun:test";

import { createOfficeApp } from "../server.ts";

const env = {
  ALLOW_UNAUTHENTICATED_ACCESS: "1",
  MCP_AUTH_TOKEN: "standalone-mcp",
  OBJECT_STORAGE_API_URL: "https://storage.example/o",
  OBJECT_STORAGE_ACCESS_TOKEN: "storage-token",
  TAKOS_SPACE_ID: "workspace-a",
};

test("root readiness proves object storage is reachable", async () => {
  let calls = 0;
  const { app } = createOfficeApp(env, {
    storageFetch: async (input, init) => {
      calls += 1;
      expect(String(input)).toContain(
        "https://storage.example/o?prefix=office%2Fv1%2Frecords%2Fworkspace-a%2F",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer storage-token",
      );
      return Response.json({ objects: [], truncated: false });
    },
  });

  const response = await app.request("/healthz");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    status: "ok",
    service: "takos-office",
  });
  expect(calls).toBe(1);
});

test("root readiness fails closed when object storage is unavailable", async () => {
  const { app } = createOfficeApp(env, {
    storageFetch: async () => Response.json({}, { status: 503 }),
  });
  const response = await app.request("/healthz");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "object_storage_unavailable",
  });
});

test("managed owner rejects a caller-selected Workspace on every UI API", async () => {
  const { app } = createOfficeApp({
    ...env,
    APP_WORKSPACE_ID: "workspace-a",
  });
  const office = await app.request(
    "/api/office/items?space_id=workspace-other",
  );
  const docs = await app.request(
    "/docs/api/documents?space_id=workspace-other",
  );
  expect(office.status).toBe(403);
  expect(docs.status).toBe(403);
  expect(await office.json()).toEqual({ error: "workspace_owner_mismatch" });
  expect(await docs.json()).toEqual({ error: "workspace_owner_mismatch" });
});

test("only the root worker owns MCP and readiness routes", async () => {
  const { app } = createOfficeApp(env);
  for (const path of [
    "/docs/mcp",
    "/docs/healthz",
    "/slide/mcp",
    "/slide/health",
    "/sheet/mcp",
    "/sheet/healthz",
  ]) {
    expect((await app.request(path)).status).toBe(404);
  }
});
