/**
 * The Office shell landing page served at `/`.
 *
 * A self-contained HTML page (no extra build target): cross-editor nav, a
 * cross-app search box, and a "recent across all apps" list driven by the
 * /api/office/* endpoints. Links preserve the current `space_id` query.
 */

const APPS: { app: string; label: string; href: string; accent: string }[] = [
  { app: "docs", label: "Documents", href: "/docs", accent: "#2563eb" },
  { app: "slide", label: "Slides", href: "/slide", accent: "#ea580c" },
  { app: "sheet", label: "Sheets", href: "/sheet", accent: "#16a34a" },
];

export function renderShellPage(): string {
  const navCards = APPS.map(
    (a) => `
      <a class="card" data-app="${a.app}" href="${a.href}" style="--accent:${a.accent}">
        <span class="card-dot"></span>
        <span class="card-label">${a.label}</span>
        <span class="card-new">Open ${a.label} &rarr;</span>
      </a>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Takos Office</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f7f8fa; color: #1f2937;
  }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 24px; background: #fff; border-bottom: 1px solid #e5e7eb;
  }
  .brand { font-weight: 600; font-size: 18px; }
  .brand b { color: #2563eb; }
  .spacer { flex: 1; }
  header nav a {
    color: #4b5563; text-decoration: none; font-size: 14px; padding: 6px 10px;
    border-radius: 8px;
  }
  header nav a:hover { background: #f3f4f6; color: #111827; }
  main { max-width: 880px; margin: 0 auto; padding: 28px 24px 64px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
  .card {
    display: flex; flex-direction: column; gap: 8px; padding: 18px;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
    text-decoration: none; color: inherit; transition: border-color .15s, box-shadow .15s;
  }
  .card:hover { border-color: var(--accent); box-shadow: 0 1px 8px rgba(0,0,0,.06); }
  .card-dot { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); }
  .card-label { font-weight: 600; font-size: 16px; }
  .card-new { font-size: 13px; color: #6b7280; }
  .search { position: relative; margin-bottom: 18px; }
  .search input {
    width: 100%; padding: 12px 14px; font-size: 15px;
    border: 1px solid #d1d5db; border-radius: 10px; outline: none; background: #fff;
  }
  .search input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; margin: 22px 0 10px; }
  ul.items { list-style: none; margin: 0; padding: 0; }
  li.item { border-bottom: 1px solid #eef0f2; }
  li.item a {
    display: flex; align-items: center; gap: 12px; padding: 11px 6px;
    text-decoration: none; color: inherit;
  }
  li.item a:hover { background: #f3f4f6; border-radius: 8px; }
  .badge {
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
    color: #fff; padding: 2px 8px; border-radius: 999px; flex-shrink: 0;
  }
  .badge.docs { background: #2563eb; } .badge.slide { background: #ea580c; } .badge.sheet { background: #16a34a; }
  .item-title { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-time { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
  .empty, .loading { color: #9ca3af; font-size: 14px; padding: 18px 6px; }
</style>
</head>
<body>
  <header>
    <span class="brand"><b>Takos</b> Office</span>
    <span class="spacer"></span>
    <nav>
      <a href="/docs" data-app-link="docs">Documents</a>
      <a href="/slide" data-app-link="slide">Slides</a>
      <a href="/sheet" data-app-link="sheet">Sheets</a>
    </nav>
  </header>
  <main>
    <div class="cards">${navCards}</div>
    <div class="search">
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
  // Keep the current Workspace selected when navigating into an editor.
  document.querySelectorAll("[data-app], [data-app-link]").forEach(function (el) {
    el.setAttribute("href", withSpace(el.getAttribute("href")));
  });

  var itemsEl = document.getElementById("items");
  var loadingEl = document.getElementById("loading");
  var emptyEl = document.getElementById("empty");
  var headingEl = document.getElementById("list-heading");
  var input = document.getElementById("q");

  function fmtTime(s) {
    var t = Date.parse(s); if (!t) return "";
    return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

  function render(items) {
    loadingEl.hidden = true;
    itemsEl.innerHTML = "";
    if (!items || !items.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    items.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "item";
      li.innerHTML = '<a href="' + withSpace("/" + it.app + "/" + encodeURIComponent(it.id)) + '">' +
        '<span class="badge ' + it.app + '">' + it.app + '</span>' +
        '<span class="item-title">' + esc(it.title) + '</span>' +
        '<span class="item-time">' + fmtTime(it.updatedAt) + '</span></a>';
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
      if (!q) { load("/api/office/items", "Recent"); }
      else { load("/api/office/search?q=" + encodeURIComponent(q), "Results"); }
    }, 200);
  });

  load("/api/office/items", "Recent");
})();
</script>
</body>
</html>`;
}
