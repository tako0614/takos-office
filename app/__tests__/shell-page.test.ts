import { expect, test } from "bun:test";

import { renderShellPage } from "../shell-page.ts";
import { createOfficeApp } from "../server.ts";

const html = renderShellPage();

test("shell renders the drive-style chrome (new menu, filters, view toggle)", () => {
  // Prominent "New" entry points (sidebar button + mobile FAB) and one
  // create menu item per editor.
  expect(html).toContain('id="new-btn"');
  expect(html).toContain('id="fab"');
  for (const app of ["docs", "slide", "sheet"]) {
    expect(html).toContain(`data-new="${app}"`);
  }
  // Sidebar type filters (Home + one per editor) and the list/grid toggle.
  for (const filter of ["all", "docs", "slide", "sheet"]) {
    expect(html).toContain(`data-filter="${filter}"`);
  }
  expect(html).toContain('data-view="list"');
  expect(html).toContain('data-view="grid"');
  // Sortable list columns.
  expect(html).toContain('data-sort="title"');
  expect(html).toContain('data-sort="updatedAt"');
});

test("shell wires the office APIs and per-editor collection APIs", () => {
  expect(html).toContain("/api/office/items");
  expect(html).toContain("/api/office/search");
  // Create/rename/delete go straight to each editor's own API.
  expect(html).toContain("/docs/api/documents");
  expect(html).toContain("/slide/api/presentations");
  expect(html).toContain("/sheet/api/spreadsheets");
  expect(html).toContain('"PATCH"');
  expect(html).toContain('"DELETE"');
  // 401s bounce through the suite login flow.
  expect(html).toContain("/docs/api/auth/login?return_to=");
});

test("shell keeps suite conventions (theme, language, workspace)", () => {
  expect(html).toContain("takos-theme");
  expect(html).toContain("takos-lang");
  expect(html).toContain("space_id");
  // Item actions confirm through dialogs, not window.confirm/prompt.
  expect(html).toContain('id="rename-dialog"');
  expect(html).toContain('id="delete-dialog"');
  expect(html).not.toContain("window.confirm");
  expect(html).not.toContain("window.prompt");
});

test("shell ships both en and ja catalogs", () => {
  expect(html).toContain("Untitled document");
  expect(html).toContain("無題のドキュメント");
  expect(html).toContain("無題のプレゼンテーション");
  expect(html).toContain("無題のスプレッドシート");
  expect(html).toContain("名前を変更");
  expect(html).toContain("Last modified");
  expect(html).toContain("最終更新");
});

test("office root serves the shell page", async () => {
  const { app } = createOfficeApp({
    OBJECT_STORAGE_API_URL: "http://localhost:8787",
    OBJECT_STORAGE_ACCESS_TOKEN: "token",
    TAKOS_SPACE_ID: "space-1",
    MCP_AUTH_TOKEN: "secret",
  });
  const res = await app.request("/");
  expect(res.status).toEqual(200);
  expect(res.headers.get("content-type") ?? "").toContain("text/html");
  expect(await res.text()).toContain('id="new-btn"');
});
