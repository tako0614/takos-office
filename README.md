# Takos Office

**Takos Office** is the Takos ecosystem's productivity suite — **documents, slides, and spreadsheets
in one self-hostable worker**, runnable inside your own Takos Workspace and **agent-native** through a
single MCP endpoint. It replaces the previously separate `takos-docs`, `takos-slide`, and `takos-excel`
apps, which are now folded into this one app.

It is the self-hosted, AI-operable alternative to Google Workspace / Microsoft 365 that you own.

## Layout

```
takos-office/
  app/
    docs/      editor SPA + Hono routes (mounted at /docs)   — formerly takos-docs
    slide/     editor SPA + Hono routes (mounted at /slide)  — formerly takos-slide
    sheet/     editor SPA + Hono routes (mounted at /sheet)  — formerly takos-excel
    shared/    single copy of app-auth.ts, mcp-factory.ts, lib/takos-storage.ts
    server.ts        unified Hono worker (mounts the three editors + /mcp + /healthz)
    mcp.ts           unified MCP server (docs + slide + sheet tools on one endpoint)
    build-worker.ts  bundles the three SPA builds + the worker into dist/worker.js
  site/        standalone marketing site (office.takos.jp)
  docs/        roadmap
  outputs.tf   one OpenTofu app_deployment ("takos-office")
```

## How it serves

One Cloudflare Worker, one Installation, three editor surfaces:

| URL        | Surface                                  |
| ---------- | ---------------------------------------- |
| `/`        | Office shell (cross-editor nav, recent items, cross-app search) |
| `/docs`    | document editor (`.takosdoc`)            |
| `/slide`   | presentation editor (`.takosslide`)      |
| `/sheet`   | spreadsheet editor (`.takossheet`)       |
| `/api/office/{items,search}` | cross-app recent / search feeding the shell |
| `/mcp`     | unified MCP (≈80 `docs_*`/`slide_*`/`sheet_*` tools) |
| `/healthz` | readiness probe                          |

Each editor SPA is built with its own vite `base` (`/docs/`, `/slide/`, `/sheet/`) and SolidJS Router
base, so assets and routes resolve under the subpath. Storage stays the Takos Storage HTTP API
(folders `/takos-docs/`, `/takos-slide/`, `/takos-excel/`), unchanged.

## Build

```sh
bun install
bun run build      # 3 vite builds (build:spa) + unified worker (build:worker) → dist/worker.js
bun run check      # tsc --noEmit
bun test           # editor tests under app/*/src/__tests__
```

Run locally with `bun run start` (needs `TAKOS_STORAGE_API_URL`, `TAKOS_ACCESS_TOKEN`,
`TAKOS_SPACE_ID`, `MCP_AUTH_TOKEN`).

## Boundary

Takos Office is **one** 1st-party Capsule app (`jp.takos.office`), seeded into new Workspaces as a
single Installation and removable as a whole. The three editors are no longer independently
installable — they are surfaces of this app. It remains substitutable: being "office" grants no
architectural privilege over Takos core. See [`AGENTS.md`](AGENTS.md), [`docs/roadmap.md`](docs/roadmap.md),
and the ecosystem [`AGENTS.md`](../../AGENTS.md).

The former standalone repos (`takos-apps/takos-docs`, `takos-apps/takos-slide`, `takos-apps/takos-excel`)
are retired; their history lives in their own git remotes.

## Site deploy

See [`site/DEPLOY.md`](site/DEPLOY.md).
