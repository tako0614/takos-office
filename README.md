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
`OBJECT_STORAGE_ACCESS_TOKEN`, and a storage namespace (`TAKOS_SPACE_ID`).

For browser storage managed by Takosumi, configure the explicit HTTPS
`TAKOSUMI_CONTROL_API_URL`, app-scoped OIDC sign-in, `APP_CAPSULE_ID`, and a fixed
`APP_WORKSPACE_ID`/`TAKOS_SPACE_ID`. The root manifest requests the four
`storage.object.*` permissions using the explicit `oauth2.app-data.v1` delivery.
Each request revalidates its signed-in person; every object operation obtains a
new exact-permission token with `dataScope: "app-shared.v1"`. No invocation token
is written into frontend storage or cached across people. Failed or invalid
runtime configuration never falls back to the standalone bearer.

The root module exposes `takosumi_control_api_url` as a visible explicit input.
It retains an empty HCL default for existing standalone callers. An
app-authenticated Worker without explicit standalone Storage is refused by a
resource precondition until this URL is supplied, before resources can be changed. The URL is not inferred from Accounts, request Host, or outputs.
An operator must explicitly permit these four storage permissions and this
new delivery profile; the default launcher/MCP-only policy intentionally refuses
it. Normal provider selection and approval remain required.

Use an artifact built from this updated source. The existing `v0.3.1` release
pin is unchanged and does not prove the new runtime consumer is deployed.
Existing Binding-scoped objects are not copied into the new app namespace;
changing a live connection needs an explicit data migration/cutover. Browser
app-session delegation does not turn an incoming MCP invocation bearer into an
Office app login: cookie-less MCP storage delegation and portable-module runtime
configuration remain separate follow-ups. MCP retains its explicit standalone storage configuration even when browser
runtime storage is enabled. It does not use the new app namespace: the two routes
must not be assumed to see the same data without a separate migration/delegation
plan. No managed/live readiness is claimed by the local proof.

In runtime storage mode `/health` and `/healthz` validate configuration only and
return `storage: "per_request_authorization", storageProbed: false`; anonymous
probes never acquire person credentials or claim the backend is reachable. Each
signed-in operation performs the actual authorization/storage checks. Standalone
readiness retains its existing authenticated object-list probe.

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
  docs/        roadmap and the mcp.tools interface spec
  design.md    locked design system for the editors — tokens.css is its runnable export
  outputs.tf   ordinary runtime URLs used by reviewed Interface requests
