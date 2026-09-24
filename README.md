# Takos Office

**Takos Office** is the Takos ecosystem's productivity suite — **documents, slides, and spreadsheets
in one self-hostable worker**, runnable inside your own Takos Workspace and **agent-native** through a
single MCP endpoint. It replaces the previously separate `takos-docs`, `takos-slide`, and `takos-excel`
apps, which are now folded into this one app.

It is the self-hosted, AI-operable alternative to Google Workspace / Microsoft 365 that you own.

## What you can do

- write documents, slides, and spreadsheets in three editors served from one Worker
- import and download normal Microsoft Office files: `.docx`, `.pptx`, and `.xlsx`
- let an agent operate all three editors through a single MCP endpoint at `/mcp`
- keep every file in your own object storage — the app consumes `storage.object`, it does not host your data
- install it as one Capsule, or run it yourself with `bun run start`

## Getting started

```sh
bun install
bun run build      # 3 vite builds + unified worker -> dist/worker.js
bun run start      # run it locally
```

Standalone HTTP storage needs `OBJECT_STORAGE_API_URL`,
`OBJECT_STORAGE_ACCESS_TOKEN`, and a Workspace (`TAKOS_SPACE_ID`). A Takosumi
host binding supplies short-lived `storage.object` authority instead of a
standing storage token. See [Build](#build) for the full check and MCP
authentication options.

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
  outputs.tf   ordinary runtime URLs consumed by service-side Interface blueprints
```

## Runtime contract

Takos Office publishes the user-facing office surfaces and consumes an object-storage service. Runtime declarations
live in Takosumi's service-side `InstallConfig.interfaceBlueprints`; the repository exports only ordinary OpenTofu
values.

| Direction | Service identity / capability                                                                  |
| --------- | ---------------------------------------------------------------------------------------------- |
| publish   | `mcp.server` at `/mcp`                                                                         |
| publish   | `interface.ui.surface` for `/docs`, `/slide`, `/sheet`                                         |
| consume   | `storage.object` via `OBJECT_STORAGE_API_URL`; bearer comes from `OBJECT_STORAGE_ACCESS_TOKEN` |

## How it serves

One Cloudflare Worker, one Capsule install unit, three editor surfaces:

| URL                          | Surface                                                         |
| ---------------------------- | --------------------------------------------------------------- |
| `/`                          | redirects directly to the Docs library                          |
| `/docs`                      | document editor with `.docx` import/download                    |
| `/slide`                     | presentation editor with `.pptx` import/download                |
| `/sheet`                     | spreadsheet editor with `.xlsx` import/download                 |
| `/api/office/{items,search}` | cross-app recent / search for host integrations                 |
| `/mcp`                       | unified MCP (≈80 `docs_*`/`slide_*`/`sheet_*` tools)            |
| `/healthz`                   | readiness probe                                                 |

Each editor SPA is built with its own vite `base` (`/docs/`, `/slide/`, `/sheet/`) and SolidJS Router
base, so assets and routes resolve under the subpath. Storage stays the object-storage HTTP API
(folders `/takos-docs/`, `/takos-slide/`, `/takos-excel/`), unchanged.

### Office file compatibility

The standard Office formats are exchange formats; the private JSON model remains
the lossless editing state used for autosave, collaboration fencing, and MCP.

| Editor | Import / download | Preserved common content |
| ------ | ----------------- | ------------------------ |
| Docs   | `.docx`           | paragraphs, headings, lists, tables, links, common inline formatting, and embedded raster images |
| Slides | `.pptx`           | slide order and size, text, common shapes, embedded raster images, backgrounds, and speaker notes |
| Sheets | `.xlsx`           | worksheets, values, formulas with cached results, common cell formatting, and row/column sizes |

Import is deliberately bounded to 25 MiB compressed, 100 MiB expanded, and
10,000 ZIP entries; converted editing state must fit 7 MiB. Slides retains at
most 5 MiB of embedded raster image bytes per imported deck. Sheets additionally
accepts at most 1,000 rows, 100 columns, and 10,000 populated cells. Macros,
charts, SmartArt, animations, grouped slide
objects, and other advanced Office constructs are not claimed as pixel-perfect;
unsupported content is omitted or reduced to a safe fallback rather than
silently being treated as lossless.

### OpenTofu outputs and first apply

The four Interface source URLs are ordinary root-module outputs:

| Output                | Runtime surface                      |
| --------------------- | ------------------------------------ |
| `mcp_url`             | unified Streamable HTTP MCP resource |
| `docs_url`            | Docs UI                              |
| `slide_url`           | Slide UI                             |
| `sheet_url`           | Sheet UI                             |

Takos Office keeps a private JSON model in Takos Storage as its lossless
editing state. The native `.takosdoc`, `.takosslide`, and `.takossheet` record
names are storage implementation details and recovery compatibility, not
end-user formats or published file-handler Interfaces.

`launch_url` / `url` / `public_url` remain normal deployment convenience outputs. `app_deployment` and
`service_exports` are retired and are not runtime registries.

On a managed first apply, Takosumi projects the non-secret Workspace id into
`object_storage_workspace_id` and the Capsule id into `app_capsule_id`. The module injects them into the Worker as
`APP_WORKSPACE_ID` and `APP_CAPSULE_ID` (and keeps `TAKOS_SPACE_ID` for the storage namespace). Interface ids and
resolved revisions do not exist until after apply, so they are deliberately not module variables or Worker env.

### MCP authentication

Managed `/mcp` calls use short-lived InterfaceBinding OAuth credentials with the exact `mcp.invoke` permission and
`mcp_url` audience. For every request, the Worker sends the bearer to Takosumi Accounts UserInfo. Accounts first
revalidates current Interface and Binding state; the Worker then requires all of the following from the 200 response:

- `token_use: "interface_oauth"`, a non-empty `sub`, exact `aud`, and exact single `scope`;
- exact `takosumi.workspace_id` and `takosumi.capsule_id`;
- non-empty `interface_id` and `interface_binding_id`, plus a positive `interface_resolved_revision`.

The check is fail-closed, follows no UserInfo redirects, and keeps no static Interface id/revision pin. An explicitly
provided `mcp_auth_token` is still accepted as `MCP_AUTH_TOKEN` for direct/self-host standalone use only. Empty input
creates no standing MCP credential, and no credential is exposed through an Output.

## Build

```sh
bun install
bun run build      # 3 vite builds (build:spa) + unified worker (build:worker) → dist/worker.js
bun run check      # format/type/tests/3 SPA builds/worker build + artifact-size gate
bun run audit      # high/critical dependency advisory gate
bun test           # editor and worker tests under app/**/__tests__
```

Run locally with `bun run start`. Storage needs `OBJECT_STORAGE_API_URL`, `OBJECT_STORAGE_ACCESS_TOKEN`, and a
Workspace (`TAKOS_SPACE_ID`). For MCP, either provide an explicit standalone `MCP_AUTH_TOKEN`, or configure
`APP_URL`, `OIDC_ISSUER_URL`, `APP_WORKSPACE_ID`, and `APP_CAPSULE_ID` for Interface OAuth. Unauthenticated MCP is
available only through the explicit local/dev `MCP_ALLOW_UNAUTHENTICATED` escape hatch.

`dist/worker.js` is generated output for local/self-host applies. Hosted
Takosumi installs should pass `worker_bundle_url` + `worker_bundle_sha256` from
a Git release or CI artifact. Do not commit the built worker or SPA output to
the repository.

[`install-options.json`](install-options.json) is the optional source chooser.
The separate general
[`.well-known/takosumi.json`](.well-known/takosumi.json) `Repository` manifest
proposes input names and presentation projections for the root direct module and
`deploy/takoform` from the same Git commit. Neither document carries secrets,
provider credentials, Cloudflare account authority, Interface grants, or
execution authority. Takosumi validates the proposal and compiles it into a
DB-owned InstallConfig before the ordinary Plan and Apply lifecycle.

## Boundary

Takos Office is **one** installable Capsule app (`jp.takos.office`). It can be
added explicitly from a Store or Git install link and removed as a whole. The
three editors are no longer independently installable — they are surfaces of
this app. It remains substitutable: being "office" grants no
architectural privilege over Takos core. See [`AGENTS.md`](AGENTS.md), [`docs/roadmap.md`](docs/roadmap.md),
and the ecosystem [`AGENTS.md`](../../AGENTS.md).

The former standalone repos (`takos-apps/takos-docs`, `takos-apps/takos-slide`, `takos-apps/takos-excel`)
are retired; their history lives in their own git remotes.

## Site deploy

See [`site/DEPLOY.md`](site/DEPLOY.md).
