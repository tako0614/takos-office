const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => {
      if (el.hasAttribute("disabled") || el.tabIndex === -1) return false;
      if (el.closest?.("[hidden], [inert]")) return false;
      const closedDetails = el.closest?.("details:not([open])");
      if (closedDetails) {
        const isDirectSummary =
          el.tagName === "SUMMARY" && el.parentElement === closedDetails;
        if (!isDirectSummary) return false;
      }
      const style = globalThis.getComputedStyle?.(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) {
        return false;
      }
      return true;
    });
}

export function isImeComposing(
  event: { isComposing?: boolean; keyCode?: number },
): boolean {
  return Boolean(event.isComposing) || event.keyCode === 229;
}

const INTERACTIVE_SHORTCUT_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

/**
 * Returns true when a keyboard event originated on or inside a native or ARIA
 * interactive control (button, link, input, menuitem, tab, summary, or
 * contenteditable) whose own activation or editing behavior must not be
 * hijacked by global shortcuts such as Enter-to-edit on a canvas.
 */
export function isInteractiveShortcutTarget(
  target: EventTarget | null,
): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as Partial<HTMLElement>;
  if (el.isContentEditable) return true;
  if (typeof el.closest === "function") {
    return Boolean(el.closest(INTERACTIVE_SHORTCUT_SELECTOR));
  }
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A" ||
    tag === "SUMMARY"
  ) {
    return true;
  }
  const role = typeof el.getAttribute === "function"
    ? el.getAttribute("role")
    : null;
  return (
    role === "button" ||
    role === "link" ||
    role === "menuitem" ||
    role === "tab"
  );
}

export function handleModalKeyDown(
  event: KeyboardEvent,
  container: HTMLElement | undefined,
  onClose: () => void,
): void {
  if (isImeComposing(event)) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== "Tab" || !container) return;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (
      active === first ||
      active === container ||
      !active ||
      !container.contains(active)
    ) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !active || !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

export type ShortcutKeyEvent =
  & Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "key">
  & {
    altKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
  };

export function isRedoKeyEvent(event: ShortcutKeyEvent): boolean {
  if (event.altKey || isImeComposing(event)) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  const key = event.key.toLowerCase();
  return (!event.shiftKey && key === "y") || (event.shiftKey && key === "z");
}

export function isUndoKeyEvent(event: ShortcutKeyEvent): boolean {
  if (event.altKey || isImeComposing(event)) return false;
  return (event.ctrlKey || event.metaKey) && !event.shiftKey &&
    event.key.toLowerCase() === "z";
}

let scrollLockCount = 0;
let savedBodyOverflow = "";

/**
 * Ref-counted body scroll lock for modal dialogs so overlapping or sequential
 * dialogs cannot unlock prematurely or leave the document stuck locked.
 */
export function acquireModalScrollLock(): () => void {
  const body = globalThis.document?.body;
  if (!body) return () => {};
  if (scrollLockCount === 0) {
    savedBodyOverflow = body.style.overflow;
    body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0 && globalThis.document?.body) {
      globalThis.document.body.style.overflow = savedBodyOverflow;
      savedBodyOverflow = "";
    }
  };
}

/**
 * Restores keyboard focus to the modal opener when still connected to the DOM,
 * falling back to `#main` (or the given selector) so focus is never lost.
 */
export function restoreFocus(
  opener: HTMLElement | null | undefined,
  fallbackSelector = "#main",
): void {
  if (opener?.isConnected && typeof opener.focus === "function") {
    opener.focus();
    return;
  }
  const fallback = globalThis.document?.querySelector?.<HTMLElement>(
    fallbackSelector,
  );
  if (fallback?.isConnected && typeof fallback.focus === "function") {
    fallback.focus();
  }
}

/** Validates an explicit HTTP(S) URL for inline prompt validation. */
export function isValidHttpUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export interface PopupAnchorRect {
  left: number;
  right: number;
  bottom: number;
}

/**
 * Computes viewport-clamped `position: fixed` coordinates for a toolbar popup
 * rendered inside a `<Portal>` so popups are never clipped by horizontally
 * scrollable mobile toolbars and never overflow off the viewport edge.
 */
