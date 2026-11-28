import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { extractDocumentPreview } from "../docs/src/lib/document-preview.ts";
import { renderShellPage } from "../shell-page.ts";

const ROOT = join(import.meta.dir, "..");

describe("Wave 3 Tailwind shared source scanning", () => {
  test("all three editor stylesheets declare @source \"../../shared\" so OfficeDialog & ThemeToggle utilities are always compiled", () => {
    for (const rel of [
      "docs/src/styles.css",
      "slide/src/styles.css",
      "sheet/src/styles.css",
    ]) {
      const css = readFileSync(join(ROOT, rel), "utf8");
      expect(css).toContain('@source "../../shared";');
    }
  });
});

describe("Wave 3 extractDocumentPreview", () => {
  test("extracts text from TipTap JSON documents and truncates safely", () => {
    const json = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Executive Summary" }] },
        { type: "paragraph", content: [{ type: "text", text: "Hello world from Takos Docs." }] },
      ],
    });
    expect(extractDocumentPreview(json)).toBe(
      "Executive Summary Hello world from Takos Docs.",
    );
    expect(extractDocumentPreview(json, 20)).toBe("Executive Summary H…");
  });

  test("falls back to stripped plain text and handles empty input", () => {
    expect(extractDocumentPreview("")).toBe("");
    expect(extractDocumentPreview("   ")).toBe("");
    expect(extractDocumentPreview("<p>Plain <b>text</b> preview</p>")).toBe(
      "Plain text preview",
    );
    expect(extractDocumentPreview('{"type":"doc","content":[]}')).toBe("");
  });
});

