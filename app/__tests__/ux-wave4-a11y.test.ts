import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeFixedPopupPosition,
  getNextColorPopupIndex,
  handlePortalPopupTab,
} from "../shared/lib/dialog-a11y.ts";
import { renderShellPage } from "../shell-page.ts";

const ROOT = join(import.meta.dir, "..");

describe("Wave 4 computeFixedPopupPosition viewport clamping", () => {
  test("positions left-aligned popups below the trigger and clamps inside narrow viewports", () => {
    expect(
      computeFixedPopupPosition(
        { left: 100, right: 140, bottom: 96 },
        194,
        1440,
        "left",
      ),
    ).toEqual({ left: 100, top: 100 });

    // Near right edge on 375px phone: clamps so popup stays 8px inside right edge.
    expect(
      computeFixedPopupPosition(
        { left: 320, right: 364, bottom: 112 },
        256,
        375,
        "left",
      ),
    ).toEqual({ left: 111, top: 116 });

    // Negative trigger left (scrolled off left edge): clamps to left margin.
    expect(
      computeFixedPopupPosition(
        { left: -24, right: 20, bottom: 90 },
        194,
        375,
        "left",
      ),
    ).toEqual({ left: 8, top: 94 });
  });

  test("positions right-aligned popups (e.g. Export menu) flush to trigger right edge and clamps on narrow screens", () => {
    expect(
      computeFixedPopupPosition(
        { left: 1300, right: 1420, bottom: 92 },
        180,
        1440,
        "right",
      ),
    ).toEqual({ left: 1240, top: 96 });

    expect(
      computeFixedPopupPosition(
        { left: 10, right: 54, bottom: 92 },
        180,
        375,
        "right",
      ),
    ).toEqual({ left: 8, top: 96 });
  });
});

describe("Wave 4 Shell 44px mobile touch targets", () => {
  test("Shell search input and mobile app card links enforce >= 44px height", () => {
    const html = renderShellPage();
    expect(html).toContain("min-height: 44px");
    expect(html).toContain(".card-open-link { min-height: 44px;");
  });
});

describe("Wave 4 Sheets virtualized WAI-ARIA grid and labeled CellEditor", () => {
  test("Grid exposes structured rowgroup, row, columnheader, rowheader, gridcell, counts, indices, and activedescendant", () => {
    const grid = readFileSync(join(ROOT, "sheet/src/components/Grid.tsx"), "utf8");
    const cellEditor = readFileSync(
      join(ROOT, "sheet/src/components/CellEditor.tsx"),
      "utf8",
    );

    expect(grid).toContain('role="grid"');
    expect(grid).toContain('role="rowgroup"');
    expect(grid).toContain('role="row"');
    expect(grid).toContain('role="columnheader"');
    expect(grid).toContain('role="rowheader"');
    expect(grid).toContain('role="gridcell"');
    expect(grid).toContain("aria-rowcount={TOTAL_ROWS + 1}");
    expect(grid).toContain("aria-colcount={TOTAL_COLS + 1}");
    expect(grid).toContain("aria-rowindex={1}");
    expect(grid).toContain("aria-rowindex={row + 2}");
    expect(grid).toContain("aria-colindex={col + 2}");
    expect(grid).toContain("aria-activedescendant=");
    expect(grid).toContain('aria-multiselectable="true"');
    expect(grid).toContain('ariaLabel={t("formulaInput", { cell: props.selectedCell })}');
    expect(grid).toContain("containerRef?.focus({ preventScroll: true })");
    expect(cellEditor).toContain("aria-label={props.ariaLabel}");
    expect(cellEditor).toContain("z-[15]");
    expect(cellEditor).not.toContain("z-20");
  });
});