export function computeFixedPopupPosition(
  anchor: PopupAnchorRect,
  popupWidth: number,
  viewportWidth: number,
  align: "left" | "right" = "left",
  margin = 8,
): { left: number; top: number } {
  const rawLeft = align === "right" ? anchor.right - popupWidth : anchor.left;
  const maxLeft = Math.max(margin, viewportWidth - popupWidth - margin);
  const left = Math.max(margin, Math.min(rawLeft, maxLeft));
  const top = Math.max(margin, Math.round(anchor.bottom + 4));
  return { left: Math.round(left), top };
}

export interface ColorGridNavOptions {
  /** Number of swatch columns per row (e.g. 6 in Sheets, 8 in Docs). */
  columns: number;
  /** Position of the full-width reset button relative to the swatch grid. */
  resetPosition: "first" | "last";
}

/**
 * Computes the next focused button index inside a color-picker popup for
 * ArrowLeft / ArrowRight / ArrowUp / ArrowDown / Home / End navigation.
 * Returns `null` for any other key or empty list.
 */
export function getNextColorPopupIndex(
  key: string,
  currentIndex: number,
  totalItems: number,
  options: ColorGridNavOptions,
): number | null {
  if (totalItems <= 0) return null;
  const cols = Math.max(1, options.columns);
  const lastIndex = totalItems - 1;

  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  if (key === "ArrowRight") {
    return currentIndex >= 0 ? (currentIndex + 1) % totalItems : 0;
  }
  if (key === "ArrowLeft") {
    return currentIndex >= 0
      ? (currentIndex - 1 + totalItems) % totalItems
      : lastIndex;
  }
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;

  if (totalItems === 1) return 0;

  const swatchCount = totalItems - 1;
  if (options.resetPosition === "first") {
    if (currentIndex < 0) return key === "ArrowDown" ? 0 : lastIndex;
    if (currentIndex === 0) return key === "ArrowDown" ? 1 : lastIndex;
    const g = currentIndex - 1;
    if (key === "ArrowDown") {
      return g + cols < swatchCount ? 1 + g + cols : 0;
    }
    return g - cols >= 0 ? 1 + g - cols : 0;
  }

  if (currentIndex < 0) return key === "ArrowDown" ? 0 : lastIndex;
  if (currentIndex === lastIndex) {
    if (key === "ArrowDown") return 0;
    return Math.floor((swatchCount - 1) / cols) * cols;
  }
  if (key === "ArrowDown") {
    return currentIndex + cols < swatchCount ? currentIndex + cols : lastIndex;
  }
  return currentIndex - cols >= 0 ? currentIndex - cols : lastIndex;
}

/**
 * Handles `Tab` / `Shift+Tab` inside a `<Portal>` popup appended to
 * `document.body`. When `allowInternalTab` is true (e.g. color pickers), Tab
 * moves normally across buttons inside the popup and closes with focus
 * restoration when crossing either boundary; when false (e.g. `role="menu"`),
 * Tab immediately closes and restores focus to the trigger instead of letting
 * focus fall off the end of `document.body` to the top of the document.
 */
export function handlePortalPopupTab(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  popup: HTMLElement | undefined,
  onCloseAndRestore: () => void,
  allowInternalTab: boolean,
): void {
  if (event.key !== "Tab") return;
  if (!allowInternalTab || !popup) {
    event.preventDefault();
    onCloseAndRestore();
    return;
  }
  const focusable = getFocusableElements(popup);
  if (focusable.length === 0) {
    event.preventDefault();
    onCloseAndRestore();
    return;
  }
  const active = globalThis.document?.activeElement as HTMLElement | null;
  const idx = active ? focusable.indexOf(active) : -1;
  if (idx < 0 || (event.shiftKey ? idx === 0 : idx === focusable.length - 1)) {
    event.preventDefault();
    onCloseAndRestore();
  }
}

/**
 * Computes the next position for keyboard element nudging (`Arrow*` = 1px,
 * `Shift+Arrow*` = 10px), returning `null` for non-arrow keys or modifier combos.
 */
export function getArrowNudgeDelta(
  event: Pick<KeyboardEvent, "key" | "shiftKey"> & {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
    keyCode?: number;
  },
): { dx: number; dy: number } | null {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    isImeComposing(event)
  ) {
    return null;
  }
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

