import { Component, For, onCleanup, onMount } from "solid-js";
import { useI18n } from "../i18n";

interface ShortcutsHelpProps {
  onClose: () => void;
}

/**
 * Keyboard-shortcut help modal. Lists the shortcuts the sheet editor actually
 * supports (cell navigation, edit/commit, undo/redo, etc. — see EditorPage and
 * Grid). Accessible: role="dialog" + aria-modal, Escape/backdrop/close-button
 * dismissal, and focus moved to the dialog on open.
 */
export const ShortcutsHelp: Component<ShortcutsHelpProps> = (props) => {
  const { t } = useI18n();
  let dialogRef: HTMLDivElement | undefined;

  const shortcuts: { labelKey: Parameters<typeof t>[0]; keysKey: Parameters<typeof t>[0] }[] = [
    { labelKey: "shortcutNavigate", keysKey: "shortcutNavigateKeys" },
    { labelKey: "shortcutExtendSelection", keysKey: "shortcutExtendSelectionKeys" },
    { labelKey: "shortcutEdit", keysKey: "shortcutEditKeys" },
    { labelKey: "shortcutType", keysKey: "shortcutTypeKeys" },
    { labelKey: "shortcutCommitDown", keysKey: "shortcutCommitDownKeys" },
    { labelKey: "shortcutCommitUp", keysKey: "shortcutCommitUpKeys" },
    { labelKey: "shortcutCommitNext", keysKey: "shortcutCommitNextKeys" },
    { labelKey: "shortcutCommitPrev", keysKey: "shortcutCommitPrevKeys" },
    { labelKey: "shortcutCancel", keysKey: "shortcutCancelKeys" },
    { labelKey: "shortcutClear", keysKey: "shortcutClearKeys" },
    { labelKey: "shortcutUndo", keysKey: "shortcutUndoKeys" },
    { labelKey: "shortcutRedo", keysKey: "shortcutRedoKeys" },
    { labelKey: "shortcutHelp", keysKey: "shortcutHelpKeys" },
  ];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    }
  };

  onMount(() => {
    dialogRef?.focus();
    document.addEventListener("keydown", handleKeyDown, true);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, true);
  });

  return (
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={() => props.onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("shortcutsHelp")}
        tabindex={-1}
        class="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl outline-none dark:border-neutral-700 dark:bg-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-neutral-100">
            {t("shortcuts")}
          </h2>
          <button
            type="button"
            class="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            onClick={() => props.onClose()}
            aria-label={t("shortcutsClose")}
            title={t("shortcutsClose")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
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
        <dl class="space-y-2">
          <For each={shortcuts}>
            {(s) => (
              <div class="flex items-center justify-between gap-4">
                <dt class="text-sm text-gray-700 dark:text-neutral-300">
                  {t(s.labelKey)}
                </dt>
                <dd>
                  <kbd class="rounded border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                    {t(s.keysKey)}
                  </kbd>
                </dd>
              </div>
            )}
          </For>
        </dl>
      </div>
    </div>
  );
};

export default ShortcutsHelp;
