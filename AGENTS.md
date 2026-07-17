# AGENTS.md — takos-office

`takos-office` は Takos ecosystem の **office suite を 1 つの worker に統合した 1st-party app**。
文書 (docs) / プレゼン (slide) / 表計算 (sheet) を `/docs` `/slide` `/sheet` のサブパスで配信し、
`/mcp` に docs/slide/sheet 全ツールを束ねた単一 MCP を公開する。旧 `takos-docs` / `takos-slide` /
`takos-excel` はこの app に畳み込まれ、retire 済み。

## 責務

### 持つ

- 3 エディタを mount する unified Hono worker (`app/server.ts`) と単一 MCP (`app/mcp.ts`)
- 共有ヘルパの単一ソース (`app/shared/`: app-auth / mcp-factory / lib/takos-storage)
- 単一 plain OpenTofu module (`main.tf` / `outputs.tf`) と、service-side Interface blueprint が参照する
  ordinary URL Output (`mcp_url` / 3 UI URL / 3 file-open URL)
- marketing site (`site/`) と roadmap (`docs/`)

### 持たない

- Takos core に対する architectural privilege（office であることは特権ではない、substitutable）
- platform 層の federation / 新 runtime（統合は worker 内の compose に閉じる）
- secrets / deploy 実行（repo 外の operator 環境で行う）

## 不変条件

- **1 app / 1 worker / 1 Capsule install unit**。`jp.takos.office` としてユーザーが明示的に install でき、
  whole app 単位で uninstall 可能。docs/slide/sheet は個別 uninstall できない（app の surface）。
- 各エディタは自分の vite `base` (`/docs/` 等) と Router base を持ち、storage は `storage.object`
  Interface から注入される `OBJECT_STORAGE_API_URL` / `OBJECT_STORAGE_ACCESS_TOKEN`、`/takos-docs/` `/takos-slide/`
  `/takos-excel/` フォルダ) を使う。
  MIME / 拡張子 (`.takosdoc` / `.takosslide` / `.takossheet`) は維持する。
- MCP ツール名は名前空間付き (`docs_*` / `slide_*` / `sheet_*`)。衝突させない。
- managed `/mcp` の正本認証は短命な InterfaceBinding OAuth credential。Accounts UserInfo の
  current-state 結果に対し、exact audience (`mcp_url`) / `mcp.invoke` / Workspace / Capsule / subject /
  Interface + Binding + positive resolved revision evidence を毎回 fail-closed 検証する。Interface id / revision は
  module input や Worker env に pin しない。
- `mcp_auth_token` / `MCP_AUTH_TOKEN` は値を明示した direct/self-host deployment だけの standalone
  bearer。空値から生成せず、InterfaceBinding delivery や Output として扱わない。
- `app_deployment` / `service_exports` は retired runtime authority。repo の Output に戻さず、Interface 宣言は
  Takosumi service-side `InstallConfig.interfaceBlueprints` に置く。
- public vocabulary は ecosystem 正本に従う（Workspace / Project / Capsule / Run / StateVersion / Output …）。
  office 専用の platform 語彙を増やさない。

## エディタを足す / 変える

- エディタ source は `app/<editor>/src/` に置く。新エディタを足すなら vite `base` + Router base を
  サブパスに設定し、`app/server.ts` で `app.route("/<editor>", …)` を mount、`app/mcp.ts` に
  `register<Editor>Tools` を追加、`app/build-worker.ts` の `editors` 配列と `outputs.tf` の ordinary
  UI / file-open URL Output、service-side InstallConfig の Interface blueprint を同時に更新する。
- 共有コードは `app/shared/` の単一コピーを編集する（重複コピーを作らない）。i18n の scaffold も
  `app/shared/i18n.ts` の `createI18n(catalogs)` に単一化済みで、各エディタは自分の `en` / `ja`
  catalog だけを持つ（旧 `scripts/check-takos-apps-dedupe.mjs` の scaffold 同期検査は不要）。

## Build / Test

- `bun run build`（`build:spa` ×3 + `build:worker`）/ `bun run check`（tsc）/ `bun test` /
  `tofu fmt -check` / `tofu validate`。OpenTofu 契約を変えたら ecosystem root の
  `bun run test:install-cross-product` も実行する。
- `dist/worker.js` と editor SPA の `dist/` は local/CI generated output。Git には
  commit しない。hosted Takosumi install は Git release / CI artifact の
  `worker_bundle_url` + `worker_bundle_sha256` を使う。
- site deploy は `site/DEPLOY.md`。
- roadmap（将来 app: calendar / mail / form / base）は [`docs/roadmap.md`](docs/roadmap.md)。