describe("Wave 3 Office Shell search empty state, clear button, and SR app labels", () => {
  test("distinguishes empty search results from an empty workspace and exposes clear-search & sr-only labels", async () => {
    class MockEl {
      hidden = true;
      _innerHTML = "";
      _textContent = "";
      value = "";
      children: MockEl[] = [];
      handlers = new Map<string, (e?: unknown) => void>();
      focused = false;
      get innerHTML() {
        return this._innerHTML;
      }
      set innerHTML(v: string) {
        this._innerHTML = v;
      }
      get textContent() {
        return this._textContent;
      }
      set textContent(v: string) {
        this._textContent = v;
        this._innerHTML = v
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }
      addEventListener(name: string, fn: (e?: unknown) => void) {
        this.handlers.set(name, fn);
      }
      appendChild(child: MockEl) {
        this.children.push(child);
      }
      focus() {
        this.focused = true;
      }
      fire(name: string, event?: unknown) {
        this.handlers.get(name)?.(event);
      }
    }

    const nodes = new Map<string, MockEl>();
    for (const id of [
      "items",
      "loading",
      "empty",
      "clear-search",
      "load-error",
      "partial",
      "retry",
      "list-heading",
      "q",
      "theme-toggle",
      "lang-toggle",
      "app-nav",
    ]) {
      nodes.set(id, new MockEl());
    }

    const requests: { url: string; resolve: (r: Response) => void }[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const html = renderShellPage();
    expect(html).toContain(".sr-only");
    expect(html).toContain('id="clear-search"');
    expect(html).toContain("flex: 1");

    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    new Script(scripts.at(-1)![1]!).runInNewContext({
      document: {
        documentElement: { dataset: { theme: "light" }, lang: "en" },
        getElementById: (id: string) => nodes.get(id),
        querySelectorAll: () => [],
        createElement: () => new MockEl(),
      },
      location: { pathname: "/", search: "", href: "" },
      localStorage: { setItem() {} },
      URLSearchParams,
      fetch: (url: string) =>
        new Promise<Response>((resolve) => requests.push({ url, resolve })),
      setTimeout: (cb: () => void) => {
        timers.set(++nextTimer, cb);
        return nextTimer;
      },
      clearTimeout: (id: number) => timers.delete(id),
    });

    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    // Initial load: empty workspace shows workspace empty copy, no clear-search button.
    requests[0]!.resolve(Response.json({ items: [] }));
    await flush();
    expect(nodes.get("empty")!.hidden).toBe(false);
    expect(nodes.get("empty")!.textContent).toContain("Nothing here yet");
    expect(nodes.get("clear-search")!.hidden).toBe(true);

    // Search with no matches shows search-specific copy and clear-search button.
    nodes.get("q")!.value = "nonexistent";
    nodes.get("q")!.fire("input");
    for (const [id, cb] of [...timers]) {
      timers.delete(id);
      cb();
    }
    requests[1]!.resolve(Response.json({ items: [] }));
    await flush();
    expect(nodes.get("empty")!.hidden).toBe(false);
    expect(nodes.get("empty")!.textContent).toBe("No matching files found.");
    expect(nodes.get("clear-search")!.hidden).toBe(false);

    // Clicking clear-search clears query, focuses input, and reloads recent items.
    nodes.get("clear-search")!.fire("click");
    expect(nodes.get("q")!.value).toBe("");
    expect(nodes.get("q")!.focused).toBe(true);
    expect(requests[2]!.url).toBe("/api/office/items");
    requests[2]!.resolve(
      Response.json({
        items: [
          {
            app: "sheet",
            id: "s1",
            title: "Budget",
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    await flush();
    expect(nodes.get("items")!.children[0]!.innerHTML).toContain(
      '<span class="sr-only">Sheets: </span>',
    );
  });
});

describe("Wave 3 cross-app editor & modal regressions", () => {
  test("shared theme module synchronizes takos-theme across tabs via storage events", () => {
    const src = readFileSync(join(ROOT, "shared/lib/theme.ts"), "utf8");
    expect(src).toContain('addEventListener("storage"');
    expect(src).toContain("event.key !== KEY");
  });

  test("Sheets Toolbar includes default fontSize 13, binds filterQuery, and clears on Escape", () => {
    const toolbar = readFileSync(
      join(ROOT, "sheet/src/components/Toolbar.tsx"),
      "utf8",
    );
    expect(toolbar).toContain("baseFontSizes = [8, 9, 10, 11, 12, 13,");
    expect(toolbar).toContain("filterQuery?: string");
    expect(toolbar).toContain("setFilterInput");
    expect(toolbar).toContain('e.key === "Escape"');
  });

  test("Sheets EditorPage seeds editValue on load and sheet switch, SheetTabs exposes tablist/tab and options button, Grid exposes role=grid", () => {
    const editor = readFileSync(
      join(ROOT, "sheet/src/pages/EditorPage.tsx"),
      "utf8",
    );
    const tabs = readFileSync(
      join(ROOT, "sheet/src/components/SheetTabs.tsx"),
      "utf8",
    );
    const grid = readFileSync(
      join(ROOT, "sheet/src/components/Grid.tsx"),
      "utf8",
    );
    expect(editor).toContain("setEditValue(active?.cells[selectedCell()]?.value ?? \"\")");
    expect(editor).toContain("setEditValue(newSheet?.cells.A1?.value ?? \"\")");
    expect(editor).toContain("filterQuery={activeSheet()?.filter?.query ?? \"\"}");
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain("aria-selected=");
    expect(tabs).toContain("sheetActions");
    expect(grid).toContain('role="grid"');
  });

  test("Docs Toolbar uses reactive createEffect (no setInterval), exposes aria-pressed, widens Size select, and uses theme-aware dark color bar", () => {
    const toolbar = readFileSync(
      join(ROOT, "docs/src/components/Toolbar.tsx"),
      "utf8",
    );
    const findReplace = readFileSync(
      join(ROOT, "docs/src/components/FindReplace.tsx"),
      "utf8",
    );
    expect(toolbar).not.toContain("setInterval");
    expect(toolbar).toContain("tick()");
    expect(toolbar).toContain('aria-pressed={isActive("bold")}');
    expect(toolbar).toContain('style="min-width:5rem"');
    expect(toolbar).toContain('theme() === "dark"');
    expect(toolbar).toContain('e.key === "ArrowDown"');
    expect(findReplace).toContain('aria-live="polite"');
    expect(findReplace).toContain("restoreFocus");
  });

  test("Slides PresentPage exposes main landmark, sr-only h1, reactive title, IME guard, reduced-motion check, and 44px mobile controls", () => {
    const present = readFileSync(
      join(ROOT, "slide/src/pages/PresentPage.tsx"),
      "utf8",
    );
    expect(present).toContain("<main");
    expect(present).toContain('<h1 class="sr-only">');
    expect(present).toContain("document.title =");
    expect(present).toContain("isImeComposing(e)");
    expect(present).toContain("prefers-reduced-motion: reduce");
    expect(present).toContain("min-h-11 min-w-11");
  });

  test("all remaining in-app modals guard backdrop clicks against drag-release", () => {
    for (const rel of [
      "docs/src/components/ShortcutsHelp.tsx",
      "slide/src/components/ShortcutsHelp.tsx",
      "sheet/src/components/ShortcutsHelp.tsx",
      "slide/src/pages/PresentationListPage.tsx",
      "sheet/src/pages/SpreadsheetListPage.tsx",
      "slide/src/pages/EditorPage.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("onPointerDown");
      expect(src).toMatch(/PointerDownOnBackdrop|pointerDownOnBackdrop/);
    }
  });
});
