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
    accent: "#ea580c",
    desc: "Build and present decks",
    icon:
      '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4"/><path d="M8 20h8"/>',
  },
  {
    app: "sheet",
    label: "Sheets",
    href: "/sheet",
    accent: "#16a34a",
    desc: "Crunch numbers in a spreadsheet",
    icon:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  },
];

function appCard(a: AppDef): string {
  return `
    <a class="card" data-app="${a.app}" href="${a.href}" style="--accent:${a.accent}">
      <span class="card-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${a.icon}</svg>
      </span>
      <span class="card-body">
        <span class="card-label">${a.label}</span>
        <span class="card-desc">${a.desc}</span>
      </span>
      <span class="card-open" aria-hidden="true">→</span>
    </a>`;
}

export function renderShellPage(): string {
  const navLinks = APPS.map(
    (a) => `<a href="${a.href}" data-app-link="${a.app}">${a.label}</a>`,
  ).join("");

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
  :root { color-scheme: light; }
  [data-theme="dark"] { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f7f8fa; color: #1f2937;
  }
  [data-theme="dark"] body { background: #0f1115; color: #e5e7eb; }
  a { color: inherit; }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 24px; background: #fff; border-bottom: 1px solid #e5e7eb;
    position: sticky; top: 0; z-index: 10;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 17px; text-decoration: none; }
  .brand .mark { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg,#2563eb,#16a34a); }
  .brand b { color: #111827; } .brand span { color: #6b7280; font-weight: 500; }
  .spacer { flex: 1; }
  header nav { display: flex; gap: 4px; }
  header nav a {
    color: #4b5563; text-decoration: none; font-size: 14px; padding: 6px 10px; border-radius: 8px;
  }
  header nav a:hover { background: #f3f4f6; color: #111827; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 24px 64px; }
  .hero { margin-bottom: 26px; }
  .hero h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -.01em; }
  .hero p { margin: 0; color: #6b7280; font-size: 15px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin: 22px 0 30px; }
  .card {
    display: flex; align-items: flex-start; gap: 12px; padding: 18px;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
    text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s, transform .1s;
  }
  .card:hover { border-color: var(--accent); box-shadow: 0 4px 16px rgba(0,0,0,.07); transform: translateY(-1px); }
  .card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .card-icon {
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
    color: #fff; background: var(--accent);
  }
  .card-body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .card-label { font-weight: 600; font-size: 15px; }
  .card-desc { font-size: 12.5px; color: #6b7280; line-height: 1.35; }
  .card-open { color: var(--accent); font-size: 16px; opacity: 0; transition: opacity .15s; }
  .card:hover .card-open { opacity: 1; }
  .search { position: relative; margin-bottom: 8px; }
  .search svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #9ca3af; }
  .search input {
    width: 100%; padding: 12px 14px 12px 40px; font-size: 15px;
    border: 1px solid #d1d5db; border-radius: 10px; outline: none; background: #fff;
  }
  .search input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin: 24px 0 6px; font-weight: 600; }
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
  .badge.docs { background: #2563eb; } .badge.slide { background: #ea580c; } .badge.sheet { background: #16a34a; }
  .item-title { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-time { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
  .empty, .loading {
    color: #9ca3af; font-size: 14px; padding: 28px 8px; text-align: center;
  }
  .theme-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; border-radius: 8px; border: 1px solid #e5e7eb;
    background: #fff; color: #4b5563; cursor: pointer;
  }
  .theme-toggle:hover { background: #f3f4f6; color: #111827; }
  /* Dark theme */
  [data-theme="dark"] header { background: #161a22; border-bottom-color: #262b36; }
  [data-theme="dark"] .brand b { color: #f3f4f6; }
  [data-theme="dark"] header nav a { color: #9ca3af; }
  [data-theme="dark"] header nav a:hover { background: #20262f; color: #f3f4f6; }
  [data-theme="dark"] .theme-toggle { background: #1b2029; border-color: #2c323d; color: #9ca3af; }
  [data-theme="dark"] .theme-toggle:hover { background: #20262f; color: #f3f4f6; }
  [data-theme="dark"] .hero p, [data-theme="dark"] .card-desc { color: #9ca3af; }
  [data-theme="dark"] .card { background: #161a22; border-color: #262b36; }
  [data-theme="dark"] .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.4); }
  [data-theme="dark"] .search input { background: #161a22; border-color: #2c323d; color: #e5e7eb; }
  [data-theme="dark"] li.item a:hover { background: #20262f; }
  [data-theme="dark"] .item-time, [data-theme="dark"] h2, [data-theme="dark"] .empty, [data-theme="dark"] .loading { color: #6b7280; }
  @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <header>
    <a class="brand" href="/"><span class="mark"></span><b>Takos</b> <span>Office</span></a>
    <span class="spacer"></span>
    <nav>${navLinks}</nav>
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme" title="Toggle theme"></button>
  </header>
  <main>
    <div class="hero">
      <h1>Your Workspace</h1>
      <p>Documents, slides and spreadsheets — all in one place.</p>
    </div>
    <div class="cards">${APPS.map(appCard).join("")}</div>
    <div class="search">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input id="q" type="search" placeholder="Search across Documents, Slides and Sheets…" autocomplete="off" />
    </div>
    <h2 id="list-heading">Recent</h2>
    <ul class="items" id="items"></ul>
    <div class="loading" id="loading">Loading…</div>
    <div class="empty" id="empty" hidden>Nothing here yet — open an app above to get started.</div>
  </main>
<script>
(function () {
  var params = new URLSearchParams(location.search);
  var spaceId = params.get("space_id") || params.get("spaceId") || "";
  function withSpace(path) {
    if (!spaceId) return path;
    return path + (path.indexOf("?") >= 0 ? "&" : "?") + "space_id=" + encodeURIComponent(spaceId);
  }
  document.querySelectorAll("[data-app], [data-app-link], a.brand").forEach(function (el) {
    el.setAttribute("href", withSpace(el.getAttribute("href")));
  });

  // Theme toggle (sun in dark, moon in light) — persists to the shared key.
  var SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var toggleBtn = document.getElementById("theme-toggle");
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
  var headingEl = document.getElementById("list-heading");
  var input = document.getElementById("q");

  function relTime(s) {
    var t = Date.parse(s); if (!t) return "";
    var diff = (Date.now() - t) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 604800) return Math.floor(diff / 86400) + "d ago";
    return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  var ICON = {
    docs: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg>',
    slide: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>',
    sheet: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 3v18"/></svg>',
  };

  function render(items) {
    loadingEl.hidden = true;
    itemsEl.innerHTML = "";
    if (!items || !items.length) { emptyEl.hidden = false; return; }
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

  function load(url, heading) {
    loadingEl.hidden = false;
    emptyEl.hidden = true;
    itemsEl.innerHTML = "";
    headingEl.textContent = heading;
    fetch(withSpace(url), { credentials: "same-origin" }).then(function (r) {
      if (r.status === 401) {
        location.href = "/docs/api/auth/login?return_to=" + encodeURIComponent(location.pathname + location.search);
        return null;
      }
      return r.ok ? r.json() : { items: [] };
    }).then(function (data) { if (data) render(data.items); })
      .catch(function () { loadingEl.hidden = true; emptyEl.hidden = false; });
  }

  var timer;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    var q = input.value.trim();
    timer = setTimeout(function () {
      if (!q) load("/api/office/items", "Recent");
      else load("/api/office/search?q=" + encodeURIComponent(q), "Results");
    }, 200);
  });

  load("/api/office/items", "Recent");
})();
</script>
</body>
</html>`;
}
