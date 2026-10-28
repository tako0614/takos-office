/**
 * Office access policy for already authenticated Accounts UserInfo. This module
 * does not authenticate a token or turn an Interface grant into a browser role.
 */
export type OfficeAppRole = "owner" | "member";

export interface OfficeAccessClaims {
  readonly workspaceIds: readonly string[];
  readonly app:
    | { readonly state: "absent" }
    | { readonly state: "invalid" }
    | {
        readonly state: "scoped";
        readonly capsuleId: string;
        readonly role?: OfficeAppRole;
      };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCapsuleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/\s/u.test(value)
  );
}

function workspaceIdsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    const id = isRecord(entry) ? (entry.workspace_id ?? entry.id) : entry;
    if (typeof id === "string" && id.trim() !== "") ids.add(id);
  }
  return [...ids];
}

export function readOfficeAccessClaims(value: unknown): OfficeAccessClaims {
  if (!isRecord(value) || value.token_use === "interface_oauth") {
    return { workspaceIds: [], app: { state: "invalid" } };
  }
  const workspaceIds = workspaceIdsFrom(value.workspace_memberships);
  const evidence = value.takosumi;
  if (evidence !== undefined && !isRecord(evidence)) {
    return { workspaceIds, app: { state: "invalid" } };
  }
  const workspaceId = evidence?.workspace_id;
  if (
    typeof workspaceId === "string" &&
    workspaceId.trim() !== "" &&
    !workspaceIds.includes(workspaceId)
  ) {
    workspaceIds.push(workspaceId);
  }
  if (
    !evidence ||
    (!Object.hasOwn(evidence, "capsule_id") &&
      !Object.hasOwn(evidence, "app_role"))
  ) {
    return { workspaceIds, app: { state: "absent" } };
  }
  const capsuleId = evidence.capsule_id;
  const role = evidence.app_role;
  if (
    !validCapsuleId(capsuleId) ||
    (role !== undefined && role !== "owner" && role !== "member")
  ) {
    return { workspaceIds, app: { state: "invalid" } };
  }
  return {
    workspaceIds,
    app: {
      state: "scoped",
      capsuleId,
      ...(role === undefined ? {} : { role }),
    },
  };
}

/** Only an exact deployment Capsule match grants an app management role. */
export function officeAppRole(
  claims: OfficeAccessClaims,
  expectedCapsuleId: string | null | undefined,
): OfficeAppRole | null {
  return claims.app.state === "scoped" &&
    validCapsuleId(expectedCapsuleId) &&
    claims.app.capsuleId === expectedCapsuleId
    ? (claims.app.role ?? null)
    : null;
}

/**
 * Office currently has private shared documents and no per-document sharing
 * grants. Ordinary signed-in users therefore receive no document access. The
 * Workspace adapter applies only to issuers without the new app claims.
 */
export function canAccessOfficeContent(
  claims: OfficeAccessClaims,
  expected: {
    readonly capsuleId?: string | null;
    readonly workspaceId?: string | null;
  },
): boolean {
  if (claims.app.state !== "absent") {
    return officeAppRole(claims, expected.capsuleId) !== null;
  }
  return (
    typeof expected.workspaceId === "string" &&
    expected.workspaceId !== "" &&
    claims.workspaceIds.includes(expected.workspaceId)
  );
}