describe("Wave 4 Slides PropertyPanel, SlidePanel, and editor landmarks", () => {
  test("PropertyPanel associates every label with a control via forId/id and guards horizontal overflow with min-w-0", () => {
    const panel = readFileSync(
      join(ROOT, "slide/src/components/PropertyPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("createUniqueId");
    expect(panel).toContain("for={props.forId}");
    expect(panel).toContain('props.compact ? "w-5" : "w-20"');
    expect(panel).toContain("min-w-0 flex-1");
    expect(panel).toContain("min-h-11 sm:min-h-7");
    expect(panel).toContain("focus-visible:ring-2 focus-visible:ring-blue-500");
  });

  test("SlidePanel gives mobile slide actions 44px touch targets outside the thumbnail", () => {
    const panel = readFileSync(
      join(ROOT, "slide/src/components/SlidePanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 sm:w-6 sm:h-6");
    expect(panel).toContain("min-h-11 sm:min-h-8");
  });

  test("Slides and Sheets editors expose semantic <header> landmarks with ThemeToggle and LanguageSwitcher", () => {
    for (const rel of [
      "slide/src/pages/EditorPage.tsx",
      "sheet/src/pages/EditorPage.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("<header");
      expect(src).toContain("<ThemeToggle");
      expect(src).toContain("<LanguageSwitcher");
    }
  });
});

describe("Wave 4 mobile single-row scrollable 44px toolbars & Portal popups", () => {
  test("Docs, Slides, and Sheets toolbars use single-row horizontal scroll on mobile with 44px touch targets", () => {
    for (const rel of [
      "docs/src/components/Toolbar.tsx",
      "slide/src/components/ShapeToolbar.tsx",
      "sheet/src/components/Toolbar.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain('role="toolbar"');
      expect(src).toContain("flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible");
      expect(src).toContain("min-h-11");
    }
  });

  test("Docs and Sheets toolbar dropdown popups render via Portal with clamped fixed coordinates, focus entry, arrow/grid nav, and bounded Tab restoration", () => {
    const docsToolbar = readFileSync(
      join(ROOT, "docs/src/components/Toolbar.tsx"),
      "utf8",
    );
    const sheetToolbar = readFileSync(
      join(ROOT, "sheet/src/components/Toolbar.tsx"),
      "utf8",
    );

    for (const src of [docsToolbar, sheetToolbar]) {
      expect(src).toContain("<Portal>");
      expect(src).toContain("computeFixedPopupPosition");
      expect(src).toContain('activePopup()?.querySelector<HTMLElement>("button")?.focus()');
      expect(src).toContain("getNextColorPopupIndex");
      expect(src).toContain("handlePortalPopupTab");
      expect(src).toContain("restoreFocus(opener)");
    }

    // Docs route-change effect closes all popups (including color pickers)
    expect(docsToolbar).toMatch(/void location\.search;[\s\S]*?closePopups\(\);/);
    // Export menu passes allowInternalTab = !isExport (false for menu, true for color pickers)
    expect(docsToolbar).toContain("handlePortalPopupTab(e, activePopup(), closeAndRestore, !isExport)");
    // Sheets restores focus to trigger after swatch/Reset activation
    expect(sheetToolbar).toContain("handlePortalPopupTab(e, activePopup(), closeAndRestore, true)");
    expect(sheetToolbar.match(/queueMicrotask\(\(\) => restoreFocus\(opener\)\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  test("getNextColorPopupIndex navigates 6-column Sheets and 8-column Docs color grids cleanly", () => {
    const sheetsOpts = { columns: 6, resetPosition: "last" as const };
    // 18 swatches (0..17) + Reset (18)
    expect(getNextColorPopupIndex("ArrowRight", 0, 19, sheetsOpts)).toBe(1);
    expect(getNextColorPopupIndex("ArrowRight", 18, 19, sheetsOpts)).toBe(0);
    expect(getNextColorPopupIndex("ArrowLeft", 0, 19, sheetsOpts)).toBe(18);
    expect(getNextColorPopupIndex("ArrowDown", 0, 19, sheetsOpts)).toBe(6);
    expect(getNextColorPopupIndex("ArrowDown", 14, 19, sheetsOpts)).toBe(18);
    expect(getNextColorPopupIndex("ArrowDown", 18, 19, sheetsOpts)).toBe(0);
    expect(getNextColorPopupIndex("ArrowUp", 18, 19, sheetsOpts)).toBe(12);
    expect(getNextColorPopupIndex("ArrowUp", 2, 19, sheetsOpts)).toBe(18);
    expect(getNextColorPopupIndex("Home", 10, 19, sheetsOpts)).toBe(0);
    expect(getNextColorPopupIndex("End", 2, 19, sheetsOpts)).toBe(18);
    expect(getNextColorPopupIndex("Enter", 2, 19, sheetsOpts)).toBeNull();

    const docsOpts = { columns: 8, resetPosition: "first" as const };
    // Reset (0) + 40 swatches (1..40)
    expect(getNextColorPopupIndex("ArrowDown", 0, 41, docsOpts)).toBe(1);
    expect(getNextColorPopupIndex("ArrowUp", 0, 41, docsOpts)).toBe(40);
    expect(getNextColorPopupIndex("ArrowDown", 1, 41, docsOpts)).toBe(9);
    expect(getNextColorPopupIndex("ArrowDown", 35, 41, docsOpts)).toBe(0);
    expect(getNextColorPopupIndex("ArrowUp", 3, 41, docsOpts)).toBe(0);
    expect(getNextColorPopupIndex("ArrowUp", 11, 41, docsOpts)).toBe(3);
    expect(getNextColorPopupIndex("ArrowLeft", 0, 41, docsOpts)).toBe(40);
    expect(getNextColorPopupIndex("ArrowRight", 40, 41, docsOpts)).toBe(0);
  });

  test("handlePortalPopupTab closes menus immediately and keeps Tab inside color pickers until boundaries", () => {
    const makeBtn = () => ({
      tagName: "BUTTON",
      tabIndex: 0,
      hasAttribute: () => false,
      closest: () => null,
    });
    const b0 = makeBtn();
    const b1 = makeBtn();
    const b2 = makeBtn();
    const popup = {
      querySelectorAll: () => [b0, b1, b2],
    } as unknown as HTMLElement;

    const prevDoc = (globalThis as { document?: unknown }).document;
    try {
      // Export menu (allowInternalTab = false): Tab immediately closes & prevents default
      let closed = 0;
      let prevented = 0;
      (globalThis as { document?: unknown }).document = { activeElement: b1 };
      handlePortalPopupTab(
        { key: "Tab", shiftKey: false, preventDefault: () => { prevented++; } },
        popup,
        () => { closed++; },
        false,
      );
      expect(closed).toBe(1);
      expect(prevented).toBe(1);

      // Color picker (allowInternalTab = true): Tab on middle button stays open
      closed = 0;
      prevented = 0;
      (globalThis as { document?: unknown }).document = { activeElement: b1 };
      handlePortalPopupTab(
        { key: "Tab", shiftKey: false, preventDefault: () => { prevented++; } },
        popup,
        () => { closed++; },
        true,
      );
      expect(closed).toBe(0);
      expect(prevented).toBe(0);

      // Tab on last button closes & prevents default
      (globalThis as { document?: unknown }).document = { activeElement: b2 };
      handlePortalPopupTab(
        { key: "Tab", shiftKey: false, preventDefault: () => { prevented++; } },
        popup,
        () => { closed++; },
        true,
      );
      expect(closed).toBe(1);
      expect(prevented).toBe(1);

      // Shift+Tab on first button closes & prevents default
      closed = 0;
      prevented = 0;
      (globalThis as { document?: unknown }).document = { activeElement: b0 };
      handlePortalPopupTab(
        { key: "Tab", shiftKey: true, preventDefault: () => { prevented++; } },
        popup,
        () => { closed++; },
        true,
      );
      expect(closed).toBe(1);
      expect(prevented).toBe(1);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  test("Docs Sidebar labels its outline <nav> landmark and DocumentCard anchors delete in the footer", () => {
    const sidebar = readFileSync(
      join(ROOT, "docs/src/components/Sidebar.tsx"),
      "utf8",
    );
    const card = readFileSync(
      join(ROOT, "docs/src/components/DocumentCard.tsx"),
      "utf8",
    );
    expect(sidebar).toContain('aria-label={t("outline")}');
    expect(sidebar).toContain("min-h-11 min-w-11 sm:min-h-7 sm:min-w-7");
    expect(card).toContain("bottom-2 right-2");
    expect(card).toContain("pr-14 sm:pr-11");
  });
});
