import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getFocusableElements,
  handleModalKeyDown,
  isImeComposing,
  isRedoKeyEvent,
  isUndoKeyEvent,
} from "../shared/lib/dialog-a11y.ts";
import { renderShellPage } from "../shell-page.ts";

const ROOT = join(import.meta.dir, "..");

describe("dialog-a11y keyboard helpers", () => {
  test("isUndoKeyEvent matches Ctrl+Z and Cmd+Z regardless of case, rejects Shift/Alt/IME", () => {
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, key: "z" })).toBe(true);
    expect(isUndoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: false, key: "Z" })).toBe(true);
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "Z" })).toBe(false);
    expect(isUndoKeyEvent({ ctrlKey: false, metaKey: false, shiftKey: false, key: "z" })).toBe(false);
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: true, key: "z" })).toBe(false);
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, isComposing: true, key: "z" })).toBe(false);
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, keyCode: 229, key: "z" })).toBe(false);
  });

  test("isRedoKeyEvent matches Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y, rejects Ctrl+Shift+Y, Alt, and IME", () => {
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "Z" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: true, key: "Z" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "z" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, key: "y" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: false, key: "Y" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "Y" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: true, key: "y" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: true, key: "y" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: true, key: "Z" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, isComposing: true, key: "Z" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, keyCode: 229, key: "y" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, key: "z" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: false, shiftKey: true, key: "Z" })).toBe(false);
  });

  test("isImeComposing detects isComposing and keyCode 229", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  test("handleModalKeyDown wraps Shift+Tab from container itself to the last focusable element", () => {
    let focused: unknown = null;
    const makeEl = (name: string) => ({
      name,
      tagName: "BUTTON",
      tabIndex: 0,
      hasAttribute: () => false,
      closest: () => null,
      focus: () => {
        focused = name;
      },
    });
    const first = makeEl("first");
    const last = makeEl("last");
    const container = {
      querySelectorAll: () => [first, last],
      contains: (node: unknown) => node === container || node === first || node === last,
      focus: () => {
        focused = "container";
      },
    } as unknown as HTMLElement;

    const prevDocument = globalThis.document;
    globalThis.document = { activeElement: container } as unknown as Document;
    let prevented = false;
    try {
      handleModalKeyDown(
        {
          key: "Tab",
          shiftKey: true,
          isComposing: false,
          keyCode: 9,
          preventDefault: () => {
            prevented = true;
          },
          stopPropagation: () => {},
        } as unknown as KeyboardEvent,
        container,
        () => {},
      );
      expect(prevented).toBe(true);
      expect(focused).toBe("last");
    } finally {
      globalThis.document = prevDocument;
    }
  });

  test("getFocusableElements filters out hidden/inert elements and closed details descendants while keeping direct summary", () => {
    const closedDetails = { tagName: "DETAILS" };
    const visibleBtn = {
      tagName: "BUTTON",
      tabIndex: 0,
      parentElement: null,
      hasAttribute: () => false,
      closest: () => null,
    };
    const hiddenAncestorBtn = {
      tagName: "BUTTON",
      tabIndex: 0,
      parentElement: null,
      hasAttribute: () => false,
      closest: (sel: string) => (sel.includes("[hidden]") ? {} : null),
    };
    const directSummary = {
      tagName: "SUMMARY",
      tabIndex: 0,
      parentElement: closedDetails,
      hasAttribute: () => false,
      closest: (sel: string) => (sel === "details:not([open])" ? closedDetails : null),
    };
    const hiddenInsideDetails = {
      tagName: "BUTTON",
      tabIndex: 0,
      parentElement: {},
      hasAttribute: () => false,
      closest: (sel: string) => (sel === "details:not([open])" ? closedDetails : null),
    };
    const container = {
      querySelectorAll: () => [
        visibleBtn,
        hiddenAncestorBtn,
        directSummary,
        hiddenInsideDetails,
      ],
    } as unknown as HTMLElement;

    const result = getFocusableElements(container);
    expect(result).toEqual([
      visibleBtn as unknown as HTMLElement,
      directSummary as unknown as HTMLElement,
    ]);
  });
});

describe("Office Shell accessibility and error UI", () => {
  test("renders accessible search input, nav label, focus-visible ring, and styled error/retry state", () => {
    const html = renderShellPage();
    expect(html).toContain('aria-label="Takos Office apps"');
    expect(html).toContain('id="q"');
    expect(html).toContain('aria-label="Search across Documents, Slides and Sheets"');
    expect(html).toContain(":focus-visible");
    expect(html).toContain("#load-error");
    expect(html).toContain("#retry");
  });
});

describe("Wave 1 UI/UX regression contracts across Docs, Slides, and Sheets", () => {
  test("all three library cards use sibling <button type=\"button\"> controls (no clickable <div> cards)", () => {
    for (const rel of [
      "docs/src/components/DocumentCard.tsx",
      "slide/src/components/PresentationCard.tsx",
      "sheet/src/components/SpreadsheetCard.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain('type="button"');
      expect(src).toContain("group-focus-within:opacity-100");
      expect(src).not.toMatch(/<div[^>]*onClick=/);
    }
  });

  test("all three library list pages surface loadError with alert role, retry button, and generation guard", () => {
    for (const rel of [
      "docs/src/pages/DocumentListPage.tsx",
      "slide/src/pages/PresentationListPage.tsx",
      "sheet/src/pages/SpreadsheetListPage.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("loadError");
      expect(src).toContain('role="alert"');
      expect(src).toContain('t("retry")');
      expect(src).toMatch(/(?:viewGeneration|loadGeneration)/);
    }
  });

  test("Slides and Sheets editors use case-insensitive Ctrl/Cmd+Shift+Z redo helper", () => {
    for (const rel of [
      "slide/src/pages/EditorPage.tsx",
      "sheet/src/pages/EditorPage.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("isUndoKeyEvent");
      expect(src).toContain("isRedoKeyEvent");
    }
  });

  test("PresentPage exposes accessible touch/pointer exit and slide navigation buttons", () => {
    const src = readFileSync(join(ROOT, "slide/src/pages/PresentPage.tsx"), "utf8");
    expect(src).not.toContain("cursor-none");
    expect(src).toContain('aria-label={t("shortcutExitPresent")}');
    expect(src).toContain('aria-label={t("shortcutPrevSlide")}');
    expect(src).toContain('aria-label={t("shortcutNextSlide")}');
  });

  test("IME composition guards protect Enter and Escape handlers across Docs and Sheets controls", () => {
    for (const rel of [
      "docs/src/components/FindReplace.tsx",
      "docs/src/components/Toolbar.tsx",
      "sheet/src/components/Toolbar.tsx",
      "sheet/src/components/SheetTabs.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("isImeComposing");
    }
  });

  test("SheetTabs context menu uses menuRef.contains (no delegated pointerdown stopPropagation), clamps left >= 8, and supports keyboard navigation", () => {
    const src = readFileSync(join(ROOT, "sheet/src/components/SheetTabs.tsx"), "utf8");
    expect(src).toContain("menuRef.contains(e.target)");
    expect(src).not.toContain("onPointerDown={(e) => e.stopPropagation()}");
    expect(src).toContain("Math.max(8, Math.min(menu().x, globalThis.innerWidth - 150))");
    expect(src).toContain("ArrowDown");
    expect(src).toContain("ArrowUp");
    expect(src).toContain("Home");
    expect(src).toContain("End");
  });
});