const ALL_TOOLBAR_CONTROLS_SELECTOR = [
  "button",
  "select",
  'input:not([type="hidden"])',
  "a[href]",
].join(", ");

const ENABLED_TOOLBAR_CONTROLS_SELECTOR = [
  "button:not([disabled])",
  "select:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "a[href]",
].join(", ");

/**
 * Returns visible, enabled top-level interactive controls inside a
 * `role="toolbar"` container in DOM order.
 */
export function getToolbarControls(toolbar: HTMLElement): HTMLElement[] {
  return Array.from(
    toolbar.querySelectorAll<HTMLElement>(ENABLED_TOOLBAR_CONTROLS_SELECTOR),
  ).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.closest?.("[hidden], [inert]")) return false;
    const style = globalThis.getComputedStyle?.(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) {
      return false;
    }
    return true;
  });
}

/**
 * Computes the next focused toolbar control index for horizontal WAI-ARIA
 * toolbar arrow/Home/End navigation, wrapping cleanly at the ends.
 */
export function getNextToolbarIndex(
  key: string,
  currentIndex: number,
  totalItems: number,
): number | null {
  if (totalItems <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return currentIndex >= 0 ? (currentIndex + 1) % totalItems : 0;
    case "ArrowLeft":
      return currentIndex >= 0
        ? (currentIndex - 1 + totalItems) % totalItems
        : totalItems - 1;
    case "Home":
      return 0;
    case "End":
      return totalItems - 1;
    default:
      return null;
  }
}

/**
 * Returns true when an arrow/Home/End key pressed inside a toolbar text/search
 * `<input>` should exit the input to an adjacent toolbar item instead of moving
 * the text caret.
 */
export function shouldLeaveToolbarInput(
  input: Pick<HTMLInputElement, "value" | "selectionStart" | "selectionEnd">,
  key: string,
): boolean {
  const len = input.value.length;
  if (len === 0) {
    return (
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "Home" ||
      key === "End"
    );
  }
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start === null || end === null || start !== end) return false;
  if (key === "ArrowLeft") return start === 0;
  if (key === "ArrowRight") return end === len;
  return false;
}

/**
 * Ensures exactly one enabled control inside a `role="toolbar"` has
 * `tabIndex = 0` and all other controls (enabled or disabled) have
 * `tabIndex = -1`, implementing a single-tab-stop WAI-ARIA roving tabindex.
 */
export function syncToolbarRovingTabIndex(
  toolbar: HTMLElement,
  preferred?: HTMLElement | null,
): HTMLElement | null {
  const enabled = getToolbarControls(toolbar);
  const activeEl = globalThis.document?.activeElement as HTMLElement | null;
  let chosen: HTMLElement | null = null;
  if (preferred && enabled.includes(preferred)) {
    chosen = preferred;
  } else if (activeEl && enabled.includes(activeEl)) {
    chosen = activeEl;
  } else {
    chosen =
      enabled.find((el) => el.getAttribute?.("tabindex") === "0") ??
      enabled[0] ??
      null;
  }

  const allControls = Array.from(
    toolbar.querySelectorAll<HTMLElement>(ALL_TOOLBAR_CONTROLS_SELECTOR),
  );
  for (const control of allControls) {
    const nextTab = control === chosen ? 0 : -1;
    if (control.tabIndex !== nextTab || control.getAttribute?.("tabindex") !== String(nextTab)) {
      control.tabIndex = nextTab;
    }
  }
  return chosen;
}

/**
 * Attaches WAI-ARIA horizontal toolbar roving tabindex (ArrowLeft/ArrowRight/
 * Home/End, focusin tracking, and dynamic disabled/childList synchronization)
 * to a `role="toolbar"` element.
 */
