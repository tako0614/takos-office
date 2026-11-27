/**
 * The Office shell landing page served at `/`.
 *
 * A self-contained HTML page (no extra build target): cross-editor nav, a
 * cross-app search box, and a "recent across all apps" list driven by the
 * /api/office/* endpoints. Links preserve the current `space_id` query.
 */

interface AppDef {
  app: string;
  label: string;
  href: string;
  accent: string;
  desc: string;
  icon: string; // inline SVG path(s), drawn in a 24x24 viewBox
}

const APPS: AppDef[] = [
  {
    app: "docs",
    label: "Documents",
    href: "/docs",
    accent: "#2563eb",
    desc: "Write notes, docs and reports",
    icon:
      '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 9h1"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  },
  {
    app: "slide",
    label: "Slides",
    href: "/slide",
    accent: "#c2410c",
    desc: "Build and present decks",
    icon:
      '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4"/><path d="M8 20h8"/>',
  },
  {
    app: "sheet",
    label: "Sheets",
    href: "/sheet",
    accent: "#15803d",
    desc: "Crunch numbers in a spreadsheet",
    icon:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  },
];

function appCard(a: AppDef): string {
  return `
    <div class="card" data-accent="${a.app}" style="--accent:${a.accent}">
      <a class="card-open-link" data-app="${a.app}" href="${a.href}">
        <span class="card-icon">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${a.icon}</svg>
        </span>
        <span class="card-body">
          <span class="card-label" data-i18n="app.${a.app}.label">${a.label}</span>
          <span class="card-desc" data-i18n="app.${a.app}.desc">${a.desc}</span>
        </span>
      </a>
      <a class="card-new" data-app-new="${a.app}" data-i18n="newAction" data-i18n-title="app.${a.app}.newTitle" href="${a.href}?new=1" title="New ${a.label.replace(/s$/, "")}">+ New</a>
    </div>`;
}

export function renderShellPage(): string {
  const navLinks = APPS.map(
    (a) => `<a href="${a.href}" data-app-link="${a.app}" data-i18n="app.${a.app}.label">${a.label}</a>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Takos Office</title>
<!-- Home-screen install: one suite-wide manifest served at the Worker root. -->
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#161a22" media="(prefers-color-scheme: dark)" />
<script>
  // Apply shared suite theme and language before paint (no flash). Same keys as the editors.
  (function () {
    try {
      var s = localStorage.getItem("takos-theme");
      var dark = s ? s === "dark"
        : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    } catch (e) { document.documentElement.dataset.theme = "light"; }
    try {
      var l = localStorage.getItem("takos-language") || localStorage.getItem("takos-lang");
      if (l !== "ja" && l !== "en") {
        l = (navigator.language || "").toLowerCase().indexOf("ja") === 0 ? "ja" : "en";
      }
      document.documentElement.lang = l;
    } catch (e) { document.documentElement.lang = "en"; }
  })();
</script>
<style>
  :root { color-scheme: light; }
  [data-theme="dark"] { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f7f8fa; color: #1f2937;
  }
  [data-theme="dark"] body { background: #0f1115; color: #e5e7eb; }
  a { color: inherit; }
  .skip-link {
    position: absolute; left: -9999px; top: 8px; z-index: 100;
    padding: 10px 14px; border-radius: 8px; background: #2563eb; color: #fff;
    font-size: 14px; font-weight: 600; text-decoration: none;
  }
  .skip-link:focus { left: 12px; outline: 2px solid #fff; outline-offset: 2px; }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 24px; background: #fff; border-bottom: 1px solid #e5e7eb;
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 17px; text-decoration: none; }
  .brand .mark { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg,#2563eb,#16a34a); }
  .brand b { color: #111827; } .brand span { color: #52525b; font-weight: 500; }
  .brand:focus-visible, header nav a:focus-visible, .theme-toggle:focus-visible, .lang-toggle:focus-visible, .card-new:focus-visible, li.item a:focus-visible, #retry:focus-visible {
    outline: 2px solid #2563eb; outline-offset: 2px;
  }
  .spacer { flex: 1; }
  header nav { display: flex; gap: 4px; }
  header nav a {
    color: #4b5563; text-decoration: none; font-size: 14px; padding: 6px 10px; border-radius: 8px;
  }
  header nav a:hover { background: #f3f4f6; color: #111827; }
  .header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 24px 64px; }
  main:focus { outline: none; }
  .hero { margin-bottom: 26px; }
  .hero h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -.01em; }
  .hero p { margin: 0; color: #4b5563; font-size: 15px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 22px 0 30px; }
  .card {
    display: flex; flex-direction: column; gap: 10px; padding: 16px;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
    transition: border-color .15s, box-shadow .15s, transform .1s;
  }
  .card:hover { border-color: var(--accent); box-shadow: 0 4px 16px rgba(0,0,0,.07); transform: translateY(-1px); }
  .card-open-link { display: flex; align-items: flex-start; gap: 12px; text-decoration: none; color: inherit; }
  .card-open-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 8px; }
  .card-icon {
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
    color: #fff; background: var(--accent);
  }
  .card-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .card-label { font-weight: 600; font-size: 15px; }
  .card-desc { font-size: 12.5px; color: #4b5563; line-height: 1.35; }
  .card-new {
    align-self: flex-start; font-size: 12px; color: var(--accent); text-decoration: none;
    padding: 5px 12px; border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 999px; transition: background .12s, color .12s, border-color .12s;
  }
  .card-new:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
  [data-theme="dark"] .card-desc { color: #a1a1aa; }
  [data-theme="dark"] .card[data-accent="docs"] .card-new { color: #93c5fd; border-color: rgba(147,197,253,.4); }
  [data-theme="dark"] .card[data-accent="slide"] .card-new { color: #fdba74; border-color: rgba(253,186,116,.4); }
  [data-theme="dark"] .card[data-accent="sheet"] .card-new { color: #86efac; border-color: rgba(134,239,172,.4); }
  [data-theme="dark"] .card .card-new:hover { color: #fff; }
  .search { position: relative; margin-bottom: 8px; }
  .search svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #6b7280; pointer-events: none; }
  .search input {
    width: 100%; padding: 12px 14px 12px 40px; font-size: 15px;
    border: 1px solid #d1d5db; border-radius: 10px; outline: none; background: #fff; color: #111827;
  }
  .search input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #52525b; margin: 24px 0 6px; font-weight: 600; }
  ul.items { list-style: none; margin: 0; padding: 0; }
  li.item a {
    display: flex; align-items: center; gap: 12px; padding: 11px 8px;
    text-decoration: none; color: inherit; border-radius: 8px;
  }
  li.item a:hover { background: #eef2f7; }
  .badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; border-radius: 7px; color: #fff; flex-shrink: 0;
  }
  .badge.docs { background: #2563eb; } .badge.slide { background: #c2410c; } .badge.sheet { background: #15803d; }
  .item-title { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-time { font-size: 12px; color: #52525b; flex-shrink: 0; }
  .empty, .loading {
    color: #52525b; font-size: 14px; padding: 28px 8px; text-align: center;
  }
  #load-error, #partial {
    margin: 12px 0; padding: 12px 14px; border-radius: 10px; font-size: 14px; line-height: 1.45;
  }
  #load-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  #partial { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
  #retry {
    margin-top: 4px; padding: 8px 14px; font-size: 13px; font-weight: 500;
    border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; cursor: pointer;
  }
  #retry:hover { background: #f3f4f6; }
  .theme-toggle, .lang-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    height: 34px; border-radius: 8px; border: 1px solid #e5e7eb;
    background: #fff; color: #374151; cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .theme-toggle { width: 34px; }
  .lang-toggle { min-width: 44px; padding: 0 10px; }
  .theme-toggle:hover, .lang-toggle:hover { background: #f3f4f6; color: #111827; }
  /* Dark theme */
  [data-theme="dark"] header { background: #161a22; border-bottom-color: #262b36; }
  [data-theme="dark"] .brand b { color: #f3f4f6; }
  [data-theme="dark"] .brand span { color: #a1a1aa; }
  [data-theme="dark"] header nav a { color: #a1a1aa; }
  [data-theme="dark"] header nav a:hover { background: #20262f; color: #f3f4f6; }
  [data-theme="dark"] .theme-toggle, [data-theme="dark"] .lang-toggle { background: #1b2029; border-color: #2c323d; color: #d4d4d8; }
  [data-theme="dark"] .theme-toggle:hover, [data-theme="dark"] .lang-toggle:hover { background: #20262f; color: #f3f4f6; }
  [data-theme="dark"] .hero p, [data-theme="dark"] .card-desc { color: #a1a1aa; }
  [data-theme="dark"] .card { background: #161a22; border-color: #262b36; }
  [data-theme="dark"] .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.4); }
  [data-theme="dark"] .search input { background: #161a22; border-color: #2c323d; color: #e5e7eb; }
  [data-theme="dark"] li.item a:hover { background: #20262f; }
  [data-theme="dark"] .item-time, [data-theme="dark"] h2, [data-theme="dark"] .empty, [data-theme="dark"] .loading { color: #a1a1aa; }
  [data-theme="dark"] #load-error { background: rgba(127,29,29,.25); border-color: rgba(248,113,113,.4); color: #fecaca; }
  [data-theme="dark"] #partial { background: rgba(120,53,15,.25); border-color: rgba(251,191,36,.4); color: #fde68a; }
  [data-theme="dark"] #retry { background: #1b2029; border-color: #374151; color: #f3f4f6; }
  [data-theme="dark"] #retry:hover { background: #262e3a; }
  @media (max-width: 640px) {
    .cards { grid-template-columns: 1fr; }
    header { flex-wrap: wrap; gap: 8px 12px; padding: 12px 16px; }
    .brand { flex: 1; min-height: 44px; }
    header .spacer { display: none; }
    header nav { order: 1; flex: 0 0 100%; }
    header nav a {
      display: flex; flex: 1; align-items: center; justify-content: center; min-height: 44px;
    }
    .theme-toggle { width: 44px; height: 44px; }
    .lang-toggle { min-width: 44px; height: 44px; }
    .card-new { display: inline-flex; align-items: center; min-height: 36px; padding: 6px 14px; }
  }
</style>
</head>
<body>
  <a class="skip-link" href="#main" data-i18n="skipToMain">Skip to main content</a>
  <header>
    <a class="brand" href="/"><span class="mark" aria-hidden="true"></span><b>Takos</b> <span>Office</span></a>
    <span class="spacer"></span>
    <nav id="app-nav" aria-label="Takos Office apps">${navLinks}</nav>
    <div class="header-actions">
      <button id="lang-toggle" class="lang-toggle" type="button" aria-label="Language" title="Language">日本語</button>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme" title="Toggle theme"></button>
    </div>
  </header>
  <main id="main" tabindex="-1">
    <div class="hero">
      <h1 data-i18n="heroTitle">Your Workspace</h1>
      <p data-i18n="heroDesc">Documents, slides and spreadsheets — all in one place.</p>
    </div>
    <div class="cards">${APPS.map(appCard).join("")}</div>
    <div class="search">
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="q" type="search" aria-label="Search across Documents, Slides and Sheets" placeholder="Search across Documents, Slides and Sheets…" autocomplete="off" />
    </div>
    <h2 id="list-heading">Recent</h2>
    <ul class="items" id="items"></ul>
    <div class="loading" id="loading" role="status" aria-live="polite" data-i18n="loading">Loading…</div>
    <div class="empty" id="empty" hidden data-i18n="empty">Nothing here yet — open an app above to get started.</div>
    <div id="load-error" role="alert" hidden data-i18n="loadError">Couldn't load your files. Try again.</div>
    <div id="partial" role="status" hidden data-i18n="partial">Some apps couldn't be loaded. Results may be incomplete.</div>
    <button id="retry" type="button" hidden data-i18n="retry">Try again</button>
  </main>
<script>
(function () {
  var I18N = {
    en: {
      pageTitle: "Takos Office",
      skipToMain: "Skip to main content",
      navLabel: "Takos Office apps",
      heroTitle: "Your Workspace",
      heroDesc: "Documents, slides and spreadsheets — all in one place.",
      searchLabel: "Search across Documents, Slides and Sheets",
      searchPlaceholder: "Search across Documents, Slides and Sheets…",
      recent: "Recent",
      results: "Results",
      loading: "Loading…",
      empty: "Nothing here yet — open an app above to get started.",
      loadError: "Couldn't load your files. Try again.",
      partial: "Some apps couldn't be loaded. Results may be incomplete.",
      retry: "Try again",
      newAction: "+ New",
      toggleTheme: "Toggle theme",
      switchLanguage: "Switch to Japanese",
      langButton: "日本語",
      justNow: "just now",
      minAgo: "m ago",
      hourAgo: "h ago",
      dayAgo: "d ago",
      "app.docs.label": "Documents",
      "app.docs.desc": "Write notes, docs and reports",
      "app.docs.newTitle": "New Document",
      "app.slide.label": "Slides",
      "app.slide.desc": "Build and present decks",
      "app.slide.newTitle": "New Slide",
      "app.sheet.label": "Sheets",
      "app.sheet.desc": "Crunch numbers in a spreadsheet",
      "app.sheet.newTitle": "New Sheet",
    },
    ja: {
      pageTitle: "Takos Office",
      skipToMain: "メインコンテンツへスキップ",
      navLabel: "Takos Office アプリ",
      heroTitle: "ワークスペース",
      heroDesc: "ドキュメント・スライド・スプレッドシートをひとまとめに。",
      searchLabel: "ドキュメント・スライド・シートを横断検索",
      searchPlaceholder: "ドキュメント・スライド・シートを検索…",
      recent: "最近のファイル",
      results: "検索結果",
      loading: "読み込み中…",
      empty: "まだファイルはありません。上のアプリから作成してください。",
      loadError: "ファイルを読み込めませんでした。もう一度お試しください。",
      partial: "一部のアプリを読み込めませんでした。結果が不完全な場合があります。",
      retry: "再試行",
      newAction: "+ 新規",
      toggleTheme: "テーマを切り替え",
      switchLanguage: "英語に切り替え",
      langButton: "EN",
      justNow: "たった今",
      minAgo: "分前",
      hourAgo: "時間前",
      dayAgo: "日前",
      "app.docs.label": "ドキュメント",
      "app.docs.desc": "メモ・文書・レポートを作成",
      "app.docs.newTitle": "新しいドキュメント",
      "app.slide.label": "スライド",
      "app.slide.desc": "プレゼンテーションを作成・発表",
      "app.slide.newTitle": "新しいスライド",
      "app.sheet.label": "シート",
      "app.sheet.desc": "表計算やデータ整理を行う",
      "app.sheet.newTitle": "新しいシート",
    },
  };

  var currentLang = document.documentElement.lang === "ja" ? "ja" : "en";
  var currentHeadingKey = "recent";
  var lastData = null;
  function tr(key) { return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key; }

  var params = new URLSearchParams(location.search);
  var spaceId = params.get("space_id") || params.get("spaceId") || "";
  function withSpace(path) {
    if (!spaceId) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "space_id=" + encodeURIComponent(spaceId);
  }
  document.querySelectorAll("[data-app], [data-app-new], [data-app-link], a.brand").forEach(function (el) {
    el.setAttribute("href", withSpace(el.getAttribute("href")));
  });

  // Theme toggle (sun in dark, moon in light) — persists to the shared key.
  var SUN = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var toggleBtn = document.getElementById("theme-toggle");
  var langBtn = document.getElementById("lang-toggle");
  var navEl = document.getElementById("app-nav");
  function paintToggle() {
    toggleBtn.innerHTML = document.documentElement.dataset.theme === "dark" ? SUN : MOON;
  }
  paintToggle();
  toggleBtn.addEventListener("click", function () {
    var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("takos-theme", next); } catch (e) { /* ignore */ }
    paintToggle();
  });

  var itemsEl = document.getElementById("items");
  var loadingEl = document.getElementById("loading");
  var emptyEl = document.getElementById("empty");
  var errorEl = document.getElementById("load-error");
  var partialEl = document.getElementById("partial");
  var retryEl = document.getElementById("retry");
  var loadSequence = 0;
  var headingEl = document.getElementById("list-heading");
  var input = document.getElementById("q");

  function setAttr(el, k, v) { if (el && typeof el.setAttribute === "function") el.setAttribute(k, v); }

  function applyLanguage(lang, persist) {
    currentLang = lang === "ja" ? "ja" : "en";
    if (document.documentElement) document.documentElement.lang = currentLang;
    document.title = tr("pageTitle");
    if (persist) {
      try {
        localStorage.setItem("takos-language", currentLang);
        localStorage.setItem("takos-lang", currentLang);
      } catch (e) { /* ignore */ }
    }
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = tr(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      setAttr(el, "title", tr(el.getAttribute("data-i18n-title")));
    });
    setAttr(navEl, "aria-label", tr("navLabel"));
    setAttr(input, "aria-label", tr("searchLabel"));
    setAttr(input, "placeholder", tr("searchPlaceholder"));
    setAttr(toggleBtn, "aria-label", tr("toggleTheme"));
    setAttr(toggleBtn, "title", tr("toggleTheme"));
    if (langBtn) {
      langBtn.textContent = tr("langButton");
      setAttr(langBtn, "aria-label", tr("switchLanguage"));
      setAttr(langBtn, "title", tr("switchLanguage"));
    }
    headingEl.textContent = tr(currentHeadingKey);
    if (lastData) render(lastData);
  }

  if (langBtn) {
    langBtn.addEventListener("click", function () {
      applyLanguage(currentLang === "ja" ? "en" : "ja", true);
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", function (e) {
      if ((e.key === "takos-language" || e.key === "takos-lang") && (e.newValue === "ja" || e.newValue === "en")) {
        applyLanguage(e.newValue, false);
      } else if (e.key === "takos-theme" && (e.newValue === "light" || e.newValue === "dark")) {
        document.documentElement.dataset.theme = e.newValue;
        paintToggle();
      }
    });
  }

  function relTime(s) {
    var t = Date.parse(s); if (!t) return "";
    var diff = (Date.now() - t) / 1000;
    if (diff < 60) return tr("justNow");
    if (diff < 3600) return Math.floor(diff / 60) + tr("minAgo");
    if (diff < 86400) return Math.floor(diff / 3600) + tr("hourAgo");
    if (diff < 604800) return Math.floor(diff / 86400) + tr("dayAgo");
    return new Date(t).toLocaleDateString(currentLang === "ja" ? "ja-JP" : "en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  var ICON = {
    docs: '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg>',
    slide: '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>',
    sheet: '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>',
  };

  function render(data) {
    lastData = data;
    var items = data.items;
    if (!Array.isArray(items)) throw new Error("Invalid files response");
    var incomplete = Array.isArray(data.unavailableApps) && data.unavailableApps.length > 0;
    partialEl.hidden = !incomplete;
    retryEl.hidden = !incomplete;
    loadingEl.hidden = true;
    itemsEl.innerHTML = "";
    if (!items.length) { emptyEl.hidden = incomplete; return; }
    emptyEl.hidden = true;
    items.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "item";
      li.innerHTML = '<a href="' + withSpace("/" + it.app + "/" + encodeURIComponent(it.id)) + '">' +
        '<span class="badge ' + it.app + '">' + (ICON[it.app] || "") + '</span>' +
        '<span class="item-title">' + esc(it.title) + '</span>' +
        '<span class="item-time">' + relTime(it.updatedAt) + '</span></a>';
      itemsEl.appendChild(li);
    });
  }

  function load(url, headingKey) {
    var sequence = ++loadSequence;
    currentHeadingKey = headingKey;
    lastData = null;
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    errorEl.hidden = true;
    partialEl.hidden = true;
    retryEl.hidden = true;
    itemsEl.innerHTML = "";
    headingEl.textContent = tr(headingKey);
    fetch(withSpace(url), { credentials: "same-origin" }).then(function (r) {
      if (sequence !== loadSequence) return null;
      if (r.status === 401) {
        location.href = "/docs/api/auth/login?return_to=" + encodeURIComponent(location.pathname + location.search);
        return null;
      }
      if (!r.ok) throw new Error("Files unavailable");
      return r.json();
    }).then(function (data) {
      if (sequence === loadSequence && data) render(data);
    }).catch(function () {
      if (sequence !== loadSequence) return;
      loadingEl.hidden = true;
      emptyEl.hidden = true;
      errorEl.hidden = false;
      retryEl.hidden = false;
    });
  }

  var timer;
  function loadCurrent() {
    clearTimeout(timer);
    var q = input.value.trim();
    if (!q) load("/api/office/items", "recent");
    else load("/api/office/search?q=" + encodeURIComponent(q), "results");
  }
  input.addEventListener("input", function () {
    // Retire the previous query immediately, including the debounce window.
    ++loadSequence;
    clearTimeout(timer);
    timer = setTimeout(loadCurrent, 200);
  });
  retryEl.addEventListener("click", loadCurrent);

  applyLanguage(currentLang, false);
  load("/api/office/items", "recent");
})();
</script>
</body>
</html>`;
}
