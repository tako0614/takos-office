/**
 * The Office shell landing page served at `/`.
 *
 * A self-contained HTML page (no extra build target) shaped like a
 * drive-style file manager: a sidebar with a prominent "New" menu and
 * per-type filters, a centered cross-app search, and a list/grid file
 * view over the /api/office/* endpoints with per-item rename/delete
 * against each editor's own API. Links preserve the current `space_id`
 * query and every string ships in en/ja (shared `takos-lang` key).
 */

type OfficeAppKey = "docs" | "slide" | "sheet";

interface AppDef {
  app: OfficeAppKey;
  accent: string;
  /** Collection API for create/rename/delete, relative to the worker root. */
  api: string;
  /** inline SVG path(s), drawn in a 24x24 viewBox */
  icon: string;
}

const APPS: AppDef[] = [
  {
    app: "docs",
    accent: "#2563eb",
    api: "/docs/api/documents",
    icon:
      '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  },
  {
    app: "slide",
    accent: "#ea580c",
    api: "/slide/api/presentations",
    icon:
      '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4"/><path d="M8 20h8"/>',
  },
  {
    app: "sheet",
    accent: "#16a34a",
    api: "/sheet/api/spreadsheets",
    icon:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
  },
];

/**
 * en / ja catalogs for the shell. The page is served with English text and
 * `data-i18n` markers; a boot script swaps to the detected language (shared
 * `takos-lang` localStorage key, falling back to the browser language)
 * before the first data render.
 */
const CATALOGS = {
  en: {
    office: "Office",
    searchPlaceholder: "Search in Office",
    toggleTheme: "Toggle theme",
    newButton: "New",
    newDoc: "Document",
    newSlide: "Presentation",
    newSheet: "Spreadsheet",
    untitledDoc: "Untitled document",
    untitledSlide: "Untitled Presentation",
    untitledSheet: "Untitled Spreadsheet",
    navHome: "Home",
    navDocs: "Documents",
    navSlides: "Slides",
    navSheets: "Sheets",
    filterAll: "All",
    headingHome: "Home",
    headingDocs: "Documents",
    headingSlides: "Slides",
    headingSheets: "Sheets",
    headingResults: "Search results",
    viewList: "List view",
    viewGrid: "Grid view",
    colName: "Name",
    colType: "Type",
    colUpdated: "Last modified",
    typeDoc: "Document",
    typeSlide: "Presentation",
    typeSheet: "Spreadsheet",
    itemMenu: "More actions",
    menuOpen: "Open",
    menuOpenTab: "Open in new tab",
    menuRename: "Rename",
    menuDelete: "Delete",
    renameTitle: "Rename",
    renameLabel: "New name",
    save: "OK",
    cancel: "Cancel",
    deleteTitle: "Delete forever?",
    deleteBody: "“{name}” will be deleted forever. This can’t be undone.",
    deleteConfirm: "Delete",
    loading: "Loading…",
    emptyTitle: "Nothing here yet",
    emptyBody: "Files you create will appear here. Use “New” to get started.",
    emptySearchTitle: "No matching files",
    emptySearchBody: "Try a different search term.",
    errCreate: "Couldn’t create the file.",
    errRename: "Couldn’t rename the file.",
    errDelete: "Couldn’t delete the file.",
    errLoad: "Couldn’t load your files.",
    untitled: "Untitled",
    justNow: "just now",
    minAgo: "{n}m ago",
    hourAgo: "{n}h ago",
    dayAgo: "{n}d ago",
  },
  ja: {
    office: "Office",
    searchPlaceholder: "Office 内を検索",
    toggleTheme: "テーマを切り替え",
    newButton: "新規",
    newDoc: "ドキュメント",
    newSlide: "プレゼンテーション",
    newSheet: "スプレッドシート",
    untitledDoc: "無題のドキュメント",
    untitledSlide: "無題のプレゼンテーション",
    untitledSheet: "無題のスプレッドシート",
    navHome: "ホーム",
    navDocs: "ドキュメント",
    navSlides: "スライド",
    navSheets: "シート",
    filterAll: "すべて",
    headingHome: "ホーム",
    headingDocs: "ドキュメント",
    headingSlides: "スライド",
    headingSheets: "シート",
    headingResults: "検索結果",
    viewList: "リスト表示",
    viewGrid: "ギャラリー表示",
    colName: "名前",
    colType: "種類",
    colUpdated: "最終更新",
    typeDoc: "ドキュメント",
    typeSlide: "プレゼンテーション",
    typeSheet: "スプレッドシート",
    itemMenu: "その他の操作",
    menuOpen: "開く",
    menuOpenTab: "新しいタブで開く",
    menuRename: "名前を変更",
    menuDelete: "削除",
    renameTitle: "名前を変更",
    renameLabel: "新しい名前",
    save: "OK",
    cancel: "キャンセル",
    deleteTitle: "完全に削除しますか？",
    deleteBody: "「{name}」を完全に削除します。この操作は元に戻せません。",
    deleteConfirm: "削除",
    loading: "読み込み中…",
    emptyTitle: "まだファイルがありません",
    emptyBody: "作成したファイルはここに表示されます。「新規」から始めましょう。",
    emptySearchTitle: "一致するファイルはありません",
    emptySearchBody: "別のキーワードで検索してください。",
    errCreate: "ファイルを作成できませんでした。",
    errRename: "名前を変更できませんでした。",
    errDelete: "ファイルを削除できませんでした。",
    errLoad: "ファイルを読み込めませんでした。",
    untitled: "無題",
    justNow: "たった今",
    minAgo: "{n}分前",
    hourAgo: "{n}時間前",
    dayAgo: "{n}日前",
  },
} as const;

function svg(paths: string, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const ICON_PLUS = '<path d="M12 5v14"/><path d="M5 12h14"/>';
const ICON_SEARCH = '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>';
const ICON_HOME =
  '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>';
const ICON_LIST =
  '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>';
const ICON_GRID =
  '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>';
const ICON_KEBAB =
  '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>';
const ICON_SUN =
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const ICON_MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

const NAV_FILTERS: {
  filter: "all" | OfficeAppKey;
  i18n: keyof typeof CATALOGS.en;
  icon: string;
}[] = [
  { filter: "all", i18n: "navHome", icon: ICON_HOME },
  { filter: "docs", i18n: "navDocs", icon: APPS[0].icon },
  { filter: "slide", i18n: "navSlides", icon: APPS[1].icon },
  { filter: "sheet", i18n: "navSheets", icon: APPS[2].icon },
];

function newMenuItems(): string {
  const labels: Record<OfficeAppKey, keyof typeof CATALOGS.en> = {
    docs: "newDoc",
    slide: "newSlide",
    sheet: "newSheet",
  };
  return APPS.map(
    (a) => `
      <button type="button" role="menuitem" class="menu-item" data-new="${a.app}">
        <span class="menu-icon" style="color:${a.accent}">${svg(a.icon, 18)}</span>
        <span data-i18n="${labels[a.app]}">${CATALOGS.en[labels[a.app]]}</span>
      </button>`,
  ).join("");
}

function sidebarNav(): string {
  return NAV_FILTERS.map(
    (n) => `
      <button type="button" class="nav-item" data-filter="${n.filter}" aria-pressed="${n.filter === "all"}">
        <span class="nav-icon">${svg(n.icon, 18)}</span>
        <span data-i18n="${n.i18n}">${CATALOGS.en[n.i18n]}</span>
      </button>`,
  ).join("");
}

function filterChips(): string {
  const chips: { filter: string; i18n: keyof typeof CATALOGS.en }[] = [
    { filter: "all", i18n: "filterAll" },
    { filter: "docs", i18n: "navDocs" },
    { filter: "slide", i18n: "navSlides" },
    { filter: "sheet", i18n: "navSheets" },
  ];
  return chips.map(
    (n) => `
      <button type="button" class="chip" data-filter="${n.filter}" aria-pressed="${n.filter === "all"}">
        <span data-i18n="${n.i18n}">${CATALOGS.en[n.i18n]}</span>
      </button>`,
  ).join("");
}

export function renderShellPage(): string {
  const appMeta = Object.fromEntries(
    APPS.map((a) => [a.app, { accent: a.accent, api: a.api, icon: a.icon }]),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Takos Office</title>
<script>
  // Apply the shared suite theme before paint (no flash). Same key as the editors.
  (function () {
    try {
      var s = localStorage.getItem("takos-theme");
      var dark = s ? s === "dark"
        : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    } catch (e) { document.documentElement.dataset.theme = "light"; }
  })();
</script>
<style>
  :root {
    color-scheme: light;
    --bg: #f6f8fc;
    --panel: #ffffff;
    --text: #1f1f1f;
    --text-soft: #5f6368;
    --text-faint: #80868b;
    --line: #e3e7ee;
    --hover: #eef1f6;
    --active-pill: #dbe9fb;
    --active-text: #0b57d0;
    --focus: #2563eb;
    --shadow: 0 1px 2px rgba(60,64,67,.14), 0 1px 6px rgba(60,64,67,.12);
    --shadow-lg: 0 4px 8px rgba(60,64,67,.18), 0 8px 24px rgba(60,64,67,.14);
  }
  [data-theme="dark"] {
    color-scheme: dark;
    --bg: #0f1115;
    --panel: #161a22;
    --text: #e5e7eb;
    --text-soft: #9ca3af;
    --text-faint: #6b7280;
    --line: #262b36;
    --hover: #20262f;
    --active-pill: rgba(59,130,246,.22);
    --active-text: #8ab4f8;
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 1px 6px rgba(0,0,0,.4);
    --shadow-lg: 0 4px 12px rgba(0,0,0,.55), 0 10px 28px rgba(0,0,0,.45);
  }
  * { box-sizing: border-box; }
  /* Sections toggle via the hidden attribute; it must beat display:grid/flex. */
  [hidden] { display: none !important; }
  html, body { height: 100%; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
    background: var(--bg); color: var(--text);
    display: flex; flex-direction: column;
  }
  a { color: inherit; }
  button { font: inherit; color: inherit; }

  /* ---- Header ---- */
  header {
    display: flex; align-items: center; gap: 16px;
    padding: 10px 20px; flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 19px; text-decoration: none; flex-shrink: 0; }
  .brand .mark {
    width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
    background: linear-gradient(135deg, #2563eb 0%, #2563eb 33%, #ea580c 33%, #ea580c 66%, #16a34a 66%);
  }
  .brand b { font-weight: 600; } .brand .brand-text span { color: var(--text-soft); font-weight: 400; }
  .search { position: relative; flex: 1; max-width: 720px; }
  .search .search-icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--text-soft); pointer-events: none; display: inline-flex; }
  .search input {
    width: 100%; padding: 12px 18px 12px 48px; font-size: 15px; color: var(--text);
    border: none; border-radius: 999px; outline: none; background: #e9eef6;
  }
  [data-theme="dark"] .search input { background: #20262f; }
  .search input::placeholder { color: var(--text-soft); }
  .search input:focus { background: var(--panel); box-shadow: var(--shadow); }
  .header-actions { margin-left: auto; display: flex; gap: 4px; flex-shrink: 0; }
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 50%; border: none;
    background: transparent; color: var(--text-soft); cursor: pointer;
  }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
  .icon-btn:focus-visible, .nav-item:focus-visible, .chip:focus-visible,
  .new-btn:focus-visible, .menu-item:focus-visible, .seg:focus-visible,
  .kebab:focus-visible, .row-link:focus-visible, .sortable:focus-visible {
    outline: 2px solid var(--focus); outline-offset: 1px;
  }

  /* ---- Layout ---- */
  .layout { display: flex; flex: 1; min-height: 0; }
  aside {
    width: 244px; flex-shrink: 0; padding: 4px 12px 16px 16px;
    display: flex; flex-direction: column; gap: 4px; overflow-y: auto;
  }
  .new-btn {
    display: inline-flex; align-items: center; gap: 12px; align-self: flex-start;
    margin: 4px 0 14px; padding: 0 22px 0 16px; height: 54px;
    border: none; border-radius: 16px; cursor: pointer;
    background: var(--panel); color: var(--text); font-size: 15px; font-weight: 500;
    box-shadow: var(--shadow);
  }
  .new-btn:hover { box-shadow: var(--shadow-lg); }
  .nav-item {
    display: flex; align-items: center; gap: 14px; width: 100%;
    padding: 8px 16px; border: none; border-radius: 999px; cursor: pointer;
    background: transparent; font-size: 14px; text-align: left; color: var(--text);
  }
  .nav-item:hover { background: var(--hover); }
  .nav-item[aria-pressed="true"] { background: var(--active-pill); color: var(--active-text); font-weight: 600; }
  .nav-icon { display: inline-flex; color: var(--text-soft); }
  .nav-item[aria-pressed="true"] .nav-icon { color: var(--active-text); }

  /* ---- Main panel ---- */
  main {
    flex: 1; min-width: 0; margin: 0 16px 16px 4px; padding: 8px 8px 24px;
    background: var(--panel); border-radius: 16px; overflow-y: auto; position: relative;
  }
  .main-head {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px 6px; position: sticky; top: 0; background: var(--panel);
    border-radius: 16px 16px 0 0; z-index: 5;
  }
  .main-head h1 { font-size: 22px; font-weight: 400; margin: 0; flex: 1; min-width: 0; }
  .chips { display: none; gap: 8px; padding: 4px 16px 8px; overflow-x: auto; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip {
    padding: 6px 14px; border: 1px solid var(--line); border-radius: 8px;
    background: transparent; font-size: 13px; cursor: pointer; white-space: nowrap; color: var(--text);
  }
  .chip[aria-pressed="true"] { background: var(--active-pill); border-color: transparent; color: var(--active-text); font-weight: 600; }
  .view-toggle {
    display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; flex-shrink: 0;
  }
  .seg {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 32px; border: none; background: transparent; cursor: pointer; color: var(--text-soft);
  }
  .seg + .seg { border-left: 1px solid var(--line); }
  .seg[aria-pressed="true"] { background: var(--active-pill); color: var(--active-text); }

  /* ---- List view ---- */
  .list-head, .row { display: grid; grid-template-columns: minmax(0,1fr) 150px 170px 48px; align-items: center; gap: 8px; }
  .list-head {
    padding: 6px 16px; font-size: 12.5px; color: var(--text-soft); font-weight: 500;
    border-bottom: 1px solid var(--line); position: sticky; top: 54px; background: var(--panel); z-index: 4;
  }
  .list-head .sortable { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; padding: 4px 0; cursor: pointer; color: inherit; font: inherit; font-weight: 500; }
  .list-head .sortable:hover { color: var(--text); }
  .sort-arrow { font-size: 10px; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { position: relative; padding: 0 16px; height: 48px; border-bottom: 1px solid var(--line); }
  .row:hover { background: var(--hover); }
  .row-link { position: absolute; inset: 0; border-radius: 4px; z-index: 1; }
  .row-name { display: flex; align-items: center; gap: 12px; min-width: 0; font-size: 14px; }
  .row-name .name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-type, .row-time { font-size: 13px; color: var(--text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kebab {
    position: relative; z-index: 2; justify-self: end;
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border: none; border-radius: 50%;
    background: transparent; color: var(--text-soft); cursor: pointer;
  }
  .kebab:hover { background: color-mix(in srgb, var(--text-soft) 16%, transparent); color: var(--text); }

  /* ---- Grid view ---- */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(208px, 1fr)); gap: 14px; padding: 12px 16px; }
  .card {
    position: relative; border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    background: var(--panel); transition: box-shadow .12s, background .12s;
  }
  .card:hover { background: var(--hover); box-shadow: var(--shadow); }
  .card-thumb {
    height: 120px; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--card-accent) 9%, var(--bg));
    color: var(--card-accent);
  }
  .card-foot { display: flex; align-items: center; gap: 8px; padding: 10px 6px 10px 12px; }
  .card-meta { flex: 1; min-width: 0; }
  .card-name { font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-time { font-size: 12px; color: var(--text-soft); margin-top: 1px; }

  .type-icon {
    width: 30px; height: 30px; border-radius: 8px; align-items: center; justify-content: center;
    display: inline-flex; color: #fff; flex-shrink: 0;
  }
  .type-icon.sm { width: 24px; height: 24px; border-radius: 6px; }

  /* ---- States ---- */
  .state { text-align: center; color: var(--text-soft); padding: 64px 24px; }
  .state .state-icon { color: var(--text-faint); margin-bottom: 12px; }
  .state h3 { margin: 0 0 4px; font-size: 16px; font-weight: 500; color: var(--text); }
  .state p { margin: 0; font-size: 13.5px; }

  /* ---- Floating menu ---- */
  .float-menu {
    position: fixed; z-index: 50; min-width: 200px; padding: 6px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    box-shadow: var(--shadow-lg); display: none; flex-direction: column;
  }
  .float-menu.open { display: flex; }
  .menu-item {
    display: flex; align-items: center; gap: 12px; width: 100%;
    padding: 9px 14px; border: none; border-radius: 8px; background: transparent;
    font-size: 14px; text-align: left; cursor: pointer; color: var(--text);
  }
  .menu-item:hover { background: var(--hover); }
  .menu-item.danger { color: #dc2626; }
  [data-theme="dark"] .menu-item.danger { color: #f87171; }
  .menu-icon { display: inline-flex; color: var(--text-soft); }
  .menu-item.danger .menu-icon { color: inherit; }
  .menu-sep { height: 1px; margin: 5px 8px; background: var(--line); border: none; }

  /* ---- Dialogs ---- */
  dialog {
    border: none; border-radius: 16px; padding: 22px 24px; width: min(400px, calc(100vw - 48px));
    background: var(--panel); color: var(--text); box-shadow: var(--shadow-lg);
  }
  dialog::backdrop { background: rgba(15,17,21,.4); }
  dialog h2 { margin: 0 0 14px; font-size: 17px; font-weight: 600; }
  dialog p { margin: 0 0 8px; font-size: 14px; color: var(--text-soft); line-height: 1.5; overflow-wrap: anywhere; }
  dialog input[type="text"] {
    width: 100%; padding: 10px 12px; font-size: 14px; color: var(--text);
    border: 1px solid var(--line); border-radius: 8px; background: var(--bg); outline: none;
  }
  dialog input[type="text"]:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 18%, transparent); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .btn {
    padding: 8px 18px; border-radius: 999px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 500; background: transparent; color: var(--active-text);
  }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--active-text); color: var(--panel); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.danger { background: #dc2626; color: #fff; }
  .btn.danger:hover { filter: brightness(1.08); }

  /* ---- Toast ---- */
  .toast {
    position: fixed; left: 20px; bottom: 20px; z-index: 60;
    padding: 12px 20px; border-radius: 10px; font-size: 14px;
    background: #1f2937; color: #f9fafb; box-shadow: var(--shadow-lg);
    opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s;
    pointer-events: none; max-width: min(420px, calc(100vw - 40px));
  }
  [data-theme="dark"] .toast { background: #e5e7eb; color: #111827; }
  .toast.show { opacity: 1; transform: none; }

  /* ---- FAB (mobile) ---- */
  .fab {
    display: none; position: fixed; right: 18px; bottom: 18px; z-index: 40;
    width: 56px; height: 56px; border-radius: 16px; border: none; cursor: pointer;
    background: var(--panel); color: var(--active-text); box-shadow: var(--shadow-lg);
    align-items: center; justify-content: center;
  }

  @media (max-width: 820px) {
    aside { display: none; }
    main { margin: 0 10px 10px; }
    .chips { display: flex; }
    .fab { display: inline-flex; }
    .brand .brand-text { display: none; }
    header { padding: 10px 12px; gap: 8px; }
    .list-head { top: 96px; }
  }
  @media (max-width: 640px) {
    .list-head, .row { grid-template-columns: minmax(0,1fr) 96px 40px; }
    .col-type, .row-type { display: none; }
    .cards { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .card-thumb { height: 88px; }
  }
</style>
</head>
<body>
  <header>
    <a class="brand" href="/"><span class="mark" aria-hidden="true"></span><span class="brand-text"><b>Takos</b> <span data-i18n="office">Office</span></span></a>
    <div class="search">
      <span class="search-icon">${svg(ICON_SEARCH, 18)}</span>
      <input id="q" type="search" data-i18n-placeholder="searchPlaceholder" placeholder="${CATALOGS.en.searchPlaceholder}" autocomplete="off" />
    </div>
    <div class="header-actions">
      <button id="theme-toggle" class="icon-btn" type="button" data-i18n-label="toggleTheme" aria-label="${CATALOGS.en.toggleTheme}"></button>
    </div>
  </header>

  <div class="layout">
    <aside>
      <button type="button" class="new-btn" id="new-btn" aria-haspopup="menu" aria-expanded="false">
        ${svg(ICON_PLUS, 22)}<span data-i18n="newButton">${CATALOGS.en.newButton}</span>
      </button>
      <nav id="side-nav">${sidebarNav()}</nav>
    </aside>

    <main id="main">
      <div class="main-head">
        <h1 id="heading" data-i18n="headingHome">${CATALOGS.en.headingHome}</h1>
        <div class="view-toggle" role="group">
          <button type="button" class="seg" data-view="list" aria-pressed="true" data-i18n-label="viewList" aria-label="${CATALOGS.en.viewList}">${svg(ICON_LIST, 18)}</button>
          <button type="button" class="seg" data-view="grid" aria-pressed="false" data-i18n-label="viewGrid" aria-label="${CATALOGS.en.viewGrid}">${svg(ICON_GRID, 18)}</button>
        </div>
      </div>
      <div class="chips" id="chips">${filterChips()}</div>

      <div class="list-head" id="list-head">
        <button type="button" class="sortable" data-sort="title"><span data-i18n="colName">${CATALOGS.en.colName}</span><span class="sort-arrow" data-arrow="title"></span></button>
        <span class="col-type" data-i18n="colType">${CATALOGS.en.colType}</span>
        <button type="button" class="sortable" data-sort="updatedAt"><span data-i18n="colUpdated">${CATALOGS.en.colUpdated}</span><span class="sort-arrow" data-arrow="updatedAt">▼</span></button>
        <span></span>
      </div>
      <ul class="rows" id="rows"></ul>
      <div class="cards" id="cards" hidden></div>
      <div class="state" id="state" hidden></div>
    </main>
  </div>

  <button type="button" class="fab" id="fab" data-i18n-label="newButton" aria-label="${CATALOGS.en.newButton}">${svg(ICON_PLUS, 24)}</button>

  <div class="float-menu" id="new-menu" role="menu">${newMenuItems()}</div>

  <div class="float-menu" id="item-menu" role="menu">
    <button type="button" role="menuitem" class="menu-item" data-action="open"><span class="menu-icon">${svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 18)}</span><span data-i18n="menuOpen">${CATALOGS.en.menuOpen}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="open-tab"><span class="menu-icon">${svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 18)}</span><span data-i18n="menuOpenTab">${CATALOGS.en.menuOpenTab}</span></button>
    <button type="button" role="menuitem" class="menu-item" data-action="rename"><span class="menu-icon">${svg('<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', 18)}</span><span data-i18n="menuRename">${CATALOGS.en.menuRename}</span></button>
    <hr class="menu-sep" />
    <button type="button" role="menuitem" class="menu-item danger" data-action="delete"><span class="menu-icon">${svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 18)}</span><span data-i18n="menuDelete">${CATALOGS.en.menuDelete}</span></button>
  </div>

  <dialog id="rename-dialog">
    <h2 data-i18n="renameTitle">${CATALOGS.en.renameTitle}</h2>
    <form method="dialog" id="rename-form">
      <input type="text" id="rename-input" data-i18n-label="renameLabel" aria-label="${CATALOGS.en.renameLabel}" />
      <div class="dialog-actions">
        <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
        <button type="submit" class="btn primary" data-i18n="save">${CATALOGS.en.save}</button>
      </div>
    </form>
  </dialog>

  <dialog id="delete-dialog">
    <h2 data-i18n="deleteTitle">${CATALOGS.en.deleteTitle}</h2>
    <p id="delete-body"></p>
    <div class="dialog-actions">
      <button type="button" class="btn" data-close data-i18n="cancel">${CATALOGS.en.cancel}</button>
      <button type="button" class="btn danger" id="delete-confirm" data-i18n="deleteConfirm">${CATALOGS.en.deleteConfirm}</button>
    </div>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(function () {
  "use strict";
  var I18N = ${JSON.stringify(CATALOGS)};
  var APP_META = ${JSON.stringify(appMeta)};

  // ---- Language (shared takos-lang key, same detection as the editors) ----
  var lang = "en";
  try {
    var storedLang = localStorage.getItem("takos-lang");
    if (storedLang === "ja" || storedLang === "en") lang = storedLang;
    else lang = ((navigator.language || "").toLowerCase().indexOf("ja") === 0) ? "ja" : "en";
  } catch (e) { /* keep en */ }
  function t(key, params) {
    var msg = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (params) {
      Object.keys(params).forEach(function (p) {
        msg = msg.split("{" + p + "}").join(String(params[p]));
      });
    }
    return msg;
  }
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-label")));
    el.setAttribute("title", t(el.getAttribute("data-i18n-label")));
  });

  // ---- Workspace (space_id) propagation ----
  var params = new URLSearchParams(location.search);
  var spaceId = params.get("space_id") || params.get("spaceId") || "";
  function withSpace(path) {
    if (!spaceId) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "space_id=" + encodeURIComponent(spaceId);
  }
  document.querySelectorAll("a.brand").forEach(function (el) {
    el.setAttribute("href", withSpace(el.getAttribute("href")));
  });

  // ---- Theme toggle ----
  var SUN = ${JSON.stringify(svg(ICON_SUN, 18))};
  var MOON = ${JSON.stringify(svg(ICON_MOON, 18))};
  var themeBtn = document.getElementById("theme-toggle");
  function paintTheme() {
    themeBtn.innerHTML = document.documentElement.dataset.theme === "dark" ? SUN : MOON;
  }
  paintTheme();
  themeBtn.addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("takos-theme", next); } catch (e) { /* ignore */ }
    paintTheme();
  });

  // ---- State ----
  var state = {
    items: [],
    filter: "all",
    view: "list",
    sort: { key: "updatedAt", dir: "desc" },
    query: "",
    loading: true,
    failed: false,
  };
  try {
    var storedView = localStorage.getItem("takos-office-view");
    if (storedView === "grid" || storedView === "list") state.view = storedView;
  } catch (e) { /* keep list */ }

  var rowsEl = document.getElementById("rows");
  var cardsEl = document.getElementById("cards");
  var listHeadEl = document.getElementById("list-head");
  var stateEl = document.getElementById("state");
  var headingEl = document.getElementById("heading");
  var toastEl = document.getElementById("toast");
  var searchInput = document.getElementById("q");
  var currentVisible = [];

  // ---- Helpers ----
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  function relTime(s) {
    var time = Date.parse(s); if (!time) return "";
    var diff = (Date.now() - time) / 1000;
    if (diff < 60) return t("justNow");
    if (diff < 3600) return t("minAgo", { n: Math.floor(diff / 60) });
    if (diff < 86400) return t("hourAgo", { n: Math.floor(diff / 3600) });
    if (diff < 604800) return t("dayAgo", { n: Math.floor(diff / 86400) });
    return new Date(time).toLocaleDateString(lang === "ja" ? "ja-JP" : undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function typeLabel(app) {
    return app === "docs" ? t("typeDoc") : app === "slide" ? t("typeSlide") : t("typeSheet");
  }
  function typeIcon(app, size) {
    var meta = APP_META[app];
    if (!meta) return "";
    return '<span class="type-icon sm" style="background:' + meta.accent + '">' +
      '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + meta.icon + "</svg></span>";
  }
  function itemHref(item) {
    return withSpace("/" + item.app + "/" + encodeURIComponent(item.id));
  }
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 4000);
  }
  function redirectToLogin() {
    location.href = "/docs/api/auth/login?return_to=" + encodeURIComponent(location.pathname + location.search);
  }
  function jsonFetch(url, init) {
    return fetch(url, Object.assign({ credentials: "same-origin" }, init || {})).then(function (r) {
      if (r.status === 401) { redirectToLogin(); return new Promise(function () {}); }
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  // ---- Rendering ----
  function visibleItems() {
    var list = state.items.slice();
    if (state.filter !== "all") {
      list = list.filter(function (it) { return it.app === state.filter; });
    }
    var key = state.sort.key, dir = state.sort.dir === "asc" ? 1 : -1;
    list.sort(function (a, b) {
      if (key === "title") {
        return String(a.title).localeCompare(String(b.title), lang === "ja" ? "ja" : undefined) * dir;
      }
      return ((Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)) * dir;
    });
    return list;
  }
  function renderState(iconPaths, titleKey, bodyKey) {
    stateEl.innerHTML = '<div class="state-icon"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + iconPaths + "</svg></div>" +
      (titleKey ? "<h3>" + esc(t(titleKey)) + "</h3>" : "") +
      (bodyKey ? "<p>" + esc(t(bodyKey)) + "</p>" : "");
    stateEl.hidden = false;
  }
  function render() {
    var heading = state.query ? "headingResults"
      : state.filter === "docs" ? "headingDocs"
      : state.filter === "slide" ? "headingSlides"
      : state.filter === "sheet" ? "headingSheets"
      : "headingHome";
    headingEl.textContent = t(heading);

    document.querySelectorAll("[data-filter]").forEach(function (el) {
      el.setAttribute("aria-pressed", String(el.getAttribute("data-filter") === state.filter));
    });
    document.querySelectorAll("[data-view]").forEach(function (el) {
      el.setAttribute("aria-pressed", String(el.getAttribute("data-view") === state.view));
    });
    document.querySelectorAll(".sort-arrow").forEach(function (el) {
      var key = el.getAttribute("data-arrow");
      el.textContent = state.sort.key === key ? (state.sort.dir === "asc" ? "\\u25B2" : "\\u25BC") : "";
    });

    var items = visibleItems();
    var isList = state.view === "list";
    rowsEl.innerHTML = "";
    cardsEl.innerHTML = "";
    stateEl.hidden = true;
    currentVisible = items;

    if (state.loading || state.failed || !items.length) {
      listHeadEl.hidden = true; rowsEl.hidden = true; cardsEl.hidden = true;
      if (state.loading) {
        renderState('<circle cx="12" cy="12" r="9" stroke-dasharray="42 14"/>', "loading", null);
      } else if (state.failed) {
        renderState('<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>', "errLoad", null);
      } else if (state.query) {
        renderState('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', "emptySearchTitle", "emptySearchBody");
      } else {
        renderState('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>', "emptyTitle", "emptyBody");
      }
      return;
    }

    listHeadEl.hidden = !isList;
    rowsEl.hidden = !isList;
    cardsEl.hidden = isList;

    items.forEach(function (item, index) {
      var href = itemHref(item);
      var name = item.title || t("untitled");
      var kebab = '<button type="button" class="kebab" data-item="' + index + '" aria-haspopup="menu" aria-label="' + esc(t("itemMenu")) + '" title="' + esc(t("itemMenu")) + '">' +
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${ICON_KEBAB}</svg></button>';
      if (isList) {
        var li = document.createElement("li");
        li.className = "row";
        li.innerHTML =
          '<a class="row-link" href="' + href + '" aria-label="' + esc(name) + '"></a>' +
          '<span class="row-name">' + typeIcon(item.app, 15) + '<span class="name-text">' + esc(name) + "</span></span>" +
          '<span class="row-type">' + esc(typeLabel(item.app)) + "</span>" +
          '<span class="row-time">' + esc(relTime(item.updatedAt)) + "</span>" +
          kebab;
        rowsEl.appendChild(li);
      } else {
        var card = document.createElement("div");
        card.className = "card";
        card.style.setProperty("--card-accent", (APP_META[item.app] || {}).accent || "#2563eb");
        card.innerHTML =
          '<a class="row-link" href="' + href + '" aria-label="' + esc(name) + '"></a>' +
          '<div class="card-thumb"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (APP_META[item.app] || {}).icon + "</svg></div>" +
          '<div class="card-foot">' + typeIcon(item.app, 13) +
          '<div class="card-meta"><div class="card-name">' + esc(name) + '</div><div class="card-time">' + esc(relTime(item.updatedAt)) + "</div></div>" +
          kebab + "</div>";
        cardsEl.appendChild(card);
      }
    });
  }

  // ---- Data loading ----
  var loadSeq = 0;
  function load() {
    var seq = ++loadSeq;
    state.loading = true;
    state.failed = false;
    render();
    var url = state.query
      ? "/api/office/search?q=" + encodeURIComponent(state.query)
      : "/api/office/items";
    jsonFetch(withSpace(url)).then(function (data) {
      if (seq !== loadSeq) return;
      state.items = (data && data.items) || [];
      state.loading = false;
      render();
    }).catch(function () {
      if (seq !== loadSeq) return;
      state.loading = false;
      state.failed = true;
      render();
    });
  }

  // ---- Filters / view / sort ----
  document.querySelectorAll("[data-filter]").forEach(function (el) {
    el.addEventListener("click", function () {
      state.filter = el.getAttribute("data-filter");
      render();
    });
  });
  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function () {
      state.view = el.getAttribute("data-view");
      try { localStorage.setItem("takos-office-view", state.view); } catch (e) { /* ignore */ }
      render();
    });
  });
  document.querySelectorAll("[data-sort]").forEach(function (el) {
    el.addEventListener("click", function () {
      var key = el.getAttribute("data-sort");
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { key: key, dir: key === "title" ? "asc" : "desc" };
      }
      render();
    });
  });

  // ---- Search ----
  var searchTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var q = searchInput.value.trim();
      if (q === state.query) return;
      state.query = q;
      load();
    }, 200);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== searchInput &&
        !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // ---- Floating menus ----
  var newMenu = document.getElementById("new-menu");
  var itemMenu = document.getElementById("item-menu");
  var newBtn = document.getElementById("new-btn");
  var fab = document.getElementById("fab");
  var menuTarget = null; // item the open item-menu points at

  function closeMenus() {
    newMenu.classList.remove("open");
    itemMenu.classList.remove("open");
    newBtn.setAttribute("aria-expanded", "false");
  }
  function openMenuAt(menu, anchor) {
    closeMenus();
    menu.classList.add("open");
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var x = Math.min(r.left, window.innerWidth - mw - 8);
    var y = r.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    menu.style.left = Math.max(8, x) + "px";
    menu.style.top = y + "px";
    var first = menu.querySelector(".menu-item");
    if (first) first.focus();
  }
  newBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (newMenu.classList.contains("open")) { closeMenus(); return; }
    openMenuAt(newMenu, newBtn);
    newBtn.setAttribute("aria-expanded", "true");
  });
  fab.addEventListener("click", function (e) {
    e.stopPropagation();
    if (newMenu.classList.contains("open")) { closeMenus(); return; }
    openMenuAt(newMenu, fab);
  });
  document.addEventListener("click", function (e) {
    if (!newMenu.contains(e.target) && !itemMenu.contains(e.target)) closeMenus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeMenus();
  });
  window.addEventListener("resize", closeMenus);
  document.getElementById("main").addEventListener("scroll", closeMenus);

  document.addEventListener("click", function (e) {
    var kebab = e.target.closest ? e.target.closest(".kebab") : null;
    if (!kebab) return;
    e.preventDefault();
    e.stopPropagation();
    var item = currentVisible[Number(kebab.getAttribute("data-item"))];
    if (!item) return;
    openMenuAt(itemMenu, kebab);
    menuTarget = item;
  }, true);

  // ---- Create ----
  var creating = false;
  document.querySelectorAll("[data-new]").forEach(function (el) {
    el.addEventListener("click", function () {
      if (creating) return;
      creating = true;
      var app = el.getAttribute("data-new");
      closeMenus();
      var title = app === "docs" ? t("untitledDoc") : app === "slide" ? t("untitledSlide") : t("untitledSheet");
      jsonFetch(withSpace(APP_META[app].api), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title }),
      }).then(function (created) {
        location.href = withSpace("/" + app + "/" + encodeURIComponent(created.id));
      }).catch(function () {
        creating = false;
        toast(t("errCreate"));
      });
    });
  });

  // ---- Item actions (open / rename / delete) ----
  var renameDialog = document.getElementById("rename-dialog");
  var renameForm = document.getElementById("rename-form");
  var renameInput = document.getElementById("rename-input");
  var deleteDialog = document.getElementById("delete-dialog");
  var deleteBody = document.getElementById("delete-body");
  var deleteConfirm = document.getElementById("delete-confirm");
  var actionTarget = null;

  document.querySelectorAll("[data-close]").forEach(function (el) {
    el.addEventListener("click", function () {
      el.closest("dialog").close();
    });
  });

  itemMenu.querySelectorAll("[data-action]").forEach(function (el) {
    el.addEventListener("click", function () {
      var action = el.getAttribute("data-action");
      var item = menuTarget;
      closeMenus();
      if (!item) return;
      if (action === "open") { location.href = itemHref(item); return; }
      if (action === "open-tab") { window.open(itemHref(item), "_blank", "noopener"); return; }
      actionTarget = item;
      if (action === "rename") {
        renameInput.value = item.title || "";
        renameDialog.showModal();
        renameInput.select();
      } else if (action === "delete") {
        deleteBody.textContent = t("deleteBody", { name: item.title || t("untitled") });
        deleteDialog.showModal();
      }
    });
  });

  renameForm.addEventListener("submit", function () {
    var item = actionTarget;
    var title = renameInput.value.trim();
    if (!item || !title || title === item.title) return;
    jsonFetch(withSpace(APP_META[item.app].api + "/" + encodeURIComponent(item.id)), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title }),
    }).then(function () {
      state.items.forEach(function (it) {
        if (it.app === item.app && it.id === item.id) it.title = title;
      });
      render();
    }).catch(function () { toast(t("errRename")); });
  });

  deleteConfirm.addEventListener("click", function () {
    var item = actionTarget;
    deleteDialog.close();
    if (!item) return;
    jsonFetch(withSpace(APP_META[item.app].api + "/" + encodeURIComponent(item.id)), {
      method: "DELETE",
    }).then(function () {
      state.items = state.items.filter(function (it) {
        return !(it.app === item.app && it.id === item.id);
      });
      render();
    }).catch(function () { toast(t("errDelete")); });
  });

  // ---- Boot ----
  render();
  load();
})();
</script>
</body>
</html>`;
}
