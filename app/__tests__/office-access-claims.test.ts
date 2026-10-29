import { describe, expect, test } from "bun:test";

import {
  canAccessOfficeContent,
  officeAppRole,
  readOfficeAccessClaims,
} from "../shared/office-access-claims.ts";

const expected = { capsuleId: "office_a", workspaceId: "workspace_a" };

describe("Office app-scoped sign-in policy", () => {
  test.each(["owner", "member"] as const)(
    "a matching %s role grants private content access without a Workspace",
    (role) => {
      const claims = readOfficeAccessClaims({
        takosumi: { capsule_id: "office_a", app_role: role },
      });
      expect(officeAppRole(claims, "office_a")).toBe(role);
      expect(canAccessOfficeContent(claims, expected)).toBe(true);
      expect(
        canAccessOfficeContent(claims, { capsuleId: "office_a" }),
      ).toBe(true);
    },
  );

  test("an ordinary signed-in user has no private content or management role", () => {
    const claims = readOfficeAccessClaims({
      sub: "ordinary_user",
      takosumi: { capsule_id: "office_a" },
    });
    expect(claims.app.state).toBe("scoped");
    expect(officeAppRole(claims, "office_a")).toBeNull();
    expect(canAccessOfficeContent(claims, expected)).toBe(false);
  });

  test.each(["owner", "admin", "member", "viewer"])(
    "current Accounts capsule-bound %s claims preserve private access",
    (role) => {
      const claims = readOfficeAccessClaims({
        sub: "legacy_user",
        workspace_memberships: ["workspace_a"],
        takosumi: { capsule_id: "office_a", workspace_id: "workspace_a", role },
      });
      expect(canAccessOfficeContent(claims, expected)).toBe(true);
      expect(canAccessOfficeContent(claims, { capsuleId: "office_a" })).toBe(false);
      expect(canAccessOfficeContent(claims, { ...expected, workspaceId: "other" })).toBe(false);
      expect(canAccessOfficeContent(claims, { ...expected, capsuleId: "other" })).toBe(false);
    },
  );

  test("capsule compatibility requires matching nested Workspace and membership evidence", () => {
    for (const takosumi of [
      { capsule_id: "office_a", workspace_id: "workspace_a" },
      { capsule_id: "office_a", workspace_id: "other", role: "owner" },
      { capsule_id: "office_a", role: "owner" },
    ]) {
      expect(canAccessOfficeContent(readOfficeAccessClaims({ takosumi }), expected)).toBe(false);
    }
    expect(canAccessOfficeContent(readOfficeAccessClaims({
      workspace_memberships: ["workspace_a"],
      takosumi: { capsule_id: "office_a", workspace_id: "workspace_a" },
    }), expected)).toBe(true);
  });

  test("another app's role cannot use the legacy Workspace fallback", () => {
    const claims = readOfficeAccessClaims({
      workspace_memberships: ["workspace_a"],
      takosumi: { capsule_id: "office_other", app_role: "owner" },
    });
    expect(officeAppRole(claims, "office_a")).toBeNull();
    expect(canAccessOfficeContent(claims, expected)).toBe(false);
  });

  test("app roles require an explicit matching deployment Capsule", () => {
    const claims = readOfficeAccessClaims({
      workspace_memberships: ["workspace_a"],
      takosumi: { capsule_id: "office_a", app_role: "member" },
    });
    for (const capsuleId of [undefined, null, "", " office_a", "office_a "]) {
      expect(officeAppRole(claims, capsuleId)).toBeNull();
      expect(
        canAccessOfficeContent(claims, {
          capsuleId,
          workspaceId: "workspace_a",
        }),
      ).toBe(false);
    }
  });

  test.each([
    { app_role: "owner" },
    { capsule_id: "office_a", app_role: "admin" },
    { capsule_id: "office_a", app_role: null },
    { capsule_id: "office_a", app_role: ["owner"] },
    { capsule_id: "office_a", app_role: " owner" },
    { capsule_id: "office_a", app_role: "OWNER" },
    { capsule_id: " office_a", app_role: "owner" },
    { capsule_id: "office_a\n", app_role: "owner" },
    { capsule_id: 42, app_role: "owner" },
    { capsule_id: "", app_role: "owner" },
    { capsule_id: "x".repeat(513), app_role: "owner" },
    { capsule_id: undefined },
    null,
    [],
    "office_a",
  ].map((takosumi) => ({ takosumi })))(
    "malformed app evidence fails closed: %j",
    ({ takosumi }) => {
      const claims = readOfficeAccessClaims({
        workspace_memberships: ["workspace_a"],
        takosumi,
      });
      expect(claims.app.state).toBe("invalid");
      expect(canAccessOfficeContent(claims, expected)).toBe(false);
    },
  );

  test.each([null, [], "claims", 42].map((value) => ({ value })))(
    "malformed UserInfo fails closed: %j",
    ({ value }) => {
      const claims = readOfficeAccessClaims(value);
      expect(claims.app.state).toBe("invalid");
      expect(canAccessOfficeContent(claims, expected)).toBe(false);
    },
  );

  test("legacy Workspace forms preserve private content isolation", () => {
    const claims = readOfficeAccessClaims({
      workspace_memberships: [
        "workspace_a",
        { workspace_id: "workspace_b" },
        { id: "workspace_c" },
        "workspace_a",
        "",
        null,
      ],
      takosumi: { workspace_id: "workspace_d", role: "owner" },
    });
    expect(claims.workspaceIds).toEqual([
      "workspace_a",
      "workspace_b",
      "workspace_c",
      "workspace_d",
    ]);
    expect(canAccessOfficeContent(claims, expected)).toBe(true);
    expect(
      canAccessOfficeContent(claims, { workspaceId: "workspace_other" }),
    ).toBe(false);
    expect(officeAppRole(claims, "office_a")).toBeNull();
  });

  test("legacy nested Workspace claims remain accepted", () => {
    const claims = readOfficeAccessClaims({
      takosumi: { workspace_id: "workspace_a" },
    });
    expect(canAccessOfficeContent(claims, expected)).toBe(true);
    expect(canAccessOfficeContent(claims, {})).toBe(false);
  });

  test("unscoped identity alone grants no document access", () => {
    const claims = readOfficeAccessClaims({ sub: "ordinary_user" });
    expect(claims.app.state).toBe("absent");
    expect(canAccessOfficeContent(claims, expected)).toBe(false);
  });

  test("an Interface grant alone never becomes a browser membership", () => {
    const claims = readOfficeAccessClaims({
      token_use: "interface_oauth",
      takosumi: {
        capsule_id: "office_a",
        app_role: "owner",
        interface_id: "interface_a",
        interface_binding_id: "binding_a",
        interface_resolved_revision: 1,
      },
    });
    expect(officeAppRole(claims, "office_a")).toBeNull();
    expect(canAccessOfficeContent(claims, expected)).toBe(false);
  });
});
