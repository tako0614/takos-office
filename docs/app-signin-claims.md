# App-scoped sign-in integration (TASK-0118)

Status: the pure claims policy and its tests are implemented. Runtime integration
is pending coordination with the active Office editor/auth work. This document
does not claim that the current browser or Interface routes use the new policy.

Office is one app containing docs, slide, and sheet. Its current storage model has
private shared content and no per-document sharing grants. Any Takosumi account
may sign in; a matching `takosumi.capsule_id` plus `takosumi.app_role` of `owner`
or `member` permits private content access. A matching Capsule without a role is
an ordinary signed-in user and receives no private content access. The role
helper identifies app management membership; Office does not implement Takosumi
ownership transfer or member-management APIs.

`app/shared/office-access-claims.ts` accepts authenticated UserInfo only. Its
`officeAppRole` function requires an exact deployment Capsule match. Its
`canAccessOfficeContent` function preserves legacy `workspace_memberships` and
`takosumi.workspace_id` access only when the new app claims are absent. An
explicit Capsule mismatch, missing app role, or malformed app evidence cannot
fall back to legacy Workspace membership. UserInfo must be revalidated on each
content request so revocation takes effect on the next request; cached session
claims are not current authorization.

The pending runtime change should use `APP_CAPSULE_ID` to select app authority.
Keep the storage namespace fixed to its configured storage coordinate and reject
caller-selected namespaces that differ from that coordinate. A Capsule role
must never authorize reading another namespace. `APP_WORKSPACE_ID` remains a
compatibility input, not the new management authority.

Interface OAuth remains a separate capability grant. A workspace-less grant may
be accepted only with the exact Capsule, resource audience, scope, subject,
Interface ID, binding ID, and positive resolved revision. Removing a Workspace
requirement must preserve all those checks and the storage namespace pin. An
Interface grant does not imply a browser app role.

Before applying the coordinated patches, the owning runtime writer must add
coverage for owner/member access across the root, docs, slide, and sheet APIs;
ordinary users; cross-Capsule denial; app-role revocation; subject changes;
legacy Workspace compatibility; workspace-less Interface OAuth; and namespace
override rejection. The repository CI runs `bun run check`, including type
checking, portable tests, builds, and worker size validation.
