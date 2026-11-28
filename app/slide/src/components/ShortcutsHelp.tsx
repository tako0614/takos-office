import { createEffect, For, onCleanup } from "solid-js";
import { useI18n } from "../i18n";
import {
  acquireModalScrollLock,
  handleModalKeyDown,
  restoreFocus,
} from "../../../shared/lib/dialog-a11y";

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

type Row = { keys: string; descKey: ShortcutDescKey };

type ShortcutDescKey =
  | "shortcutCycleElements"
  | "shortcutDeleteElement"
  | "shortcutEditText"
  | "shortcutNudgeElement"
  | "shortcutReorderSlide"
  | "shortcutUndo"
  | "shortcutRedo"
  | "shortcutDeselect"
  | "shortcutNextSlide"
  | "shortcutPrevSlide"
  | "shortcutFirstSlide"
  | "shortcutLastSlide"
  | "shortcutExitPresent"
  | "shortcutOpenHelp";

// Grouped list of the keyboard shortcuts the editor / present mode actually
// handle (see EditorPage.tsx and PresentPage.tsx). Keep these in sync with the
// real key handlers.
const EDITOR_ROWS: Row[] = [
  { keys: "Tab / Shift + Tab", descKey: "shortcutCycleElements" },
  { keys: "Enter", descKey: "shortcutEditText" },
  { keys: "Arrow / Shift + Arrow", descKey: "shortcutNudgeElement" },
  { keys: "Alt + ↑ / ↓", descKey: "shortcutReorderSlide" },
  { keys: "Delete / Backspace", descKey: "shortcutDeleteElement" },
  { keys: "Ctrl/⌘ + Z", descKey: "shortcutUndo" },
  { keys: "Ctrl/⌘ + Shift + Z · Ctrl/⌘ + Y", descKey: "shortcutRedo" },
  { keys: "Esc", descKey: "shortcutDeselect" },
  { keys: "?", descKey: "shortcutOpenHelp" },
];

const PRESENT_ROWS: Row[] = [
  { keys: "→ / ↓ / Space / Enter", descKey: "shortcutNextSlide" },
  { keys: "← / ↑", descKey: "shortcutPrevSlide" },
  { keys: "Home", descKey: "shortcutFirstSlide" },
  { keys: "End", descKey: "shortcutLastSlide" },
  { keys: "Esc", descKey: "shortcutExitPresent" },
];

function ShortcutGroup(props: { title: string; rows: Row[] }) {
  const { t } = useI18n();
  return (
    <div class="space-y-1.5">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {props.title}
      </h3>
      <dl class="divide-y divide-gray-100 dark:divide-gray-700">
        <For each={props.rows}>
          {(row) => (
            <div class="flex items-center justify-between gap-4 py-1.5">
              <dt class="text-sm text-gray-700 dark:text-gray-300">
                {t(row.descKey)}
              </dt>
              <dd>
                <kbd class="rounded border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 whitespace-nowrap">
                  {row.keys}
                </kbd>
              </dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  );
}

export default function ShortcutsHelp(props: ShortcutsHelpProps) {
  const { t } = useI18n();
  let dialogRef: HTMLDivElement | undefined;
  let closeRef: HTMLButtonElement | undefined;
  let previouslyFocused: HTMLElement | null = null;
  let pointerDownOnBackdrop = false;

  // Close on Escape and trap focus within the dialog while it is open.
  const handleKeyDown = (e: KeyboardEvent) => {
    handleModalKeyDown(e, dialogRef, props.onClose);
  };

  createEffect(() => {
    if (!props.open) return;
    pointerDownOnBackdrop = false;
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const releaseScrollLock = acquireModalScrollLock();
    document.addEventListener("keydown", handleKeyDown, true);
    // Move focus into the dialog once it is mounted.
    queueMicrotask(() => closeRef?.focus());
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown, true);
      releaseScrollLock();
      const prev = previouslyFocused;
      previouslyFocused = null;
      queueMicrotask(() => restoreFocus(prev));
    });
  });

  return (
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        pointerDownOnBackdrop = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const started = pointerDownOnBackdrop;
        pointerDownOnBackdrop = false;
        if (started && e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcutsTitle")}
        tabIndex={-1}
        class="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("shortcutsTitle")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            class="inline-flex min-h-11 min-w-11 sm:min-h-8 sm:min-w-8 items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
            onClick={() => props.onClose()}
            aria-label={t("close")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="space-y-5">
          <ShortcutGroup title={t("shortcutsEditorGroup")} rows={EDITOR_ROWS} />
          <ShortcutGroup title={t("shortcutsPresentGroup")} rows={PRESENT_ROWS} />
        </div>
      </div>
    </div>
  );
}
