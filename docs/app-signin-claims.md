# App-scoped sign-in integration (TASK-0118)

Status: the browser content guard uses the claims policy, and the MCP guard
accepts Capsule-scoped Interface credentials without Workspace claims. Portable
regressions exercise the routed APIs with synthetic identity and object-service
fixtures. This is source integration, not a deployed sign-in or storage qualification.

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
The compatibility UserInfo shape includes capsule_id, workspace_id, role and
top-level workspace_memberships without app_role. For that shape the Capsule must match,
the nested workspace_id must equal the configured compatibility Workspace, and
a legacy role or membership must be present; private access then stays as before.
Legacy Workspace `owner` and `admin` roles only satisfy the old Workspace
membership compatibility for private content; they do not prove Capsule
ownership or supply an app management role. Only an explicit matching
`app_role: owner` is an app owner signal. Legacy `viewer` remains a
compatibility membership without app management authority.
An explicitly malformed legacy role cannot use membership as a fallback.
Without APP_CAPSULE_ID, current capsule-bound claims still use the configured
legacy Workspace and role/membership; an incoming Capsule/app_role does not
supply the missing deployment authority.
A role-less account without that legacy evidence remains an ordinary user.
UserInfo must be revalidated on each content request so revocation takes effect on the next request; cached session
claims are not current authorization.

The runtime guard uses `APP_CAPSULE_ID` to select app authority. With an App id,
the storage namespace is fixed to `APP_WORKSPACE_ID` or standalone `TAKOS_SPACE_ID`;
missing configuration fails closed and caller-selected overrides are rejected. A Capsule role
must never authorize reading another namespace. `APP_WORKSPACE_ID` remains a
compatibility input, not the new management authority.

Interface OAuth remains a separate capability grant. A workspace-less grant may
be accepted only with the exact Capsule, resource audience, scope, subject,
Interface ID, binding ID, and positive resolved revision. Removing a Workspace
requirement must preserve all those checks and the storage namespace pin. An
Interface grant does not imply a browser app role.

`app/__tests__/office-runtime-auth.test.ts` covers owner/member access across
the root, docs, slide, and sheet APIs through the actual Hono factories;
ordinary users; cross-Capsule denial; app-role revocation; subject changes;
legacy Workspace compatibility; workspace-less Interface OAuth; and namespace
override rejection. Server factories accept explicit UserInfo and object-service
fetch dependencies and default to native fetch. The repository CI runs `bun run check`, including type
checking, portable tests, builds, and worker size validation.

The earlier wiring proposal embedded in TASK0118-E-COORDINATION.json targeted a
dirty shared checkout and was not adopted. Runtime integration was authored from
committed public source and reuses the corrected helper. Private documents remain
restricted to app owner/member or compatible legacy membership; any explicit
public-share route must retain its own public policy. The separate problem of
app-shared storage authority under Principal-scoped InterfaceBinding namespaces
is not resolved by this sign-in integration.

## Follow-up rollout order

Deploy the updated consuming apps first. Apply the Takosumi Accounts open-sign-in
writer B change from PR #657 last. Self-host installs that have not received the
app update must keep their configured `APP_WORKSPACE_ID` membership requirement
until they update.
