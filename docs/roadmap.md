# Takos Office — Roadmap

Takos Office establishes the Takos ecosystem's productivity apps as one coherent, self-hosted,
agent-native suite. This document is the canonical place for what exists, what's planned, and the
(optional) path toward deeper integration.

## Core (available today)

All three core editors now ship as surfaces of the single `takos-office` worker:

| Surface  | Role                  | Mounted at | Status    |
| -------- | --------------------- | ---------- | --------- |
| docs     | Documents / notes     | `/docs`    | Available |
| slide    | Presentations         | `/slide`   | Available |
| sheet    | Spreadsheets / 表計算 | `/sheet`   | Available |

They are seeded into new Workspaces as a single `takos-office` Installation (removable as a whole) and
share one unified `/mcp` endpoint. The former standalone `takos-docs` / `takos-slide` / `takos-excel`
repos are retired.

## Planned apps

These are direction, not commitments. They extend the suite while keeping each app an independent,
self-hostable Capsule.

| App              | Role                                          | Stage     |
| ---------------- | --------------------------------------------- | --------- |
| `takos-calendar` | Scheduling / events (CalDAV-friendly)         | Planned   |
| `takos-mail`     | Mail client surface over your own mailbox     | Planned   |
| `takos-form`     | Forms / surveys with results into a sheet     | Planned   |
| `takos-base`     | Lightweight database / structured tables      | Exploring |

Each future app must:

- stay an independent Capsule with its own submodule under `takos-apps/`,
- be substitutable (no architectural privilege from being "office"),
- expose an MCP surface so agents can operate it,
- live inside the user's Workspace (data ownership stays with the user).

## Positioning

Takos Office is the self-hosted, agent-operable alternative to Google Workspace / Microsoft 365:

1. **Workspace-resident** — runs inside *your* Takos Workspace; your data never leaves your infra.
2. **Agent-native** — every app speaks MCP, so AI agents read and write your documents directly.
3. **Capsule, not subscription** — install as OpenTofu Capsules on your own infra; no seat licensing.

## Done: code / worker integration

The three apps are now folded into one worker (`app/server.ts` mounts `/docs`, `/slide`, `/sheet`;
`app/mcp.ts` aggregates all tools onto one `/mcp`; `app/build-worker.ts` bundles the three SPA builds
into a single `dist/worker.js`). Trade-off accepted: the editors are no longer independently
installable — they are surfaces of one `takos-office` app/Installation. Substitutability is preserved
(being "office" grants no privilege over Takos core), and storage / MIME / file-handler contracts are
unchanged.

### Done: office shell

A shared **office shell** now lands at `/` (`app/shell-page.ts`): cross-editor nav cards, a
"recent across all apps" list, and cross-app search, backed by `/api/office/items` and
`/api/office/search` (`app/office-items.ts` aggregates the docs/slide/sheet stores server-side).
It composes the three subpath surfaces without changing each editor's build, and preserves the
current `space_id` when navigating into an editor.

## Site

The marketing surface lives in [`../site/`](../site) — a self-contained static site published to
Cloudflare Pages. Update it whenever the suite's apps, positioning, or roadmap change.
