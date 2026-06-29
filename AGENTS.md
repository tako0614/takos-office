# AGENTS.md — takos-office

`takos-office` は Takos ecosystem の **office suite を 1 つの worker に統合した 1st-party app**。
文書 (docs) / プレゼン (slide) / 表計算 (sheet) を `/docs` `/slide` `/sheet` のサブパスで配信し、
`/mcp` に docs/slide/sheet 全ツールを束ねた単一 MCP を公開する。旧 `takos-docs` / `takos-slide` /
`takos-excel` はこの app に畳み込まれ、retire 済み。

## 責務

### 持つ

- 3 エディタを mount する unified Hono worker (`app/server.ts`) と単一 MCP (`app/mcp.ts`)
- 共有ヘルパの単一ソース (`app/shared/`: app-auth / mcp-factory / lib/takos-storage)
- 単一 OpenTofu manifest (`outputs.tf`, `app_deployment` name = `takos-office`)
- marketing site (`site/`) と roadmap (`docs/`)

### 持たない

- Takos core に対する architectural privilege（office であることは特権ではない、substitutable）
- platform 層の federation / 新 runtime（統合は worker 内の compose に閉じる）
- secrets / deploy 実行（repo 外の operator 環境で行う）

## 不変条件

- **1 app / 1 worker / 1 Installation**。`jp.takos.office` として新規 Workspace に seed され、
  whole app 単位で uninstall 可能。docs/slide/sheet は個別 uninstall できない（app の surface）。
- 各エディタは自分の vite `base` (`/docs/` 等) と Router base を持ち、storage は Takos Storage API
  (`/takos-docs/` `/takos-slide/` `/takos-excel/` フォルダ) のまま。MIME / 拡張子
  (`.takosdoc` / `.takosslide` / `.takossheet`) は維持する。
- MCP ツール名は名前空間付き (`docs_*` / `slide_*` / `sheet_*`)。衝突させない。
- public vocabulary は ecosystem 正本に従う（Workspace / Project / Capsule / Installation / Run …）。
  office 専用の platform 語彙を増やさない。

## エディタを足す / 変える

- エディタ source は `app/<editor>/src/` に置く。新エディタを足すなら vite `base` + Router base を
  サブパスに設定し、`app/server.ts` で `app.route("/<editor>", …)` を mount、`app/mcp.ts` に
  `register<Editor>Tools` を追加、`app/build-worker.ts` の `editors` 配列と `outputs.tf` の
  publish (UI surface / file handler) を更新する。
- 共有コードは `app/shared/` の単一コピーを編集する（重複コピーを作らない）。i18n の scaffold も
  `app/shared/i18n.ts` の `createI18n(catalogs)` に単一化済みで、各エディタは自分の `en` / `ja`
  catalog だけを持つ（旧 `scripts/check-takos-apps-dedupe.mjs` の scaffold 同期検査は不要）。

## Build / Test

- `bun run build`（`build:spa` ×3 + `build:worker`）/ `bun run check`（tsc）/ `bun test`。
- site deploy は `site/DEPLOY.md`。
- roadmap（将来 app: calendar / mail / form / base）は [`docs/roadmap.md`](docs/roadmap.md)。
