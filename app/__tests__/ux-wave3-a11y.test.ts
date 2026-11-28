import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import { extractDocumentPreview } from "../docs/src/lib/document-preview.ts";
import {
  FontSizeTextStyle,
  parseFontSizeAttribute,
  renderFontSizeAttribute,
} from "../docs/src/lib/font-size-text-style.ts";
import {
  isInteractiveShortcutTarget,
  restoreFocus,
} from "../shared/lib/dialog-a11y.ts";
import { setTheme, theme } from "../shared/lib/theme.ts";
import { renderShellPage } from "../shell-page.ts";

const ROOT = join(import.meta.dir, "..");

describe("Wave 3 Tailwind shared source scanning", () => {
  test('all three editor stylesheets declare @source "../../shared" so OfficeDialog & ThemeToggle utilities are always compiled', () => {
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
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Executive Summary" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world from Takos Docs." }],
        },
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

describe("Wave 3 behavioral helpers: shortcut targeting, fontSize mark, focus restore, and theme sync", () => {
  test("isInteractiveShortcutTarget detects interactive native controls, ARIA roles, contentEditable, and nested descendants while allowing canvas/main/body", () => {
    const mk = (opts: {
      tagName?: string;
      role?: string | null;
      isContentEditable?: boolean;
      closestMatch?: boolean;
    }) =>
      ({
        tagName: opts.tagName ?? "DIV",
        isContentEditable: opts.isContentEditable ?? false,
        getAttribute: (attr: string) => (attr === "role" ? opts.role ?? null : null),
        closest: opts.closestMatch !== undefined
          ? () => (opts.closestMatch ? {} : null)
          : undefined,
      }) as unknown as EventTarget;

    expect(isInteractiveShortcutTarget(null)).toBe(false);
    expect(isInteractiveShortcutTarget(mk({ tagName: "BUTTON" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ tagName: "A" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ tagName: "INPUT" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ tagName: "SELECT" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ tagName: "SUMMARY" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ role: "button" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ role: "link" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ role: "menuitem" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ role: "tab" }))).toBe(true);
    expect(isInteractiveShortcutTarget(mk({ isContentEditable: true }))).toBe(true);
    // Nested icon SVG inside a button matches via closest(...)
    expect(
      isInteractiveShortcutTarget(mk({ tagName: "SVG", closestMatch: true })),
    ).toBe(true);

    // Canvas, main, body, and plain non-interactive wrappers are allowed
    expect(
      isInteractiveShortcutTarget(mk({ tagName: "CANVAS", closestMatch: false })),
    ).toBe(false);
    expect(
      isInteractiveShortcutTarget(mk({ tagName: "MAIN", closestMatch: false })),
    ).toBe(false);
    expect(
      isInteractiveShortcutTarget(mk({ tagName: "BODY", closestMatch: false })),
    ).toBe(false);
    expect(
      isInteractiveShortcutTarget(mk({ tagName: "DIV", closestMatch: false })),
    ).toBe(false);
  });

  test("FontSizeTextStyle validates, parses, and renders fontSize attributes safely", () => {
    expect(parseFontSizeAttribute("18pt")).toBe("18pt");
    expect(parseFontSizeAttribute(" 14.5px ")).toBe("14.5px");
    expect(parseFontSizeAttribute("16")).toBe("16");
    expect(parseFontSizeAttribute("")).toBeNull();
    expect(parseFontSizeAttribute(null)).toBeNull();
    expect(parseFontSizeAttribute("18pt; color: red")).toBeNull();
    expect(parseFontSizeAttribute("calc(10px)")).toBeNull();

    expect(renderFontSizeAttribute("18pt")).toEqual({
      style: "font-size: 18pt",
    });
    expect(renderFontSizeAttribute(null)).toEqual({});
    expect(renderFontSizeAttribute("bad; injection")).toEqual({});

    const addAttributes = FontSizeTextStyle.config.addAttributes;
    expect(typeof addAttributes).toBe("function");
    const attrs = addAttributes!.call({
      name: "textStyle",
      options: {},
      storage: {},
      parent: () => ({}),
    } as never) as Record<
      string,
      {
        default: unknown;
        parseHTML: (el: { style?: { fontSize?: string } }) => string | null;
        renderHTML: (a: Record<string, unknown>) => Record<string, string>;
      }
    >;
    expect(attrs.fontSize?.default).toBeNull();
    expect(attrs.fontSize?.parseHTML({ style: { fontSize: "24pt" } })).toBe(
      "24pt",
    );
    expect(attrs.fontSize?.parseHTML({ style: { fontSize: "invalid" } })).toBeNull();
    expect(attrs.fontSize?.renderHTML({ fontSize: "24pt" })).toEqual({
      style: "font-size: 24pt",
    });
    expect(attrs.fontSize?.renderHTML({ fontSize: null })).toEqual({});
  });

  test("restoreFocus returns focus to a connected opener and falls back to #main when disconnected or null", async () => {
    let focusedTarget = "";
    const opener = {
      isConnected: true,
      focus: () => {
        focusedTarget = "opener";
      },
    } as unknown as HTMLElement;
    const mainFallback = {
      isConnected: true,
      focus: () => {
        focusedTarget = "main";
      },
    } as unknown as HTMLElement;

    const prevDocument = globalThis.document;
    globalThis.document = {
      querySelector: (sel: string) => (sel === "#main" ? mainFallback : null),
    } as unknown as Document;

    try {
      // Simulates snapshotting previouslyFocused before clearing it prior to queueMicrotask.
      let previouslyFocused: HTMLElement | null = opener;
      const prev = previouslyFocused;
      previouslyFocused = null;
      queueMicrotask(() => restoreFocus(prev));
      await Promise.resolve();
      expect(focusedTarget).toBe("opener");

      // Disconnected opener falls back to #main.
      focusedTarget = "";
      restoreFocus({ isConnected: false, focus: () => { focusedTarget = "stale"; } } as unknown as HTMLElement);
      expect(focusedTarget).toBe("main");

      // Null opener falls back to #main.
      focusedTarget = "";
      restoreFocus(null);
      expect(focusedTarget).toBe("main");
    } finally {
      globalThis.document = prevDocument;
    }
  });

  test("shared theme module synchronizes takos-theme across tabs via storage events", () => {
    const prevDoc = globalThis.document;
    const prevStorage = globalThis.localStorage;
    const dataset: Record<string, string> = {};
    globalThis.document = {
      documentElement: { dataset },
    } as unknown as Document;
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
    } as unknown as Storage;

    try {
      setTheme("dark");
      expect(theme()).toBe("dark");
      expect(dataset.theme).toBe("dark");

      const storageEvent = Object.assign(new Event("storage"), {
        key: "takos-theme",
        newValue: "light",
      });
      globalThis.dispatchEvent(storageEvent);
      expect(theme()).toBe("light");
      expect(dataset.theme).toBe("light");

      // Unrelated keys and invalid values are ignored.
      globalThis.dispatchEvent(
        Object.assign(new Event("storage"), {
          key: "other-key",
          newValue: "dark",
        }),
      );
      expect(theme()).toBe("light");

      globalThis.dispatchEvent(
        Object.assign(new Event("storage"), {
          key: "takos-theme",
          newValue: "purple",
        }),
      );
      expect(theme()).toBe("light");
    } finally {
      globalThis.document = prevDoc;
      globalThis.localStorage = prevStorage;
    }
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

describe("Wave 3 cross-app editor & modal contracts", () => {
  test("FindReplace open effect tracks only props.open (uses untrack) and Docs ShortcutsHelp snapshots previouslyFocused", () => {
    const findReplace = readFileSync(
      join(ROOT, "docs/src/components/FindReplace.tsx"),
      "utf8",
    );
    const docsShortcuts = readFileSync(
      join(ROOT, "docs/src/components/ShortcutsHelp.tsx"),
      "utf8",
    );
    expect(findReplace).toContain("untrack");
    expect(findReplace).toContain('aria-live="polite"');
    expect(findReplace).toContain("restoreFocus");
    // Open effect must not call recompute(false) before the closing effect.
    const openEffectBlock = findReplace.slice(
      findReplace.indexOf("// Focus the find field when the panel opens"),
      findReplace.indexOf("// Clear highlights and restore focus"),
    );
    expect(openEffectBlock).toContain("untrack");
    expect(openEffectBlock).not.toContain("recompute(");

    expect(docsShortcuts).toContain("const prev = previouslyFocused;");
    expect(docsShortcuts).toContain("queueMicrotask(() => restoreFocus(prev));");
  });

  test("Slides EditorPage guards Enter-to-edit against interactive targets", () => {
    const slideEditor = readFileSync(
      join(ROOT, "slide/src/pages/EditorPage.tsx"),
      "utf8",
    );
    expect(slideEditor).toContain("!isInteractiveShortcutTarget(e.target)");
  });

  test("Sheets Grid uses valid role=region (not empty role=grid), SheetTabs isolates role=tablist with ArrowLeft/ArrowRight and trigger pointerdown guard", () => {
    const grid = readFileSync(
      join(ROOT, "sheet/src/components/Grid.tsx"),
      "utf8",
    );
    const tabs = readFileSync(
      join(ROOT, "sheet/src/components/SheetTabs.tsx"),
      "utf8",
    );
    expect(grid).toContain('role="region"');
    expect(grid).not.toContain('role="grid"');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain("ArrowLeft");
    expect(tabs).toContain("ArrowRight");
    expect(tabs).toContain("data-sheet-menu-trigger");
  });

  test("Docs Toolbar uses FontSizeTextStyle, reactive tick(), closes popups on Tab, and handles Escape on Link/Image bar containers", () => {
    const editor = readFileSync(
      join(ROOT, "docs/src/components/Editor.tsx"),
      "utf8",
    );
    const toolbar = readFileSync(
      join(ROOT, "docs/src/components/Toolbar.tsx"),
      "utf8",
    );
    expect(editor).toContain("FontSizeTextStyle");
    expect(toolbar).not.toContain("setInterval");
    expect(toolbar).toContain("tick()");
    expect(toolbar).toContain('e.key === "Tab"');
    expect(toolbar).toContain("removeEmptyTextStyle()");
  });

  test("all three library list pages restore focus to the search input on Clear search", () => {
    for (const rel of [
      "docs/src/pages/DocumentListPage.tsx",
      "slide/src/pages/PresentationListPage.tsx",
      "sheet/src/pages/SpreadsheetListPage.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("ref={searchInputRef}");
      expect(src).toContain("searchInputRef?.focus()");
    }
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
