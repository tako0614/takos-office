import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFixedPopupPosition } from "../shared/lib/dialog-a11y.ts";
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
    expect(cellEditor).toContain("aria-label={props.ariaLabel}");
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

  test("Docs and Sheets toolbar dropdown popups render via Portal with clamped fixed coordinates", () => {
    for (const rel of [
      "docs/src/components/Toolbar.tsx",
      "sheet/src/components/Toolbar.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("<Portal>");
      expect(src).toContain("computeFixedPopupPosition");
      expect(src).toContain('e.key === "Tab"');
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