export function setupToolbarRovingTabIndex(toolbar: HTMLElement): () => void {
  syncToolbarRovingTabIndex(toolbar);

  const onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target !== "object") return;
    const enabled = getToolbarControls(toolbar);
    if (enabled.includes(target)) {
      syncToolbarRovingTabIndex(toolbar, target);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (
      isImeComposing(e) ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey
    ) {
      return;
    }
    if (
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) {
      return;
    }
    const enabled = getToolbarControls(toolbar);
    if (enabled.length === 0) return;

    const docActive = globalThis.document?.activeElement as HTMLElement | null;
    const targetEl = e.target as HTMLElement | null;
    const active =
      (docActive && enabled.includes(docActive) ? docActive : null) ??
      (targetEl && enabled.includes(targetEl) ? targetEl : null);
    const currentIdx = active ? enabled.indexOf(active) : -1;
    if (currentIdx < 0) return;

    const isInput =
      typeof HTMLInputElement !== "undefined"
        ? active instanceof HTMLInputElement
        : active?.tagName?.toUpperCase() === "INPUT";
    if (
      isInput &&
      !shouldLeaveToolbarInput(active as HTMLInputElement, e.key)
    ) {
      return;
    }

    const nextIdx = getNextToolbarIndex(e.key, currentIdx, enabled.length);
    if (nextIdx === null) return;

    e.preventDefault();
    e.stopPropagation();
    const next = enabled[nextIdx];
    if (!next) return;
    syncToolbarRovingTabIndex(toolbar, next);
    next.focus();
    next.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  toolbar.addEventListener("focusin", onFocusIn);
  toolbar.addEventListener("keydown", onKeyDown);

  let observer: MutationObserver | undefined;
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      syncToolbarRovingTabIndex(toolbar);
    });
    observer.observe(toolbar, {
      attributes: true,
      attributeFilter: ["disabled", "hidden"],
      childList: true,
      subtree: true,
    });
  }

  return () => {
    toolbar.removeEventListener("focusin", onFocusIn);
    toolbar.removeEventListener("keydown", onKeyDown);
    observer?.disconnect();
  };
}

export interface HorizontalScrollEdges {
  canScrollLeft: boolean;
  canScrollRight: boolean;
}

/**
 * Computes whether a horizontally scrollable container has hidden content off
 * its left and/or right edges (used for mobile toolbar scroll-affordance fades).
 */
export function computeHorizontalScrollEdges(
  metrics: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  tolerance = 1,
): HorizontalScrollEdges {
  const overflows = metrics.scrollWidth > metrics.clientWidth + tolerance;
  return {
    canScrollLeft: overflows && metrics.scrollLeft > tolerance,
    canScrollRight:
      overflows &&
      metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - tolerance,
  };
}

/**
 * Tracks left/right horizontal scroll overflow on a scrollable toolbar strip
 * across scrolls, container resizes, and window resizes.
 */
export function observeHorizontalScrollEdges(
  el: HTMLElement,
  onChange: (edges: HorizontalScrollEdges) => void,
): () => void {
  let prevLeft: boolean | null = null;
  let prevRight: boolean | null = null;
  const update = () => {
    const next = computeHorizontalScrollEdges(el);
    if (next.canScrollLeft !== prevLeft || next.canScrollRight !== prevRight) {
      prevLeft = next.canScrollLeft;
      prevRight = next.canScrollRight;
      onChange(next);
    }
  };
  update();
  const raf = globalThis.requestAnimationFrame?.(update);
  el.addEventListener("scroll", update, { passive: true });
  globalThis.addEventListener?.("resize", update);
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
  }
  return () => {
    if (raf !== undefined) globalThis.cancelAnimationFrame?.(raf);
    el.removeEventListener("scroll", update);
    globalThis.removeEventListener?.("resize", update);
    resizeObserver?.disconnect();
  };
}

/**
 * Computes the next slide element ID when pressing `Tab` or `Shift+Tab` while
 * the slide canvas has focus. Returns `undefined` at the boundary so focus
 * leaves the canvas cleanly without creating a keyboard trap.
 */
export function getNextCanvasElementId(
  elements: readonly { id: string }[],
  selectedId: string | null,
  shiftKey: boolean,
): string | undefined {
  if (elements.length === 0) return undefined;
  const currentIdx = selectedId
    ? elements.findIndex((el) => el.id === selectedId)
    : -1;
  if (!shiftKey) {
    if (currentIdx === -1) return elements[0]?.id;
    if (currentIdx < elements.length - 1) return elements[currentIdx + 1]?.id;
    return undefined;
  }
  if (currentIdx > 0) return elements[currentIdx - 1]?.id;
  return undefined;
}