```

## Runtime contract

Takos Office publishes the Office Suite launcher and unified MCP endpoint and consumes an object-storage service.
The root module in `.well-known/takosumi.json` requests the launcher at `/`, the MCP Interface at `/mcp`, and the
installing principal's `ui.open` / `mcp.invoke` bindings. Takosumi validates these requests against operator policy
and compiles them into its DB-owned `InstallConfig.interfaceBlueprints`. The ordinary OpenTofu outputs alone
grant no access and do not create a launcher.

| Direction | Service identity / capability                                                                  |
| --------- | ---------------------------------------------------------------------------------------------- |
| publish   | `mcp.server` at `/mcp`                                                                         |
| publish   | `interface.ui.surface` at `/`, opening the Suite shell with Docs, Slides and Sheets links      |
| consume   | `storage.object` via explicit app-shared Link and per-operation authority, or standalone `OBJECT_STORAGE_API_URL` / `OBJECT_STORAGE_ACCESS_TOKEN` |

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

Docs retains title and content edits in the current Workspace's browser cache
before its 500 ms autosave delay. Reloading during that delay restores an
**Unsaved draft** with explicit save/discard recovery; it does not silently
replay a write. A pending request whose acknowledgement was lost remains
**Save unconfirmed**, even after further typing. Both paths keep the existing
server revision checks and require a fresh read for explicit replacement.

On phone screens, Docs places its collapsible outline above the document and
gives the title its own row. Compact screen gutters keep text readable. The
desktop outline retains its separate collapse preference and releases the
sidebar space when collapsed. Choosing a heading focuses its text and scrolls
that heading into view; on phones it also closes the outline.

Opening or creating a document and returning to the Docs library preserve the
active Workspace in the URL, so reloading keeps API reads in that Workspace.
Both `space_id` and `spaceId` entry URLs are supported; standalone URLs remain
usable without adding a Workspace identifier.

Slides and Sheets also retain the Workspace across library/editor navigation,
including creation and error recovery. Slides keeps it when starting a
presentation, leaving with Escape, or exiting fullscreen. Sheets sends a
create-only condition when saving a new spreadsheet. Both editors wait for the
create acknowledgement before opening the new item. An unconfirmed create
is retained for its Workspace across route changes and remounts until a
successful library read, without resending it.

Sheets serializes saves for each spreadsheet against acknowledged server
revisions. Its cache and pending-write journal belong to the selected Workspace.
Conflicts and unknown acknowledgements retain the local draft, including across
reload, and block automatic replay. Recovery offers a fresh conditional
replacement or an explicit read/discard; a concurrent writer can still reject
the replacement. Tab operations use the same revision queue, and deletion
removes a local item only after an explicit successful deletion acknowledgement.
Formula-bar typing retains its own focus; each Enter commits the edit once.

Slides uses the same acknowledged-revision queue and Workspace-bound cache/journal.
Continuous edits and late responses preserve newer drafts. Unknown saves or true
conflicts retain the draft across reload and expose explicit conditional recovery;
opening presentation mode also keeps the current Workspace. Library deletion
keeps the item until an explicit successful deletion acknowledgement.

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

The Repository manifest uses `takosumi.com/v2.5` to request the current Workspace
and Capsule IDs as noneditable context data for the existing root string inputs.
Use an installer that supports v2.5 and select module `.` explicitly; the existing
Cloudflare Source option retains that path. The legacy `defaultModule` hint is
not part of v2.5. These selectors carry no literal ID, credential, or grant, and
they do not change the portable module's contract.

Managed installation requires the authenticated Capsule context to supply the non-secret Workspace id in
`object_storage_workspace_id` and the Capsule id in `app_capsule_id`; the Worker Plan rejects a missing owner
context. The module injects them into the Worker as
`APP_WORKSPACE_ID` and `APP_CAPSULE_ID` (and keeps `TAKOS_SPACE_ID` for the storage namespace). Interface ids and
resolved revisions do not exist until after apply, so they are deliberately not module variables or Worker env.

### MCP authentication

Managed `/mcp` calls use short-lived InterfaceBinding OAuth credentials with the exact `mcp.invoke` permission and
`mcp_url` audience. For every request, the Worker sends the bearer to Takosumi Accounts UserInfo. Accounts first
revalidates current Interface and Binding state; the Worker then requires all of the following from the 200 response:

- `token_use: "interface_oauth"`, a non-empty `sub`, exact `aud`, and exact single `scope`;
- exact `takosumi.capsule_id`; an optional `takosumi.workspace_id`, when present,
  must match the configured namespace (`APP_WORKSPACE_ID` or `TAKOS_SPACE_ID`);
- non-empty `interface_id` and `interface_binding_id`, plus a positive `interface_resolved_revision`.

The check is fail-closed, follows no UserInfo redirects, and keeps no static Interface id/revision pin. An explicitly
provided `mcp_auth_token` is still accepted as `MCP_AUTH_TOKEN` for direct/self-host standalone use only. Empty input
creates no standing MCP credential, and no credential is exposed through an Output.

## Build

```sh
bun install
bun run build      # 3 vite builds (build:spa) + unified worker (build:worker) → dist/worker.js
bun run check      # format/type/tests/3 SPA builds/worker build + artifact-size gate
bun audit           # high/critical dependency advisory gate
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
execution authority. Interface and binding declarations are requests, not realized grants. Takosumi validates
the proposal and compiles it into a DB-owned InstallConfig before the ordinary Plan and Apply lifecycle.

## Boundary

Takos Office is **one** installable Capsule app (`jp.takos.office`). It can be
added explicitly from a Store or Git install link and removed as a whole. The
three editors are no longer independently installable — they are surfaces of
this app. It remains substitutable: being "office" grants no
architectural privilege over Takos core. See [`AGENTS.md`](AGENTS.md), [`docs/roadmap.md`](docs/roadmap.md),
[`design.md`](design.md), the [`mcp.tools` interface spec](docs/interfaces/mcp-tools-v1.md),
and the ecosystem [`AGENTS.md`](../takos-control/AGENTS.md).

The former standalone repos (`takos-apps/takos-docs`, `takos-apps/takos-slide`, `takos-apps/takos-excel`)
are retired; their history lives in their own git remotes.

## Site deploy

See [`site/DEPLOY.md`](site/DEPLOY.md).
