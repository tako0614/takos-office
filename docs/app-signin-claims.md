# App-scoped sign-in integration (TASK-0118)

Status: the pure claims policy and its tests are implemented. Runtime integration
is pending coordination with the active Office editor/auth work. This document
does not claim that the current browser or Interface routes use the new policy.

Office is one app containing docs, slide, and sheet. Its current storage model has
private shared content and no per-document sharing grants. Any Takosumi account
may sign in; a matching `takosumi.capsule_id` plus `takosumi.app_role` of `owner`
or `member` permits private content access. A matching Capsule without a role is
an ordinary signed-in user unless matching legacy Workspace membership remains
during compatibility. That legacy membership retains private content access.
The role helper identifies app management membership; Office does not implement Takosumi
ownership transfer or member-management APIs.

`app/shared/office-access-claims.ts` accepts authenticated UserInfo only. Its
`officeAppRole` function requires an exact deployment Capsule match. Its
`canAccessOfficeContent` function preserves legacy `workspace_memberships` and
`takosumi.workspace_id` access when app claims are absent, and supports the
current capsule-bound compatibility shape described below. An
explicit Capsule mismatch or malformed app evidence cannot use the fallback.
Current Accounts already emits capsule_id, workspace_id, role and top-level
workspace_memberships without app_role. For that shape the Capsule must match,
the nested workspace_id must equal the configured compatibility Workspace, and
a legacy role or membership must be present; private access then stays as before.
A role-less account without that legacy evidence remains an ordinary user.
UserInfo must be revalidated on each content request so revocation takes effect on the next request; cached session
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

When integrating the policy, the owning runtime writer must add
coverage for owner/member access across the root, docs, slide, and sheet APIs;
ordinary users; cross-Capsule denial; app-role revocation; subject changes;
legacy Workspace compatibility; workspace-less Interface OAuth; and namespace
override rejection. The repository CI runs `bun run check`, including type
checking, portable tests, builds, and worker size validation.

Owner handoff after independent review: do not apply the previous runtime wiring
patch embedded in TASK0118-E-COORDINATION.json. It was generated against the
TASK-0117 owner's dirty shared checkout and is not a valid source patch for this
branch. The owner must integrate from their current committed runtime source,
reuse this corrected helper, and run the runtime regressions above. This PR
continues to change only the helper, its tests, and documentation. The helper
keeps private documents restricted to app owner/member or compatible legacy
membership; any explicit public-share route must retain its own public policy.
