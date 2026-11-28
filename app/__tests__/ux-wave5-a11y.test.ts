import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeHorizontalScrollEdges,
  getNextCanvasElementId,
  getNextToolbarIndex,
  setupToolbarRovingTabIndex,
  shouldLeaveToolbarInput,
  syncToolbarRovingTabIndex,
} from "../shared/lib/dialog-a11y.ts";

const ROOT = join(import.meta.dir, "..");

describe("Wave 5 WAI-ARIA toolbar roving tabindex helpers", () => {
  test("getNextToolbarIndex wraps ArrowRight/ArrowLeft and jumps Home/End", () => {
    expect(getNextToolbarIndex("ArrowRight", 0, 4)).toBe(1);
    expect(getNextToolbarIndex("ArrowRight", 3, 4)).toBe(0);
    expect(getNextToolbarIndex("ArrowRight", -1, 4)).toBe(0);
    expect(getNextToolbarIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(getNextToolbarIndex("ArrowLeft", 2, 4)).toBe(1);
    expect(getNextToolbarIndex("ArrowLeft", -1, 4)).toBe(3);
    expect(getNextToolbarIndex("Home", 2, 4)).toBe(0);
    expect(getNextToolbarIndex("End", 1, 4)).toBe(3);
    expect(getNextToolbarIndex("ArrowDown", 1, 4)).toBeNull();
    expect(getNextToolbarIndex("ArrowRight", 0, 0)).toBeNull();
  });

  test("shouldLeaveToolbarInput preserves in-field caret movement and exits only at boundaries", () => {
    // Empty input exits on ArrowLeft, ArrowRight, Home, and End
    const empty = { value: "", selectionStart: 0, selectionEnd: 0 };
    expect(shouldLeaveToolbarInput(empty, "ArrowLeft")).toBe(true);
    expect(shouldLeaveToolbarInput(empty, "ArrowRight")).toBe(true);
    expect(shouldLeaveToolbarInput(empty, "Home")).toBe(true);
    expect(shouldLeaveToolbarInput(empty, "End")).toBe(true);

    // Non-empty input with caret in middle stays in field
    const mid = { value: "abc", selectionStart: 1, selectionEnd: 1 };
    expect(shouldLeaveToolbarInput(mid, "ArrowLeft")).toBe(false);
    expect(shouldLeaveToolbarInput(mid, "ArrowRight")).toBe(false);
    expect(shouldLeaveToolbarInput(mid, "Home")).toBe(false);
    expect(shouldLeaveToolbarInput(mid, "End")).toBe(false);

    // Caret at start exits on ArrowLeft only; caret at end exits on ArrowRight only
    const atStart = { value: "abc", selectionStart: 0, selectionEnd: 0 };
    expect(shouldLeaveToolbarInput(atStart, "ArrowLeft")).toBe(true);
    expect(shouldLeaveToolbarInput(atStart, "ArrowRight")).toBe(false);
    const atEnd = { value: "abc", selectionStart: 3, selectionEnd: 3 };
    expect(shouldLeaveToolbarInput(atEnd, "ArrowLeft")).toBe(false);
    expect(shouldLeaveToolbarInput(atEnd, "ArrowRight")).toBe(true);

    // Active range selection never exits the input
    const selected = { value: "abc", selectionStart: 0, selectionEnd: 3 };
    expect(shouldLeaveToolbarInput(selected, "ArrowLeft")).toBe(false);
    expect(shouldLeaveToolbarInput(selected, "ArrowRight")).toBe(false);
  });

  test("syncToolbarRovingTabIndex keeps exactly one enabled control at tabIndex=0 and skips disabled controls", () => {
    const makeControl = (name: string, disabled = false) => {
      let ti = 0;
      return {
        name,
        disabled,
        get tabIndex() {
          return ti;
        },
        set tabIndex(v: number) {
          ti = v;
        },
        hasAttribute: (attr: string) => attr === "disabled" && disabled,
        getAttribute: (attr: string) =>
          attr === "tabindex" ? String(ti) : null,
        closest: () => null,
        focus: () => {},
      };
    };

    const disabledUndo = makeControl("undo", true);
    const bold = makeControl("bold", false);
    const italic = makeControl("italic", false);
    const controls = [disabledUndo, bold, italic];

    const toolbar = {
      querySelectorAll: (sel: string) =>
        sel.includes(":not([disabled])")
          ? controls.filter((c) => !c.disabled)
          : controls,
    } as unknown as HTMLElement;

    const prevDoc = (globalThis as { document?: unknown }).document;
    try {
      (globalThis as { document?: unknown }).document = { activeElement: null };
      const chosen1 = syncToolbarRovingTabIndex(toolbar);
      expect(chosen1).toBe(bold as unknown as HTMLElement);
      expect(disabledUndo.tabIndex).toBe(-1);
      expect(bold.tabIndex).toBe(0);
      expect(italic.tabIndex).toBe(-1);

      // Selecting italic moves single tab stop to italic
      const chosen2 = syncToolbarRovingTabIndex(
        toolbar,
        italic as unknown as HTMLElement,
      );
      expect(chosen2).toBe(italic as unknown as HTMLElement);
      expect(disabledUndo.tabIndex).toBe(-1);
      expect(bold.tabIndex).toBe(-1);
      expect(italic.tabIndex).toBe(0);

      // Disabling italic falls back to remaining enabled control (bold)
      italic.disabled = true;
      const chosen3 = syncToolbarRovingTabIndex(toolbar);
      expect(chosen3).toBe(bold as unknown as HTMLElement);
      expect(bold.tabIndex).toBe(0);
      expect(italic.tabIndex).toBe(-1);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });

  test("setupToolbarRovingTabIndex wires focusin/keydown listeners and cleans up cleanly", () => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const makeBtn = (name: string) => {
      let ti = 0;
      let focused = 0;
      return {
        name,
        get focused() {
          return focused;
        },
        get tabIndex() {
          return ti;
        },
        set tabIndex(v: number) {
          ti = v;
        },
        hasAttribute: () => false,
        getAttribute: (attr: string) =>
          attr === "tabindex" ? String(ti) : null,
        closest: () => null,
        focus: () => {
          focused++;
        },
        scrollIntoView: () => {},
      };
    };
    const b0 = makeBtn("b0");
    const b1 = makeBtn("b1");
    const b2 = makeBtn("b2");
    const toolbar = {
      querySelectorAll: () => [b0, b1, b2],
      addEventListener: (type: string, fn: (...args: unknown[]) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: (...args: unknown[]) => void) => {
        listeners.get(type)?.delete(fn);
      },
    } as unknown as HTMLElement;

    const prevDoc = (globalThis as { document?: unknown }).document;
    const prevMO = globalThis.MutationObserver;
    try {
      (globalThis as { document?: unknown }).document = { activeElement: b0 };
      (globalThis as { MutationObserver?: unknown }).MutationObserver = undefined;
      const cleanup = setupToolbarRovingTabIndex(toolbar);
      expect(b0.tabIndex).toBe(0);
      expect(b1.tabIndex).toBe(-1);
      expect(b2.tabIndex).toBe(-1);

      let prevented = 0;
      let stopped = 0;
      for (const fn of listeners.get("keydown") ?? []) {
        fn({
          key: "ArrowRight",
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          isComposing: false,
          keyCode: 39,
          target: b0,
          preventDefault: () => {
            prevented++;
          },
          stopPropagation: () => {
            stopped++;
          },
        });
      }
      expect(prevented).toBe(1);
      expect(stopped).toBe(1);
      expect(b0.tabIndex).toBe(-1);
      expect(b1.tabIndex).toBe(0);
      expect(b1.focused).toBe(1);

      cleanup();
      expect(listeners.get("keydown")?.size ?? 0).toBe(0);
      expect(listeners.get("focusin")?.size ?? 0).toBe(0);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
      globalThis.MutationObserver = prevMO;
    }
  });
});

describe("Wave 5 horizontal scroll-affordance edge fade helper", () => {
  test("computeHorizontalScrollEdges reports left/right overflow accurately across scroll positions", () => {
    // Desktop (no overflow)
    expect(
      computeHorizontalScrollEdges({
        scrollLeft: 0,
        clientWidth: 1200,
        scrollWidth: 1200,
      }),
    ).toEqual({ canScrollLeft: false, canScrollRight: false });

    // Mobile at left start
    expect(
      computeHorizontalScrollEdges({
        scrollLeft: 0,
        clientWidth: 359,
        scrollWidth: 1190,
      }),
    ).toEqual({ canScrollLeft: false, canScrollRight: true });

    // Mobile scrolled partway
    expect(
      computeHorizontalScrollEdges({
        scrollLeft: 200,
        clientWidth: 359,
        scrollWidth: 1190,
      }),
    ).toEqual({ canScrollLeft: true, canScrollRight: true });

    // Mobile scrolled to right end
    expect(
      computeHorizontalScrollEdges({
        scrollLeft: 831,
        clientWidth: 359,
        scrollWidth: 1190,
      }),
    ).toEqual({ canScrollLeft: true, canScrollRight: false });
  });
});

describe("Wave 5 SlideCanvas keyboard element cycling helper", () => {
  const elements = [{ id: "e1" }, { id: "e2" }, { id: "e3" }];

  test("cycles forward on Tab from unselected through all elements and exits at the end without trapping", () => {
    expect(getNextCanvasElementId(elements, null, false)).toBe("e1");
    expect(getNextCanvasElementId(elements, "e1", false)).toBe("e2");
    expect(getNextCanvasElementId(elements, "e2", false)).toBe("e3");
    expect(getNextCanvasElementId(elements, "e3", false)).toBeUndefined();
  });

  test("cycles backward on Shift+Tab and exits cleanly at the start or when unselected", () => {
    expect(getNextCanvasElementId(elements, "e3", true)).toBe("e2");
    expect(getNextCanvasElementId(elements, "e2", true)).toBe("e1");
    expect(getNextCanvasElementId(elements, "e1", true)).toBeUndefined();
    expect(getNextCanvasElementId(elements, null, true)).toBeUndefined();
  });

  test("returns undefined immediately for an empty slide", () => {
    expect(getNextCanvasElementId([], null, false)).toBeUndefined();
    expect(getNextCanvasElementId([], null, true)).toBeUndefined();
  });
});

describe("Wave 5 suite-wide component contracts", () => {
  test("Docs, Slides, and Sheets toolbars wire roving tabindex and mobile scroll edge fades", () => {
    for (const rel of [
      "docs/src/components/Toolbar.tsx",
      "slide/src/components/ShapeToolbar.tsx",
      "sheet/src/components/Toolbar.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toContain("setupToolbarRovingTabIndex");
      expect(src).toContain("observeHorizontalScrollEdges");
      expect(src).toContain('data-scroll-fade="left"');
      expect(src).toContain('data-scroll-fade="right"');
      expect(src).toContain("pointer-events-none");
    }
  });

  test("SlideCanvas supports keyboard Tab/Shift+Tab element cycling, dynamic aria-label, live announcements, and shortcuts help entry", () => {
    const canvas = readFileSync(
      join(ROOT, "slide/src/components/SlideCanvas.tsx"),
      "utf8",
    );
    const editor = readFileSync(
      join(ROOT, "slide/src/pages/EditorPage.tsx"),
      "utf8",
    );
    const shortcuts = readFileSync(
      join(ROOT, "slide/src/components/ShortcutsHelp.tsx"),
      "utf8",
    );

    expect(canvas).toContain("getNextCanvasElementId");
    expect(canvas).toContain("onKeyDown={handleKeyDown}");
    expect(canvas).toContain("onAnnounceSelection");
    expect(canvas).toContain("aria-label={canvasAriaLabel()}");
    expect(editor).toContain("onAnnounceSelection={announceStatus}");
    expect(editor).toContain("if (nudge && !isInteractiveShortcutTarget(e.target))");
    expect(editor).toContain('t("selectionCleared")');
    expect(shortcuts).toContain("shortcutCycleElements");
  });

  test("Docs Editor exposes accessible textbox semantics and WCAG AA placeholder contrast", () => {
    const editor = readFileSync(
      join(ROOT, "docs/src/components/Editor.tsx"),
      "utf8",
    );
    const css = readFileSync(join(ROOT, "docs/src/styles.css"), "utf8");

    expect(editor).toContain('role: "textbox"');
    expect(editor).toContain('"aria-multiline": "true"');
    expect(editor).toContain('t("documentContent")');
    expect(css).not.toContain("color: #bdc1c6;");
    expect(css).toContain("color: #6b7280;");
    expect(css).toContain("color: #9ca3af;");
  });

  test("Sheets inline title edit restores focus and SheetTabs menu enforces 44px mobile touch targets and Tab restore", () => {
    const toolbar = readFileSync(
      join(ROOT, "sheet/src/components/Toolbar.tsx"),
      "utf8",
    );
    const tabs = readFileSync(
      join(ROOT, "sheet/src/components/SheetTabs.tsx"),
      "utf8",
    );

    expect(toolbar).toContain("restoreFocus(titleBtnRef)");
    expect(toolbar).toContain("if (!editingTitle()) return;");
    expect(tabs).toContain("min-h-11 sm:min-h-8");
    expect(tabs).toContain("closeContextMenu(true)");
  });
});
