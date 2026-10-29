# TASK-0118: App-scoped Office sign-in

- Scope: `takos-office` claims policy for Phase 7 of the cross-repository
  per-app ownership migration. The parent TASK-0118 ledger owns sequencing.
- Implemented: additive pure policy in `app/shared/office-access-claims.ts`,
  focused policy tests, and the forward integration contract in
  `docs/app-signin-claims.md`.
- Pending: active Office auth/server/editor/test files are owned by another
  writer. Exact proposed runtime, test, and deployment-input patches are handed
  to the parent coordination record; they are not applied in this branch. The
  old wiring proposal was generated against TASK-0117 dirty source and must not
  be applied; the Office owner must integrate from its current committed source.
- Access policy: any account can establish a sign-in session. Private documents
  remain restricted to matching app owner/member roles, with legacy Workspace
  compatibility when app claims are absent or when the exact Capsule matches,
  app_role is absent, and matching nested Workspace plus role/membership remains. Ordinary signed-in users receive
  no private content access because Office has no per-document sharing grants.
- Authority boundary: no deploy, live sign-in, provider resources, live database,
  credentials, ownership records, or billing state are changed.
- Verification: focused claims tests, TypeScript checking, and formatting/static
  checks locally; the complete repository gate runs in PR CI.
