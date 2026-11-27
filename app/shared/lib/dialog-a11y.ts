const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => {
      if (el.hasAttribute("disabled") || el.tabIndex === -1) return false;
      const style = globalThis.getComputedStyle?.(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) {
        return false;
      }
      return true;
    });
}

export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
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
    if (active === first || !active || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !active || !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

export function isRedoKeyEvent(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "key">): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  const key = event.key.toLowerCase();
  return key === "y" || (event.shiftKey && key === "z");
}

export function isUndoKeyEvent(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "key">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
}
