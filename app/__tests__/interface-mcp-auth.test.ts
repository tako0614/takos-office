import { describe, expect, test } from "bun:test";

import { createOfficeApp } from "../server.ts";
import { verifyInterfaceOAuthBearer } from "../shared/interface-oauth-auth.ts";

const TOKEN = "taksrv_office_test_token";
const PERMISSION = "mcp.invoke";
const AUDIENCE = "https://office.example/mcp";
const validClaims = {
  token_use: "interface_oauth",
  sub: "principal_office",
  aud: AUDIENCE,
  scope: PERMISSION,
  takosumi: {
    workspace_id: "workspace_a",
    capsule_id: "capsule_office",
    interface_id: "interface_office_mcp",
    interface_binding_id: "binding_office_mcp",
    interface_resolved_revision: 4,
  },
};

function verify(body: unknown): Promise<boolean> {
  return verifyInterfaceOAuthBearer(new Request(AUDIENCE), TOKEN, PERMISSION, {
    issuerUrl: "https://accounts.example",
    expectedAudience: AUDIENCE,
    expectedWorkspaceId: "workspace_a",
    expectedCapsuleId: "capsule_office",
    fetchImpl: async (input, init) => {
      expect(String(input)).toBe("https://accounts.example/oauth/userinfo");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${TOKEN}`,
      );
      return Response.json(body);
    },
  });
}

describe("Takos Office Interface OAuth", () => {
  test("accepts current UserInfo authority with exact owner and complete Interface evidence", async () => {
    expect(await verify(validClaims)).toBe(true);
  });

  test("requires the canonical bare-origin Accounts issuer", async () => {
    expect(
      await verifyInterfaceOAuthBearer(
        new Request(AUDIENCE),
        TOKEN,
        PERMISSION,
        {
          issuerUrl: "https://accounts.example/issuer",
          expectedAudience: AUDIENCE,
          expectedWorkspaceId: "workspace_a",
          expectedCapsuleId: "capsule_office",
          fetchImpl: async () => Response.json(validClaims),
        },
      ),
    ).toBe(false);
  });

  test("rejects audience, scope, owner, subject, and evidence-shape mismatches", async () => {
    const invalidClaims = [
      { ...validClaims, aud: "https://office.example/docs" },
      { ...validClaims, scope: "mcp.invoke other" },
      { ...validClaims, sub: " principal_office" },
      {
        ...validClaims,
        takosumi: { ...validClaims.takosumi, workspace_id: "workspace_b" },
      },
      {
        ...validClaims,
        takosumi: { ...validClaims.takosumi, capsule_id: "capsule_other" },
      },
      {
        ...validClaims,
        takosumi: { ...validClaims.takosumi, interface_id: undefined },
      },
      {
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_binding_id: undefined,
        },
      },
      {
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_resolved_revision: 0,
        },
      },
    ];
    for (const claims of invalidClaims)
      expect(await verify(claims)).toBe(false);
  });

  test("does not pre-pin post-apply Interface identity or revision", async () => {
    expect(
      await verify({
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_id: "interface_office_reconciled",
          interface_binding_id: "binding_office_reconciled",
          interface_resolved_revision: 9,
        },
      }),
    ).toBe(true);
  });

  test("unified /mcp accepts Interface OAuth without a static bearer", async () => {
    const { app } = createOfficeApp(
      {
        APP_URL: "https://office.example",
        OIDC_ISSUER_URL: "https://accounts.example",
        APP_WORKSPACE_ID: "workspace_a",
        APP_CAPSULE_ID: "capsule_office",
        OBJECT_STORAGE_API_URL: "https://storage.example/o",
        OBJECT_STORAGE_ACCESS_TOKEN: "storage-call-token",
        TAKOS_SPACE_ID: "workspace_a",
      },
      {
        interfaceUserInfoFetch: async () => Response.json(validClaims),
      },
    );
    const response = await app.fetch(
      new Request(AUDIENCE, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "office-test", version: "1.0.0" },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"name":"takos-office"');
  });

  test("managed /mcp fails closed when the selected storage workspace differs from the token owner", async () => {
    let userInfoCalls = 0;
    const { app } = createOfficeApp(
      {
        APP_URL: "https://office.example",
        OIDC_ISSUER_URL: "https://accounts.example",
        APP_WORKSPACE_ID: "workspace_a",
        APP_CAPSULE_ID: "capsule_office",
        OBJECT_STORAGE_API_URL: "https://storage.example/o",
        OBJECT_STORAGE_ACCESS_TOKEN: "storage-call-token",
        TAKOS_SPACE_ID: "workspace_a",
      },
      {
        interfaceUserInfoFetch: async () => {
          userInfoCalls += 1;
          return Response.json(validClaims);
        },
      },
    );
    const response = await app.fetch(
      new Request(`${AUDIENCE}?space_id=workspace_b`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "workspace does not match managed MCP owner",
    });
    expect(userInfoCalls).toBe(0);
  });

  test("unified /mcp fails closed when neither managed nor explicit standalone auth is configured", async () => {
    const { app } = createOfficeApp({
      OBJECT_STORAGE_ACCESS_TOKEN: "storage-call-token",
      TAKOS_SPACE_ID: "workspace_a",
    });
    const response = await app.fetch(
      new Request("https://office.example/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "MCP bearer authentication is not configured",
    });
  });

  test("explicit standalone MCP bearer remains available without Accounts", async () => {
    const { app } = createOfficeApp({
      MCP_AUTH_TOKEN: "operator-configured-token",
      OBJECT_STORAGE_ACCESS_TOKEN: "storage-call-token",
      TAKOS_SPACE_ID: "workspace_a",
    });
    const response = await app.fetch(
      new Request("https://office.example/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer operator-configured-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "office-test", version: "1.0.0" },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
  });
});
