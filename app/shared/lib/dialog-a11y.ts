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
