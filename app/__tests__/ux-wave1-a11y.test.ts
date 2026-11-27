import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isImeComposing,
  isRedoKeyEvent,
  isUndoKeyEvent,
} from "../shared/lib/dialog-a11y.ts";
import { renderShellPage } from "../shell-page.ts";

const ROOT = join(import.meta.dir, "..");

describe("dialog-a11y keyboard helpers", () => {
  test("isUndoKeyEvent matches Ctrl+Z and Cmd+Z regardless of case, rejects Shift+Z", () => {
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, key: "z" })).toBe(true);
    expect(isUndoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: false, key: "Z" })).toBe(true);
    expect(isUndoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "Z" })).toBe(false);
    expect(isUndoKeyEvent({ ctrlKey: false, metaKey: false, shiftKey: false, key: "z" })).toBe(false);
  });

  test("isRedoKeyEvent matches Ctrl/Cmd+Shift+Z (uppercase Z) and Ctrl/Cmd+Y", () => {
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "Z" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: true, key: "Z" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: true, key: "z" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, key: "y" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: true, shiftKey: false, key: "Y" })).toBe(true);
    expect(isRedoKeyEvent({ ctrlKey: true, metaKey: false, shiftKey: false, key: "z" })).toBe(false);
    expect(isRedoKeyEvent({ ctrlKey: false, metaKey: false, shiftKey: true, key: "Z" })).toBe(false);
  });

  test("isImeComposing detects isComposing and keyCode 229", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 } as KeyboardEvent)).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 } as KeyboardEvent)).toBe(false);
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

  test("all three library list pages surface loadError with alert role and retry button", () => {
    for (const rel of [
      "docs/src/pages/DocumentListPage.tsx",
      "slide/src/pages/PresentationListPage.tsx",
      "sheet/src/pages/SpreadsheetListPage.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("loadError");
      expect(src).toContain('role="alert"');
      expect(src).toContain('t("retry")');
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

  test("IME composition guards protect Enter handlers across Docs and Sheets controls", () => {
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
});
