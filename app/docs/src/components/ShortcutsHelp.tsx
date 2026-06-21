import { For, onCleanup, onMount, Show } from "solid-js";
import { X } from "lucide-solid";
import { useI18n } from "../i18n";

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

type ShortcutKey =
  | "shortcutFindReplace"
  | "shortcutUndo"
  | "shortcutRedo"
  | "shortcutBold"
  | "shortcutItalic"
  | "shortcutUnderline"
  | "shortcutStrikethrough"
  | "shortcutSelectAll";

/**
 * Keyboard combos use the macOS ⌘ glyph where Ctrl/Cmd is interchangeable so
 * the help reads naturally on both platforms; `Ctrl` is shown alongside for
 * non-mac users. These mirror the shortcuts TipTap StarterKit + the Underline
 * extension register, plus the editor's custom Ctrl/Cmd+F find binding.
 */
const SHORTCUTS: { labelKey: ShortcutKey; keys: string }[] = [
  { labelKey: "shortcutFindReplace", keys: "Ctrl / ⌘ + F" },
  { labelKey: "shortcutUndo", keys: "Ctrl / ⌘ + Z" },
  { labelKey: "shortcutRedo", keys: "Ctrl / ⌘ + Shift + Z" },
  { labelKey: "shortcutBold", keys: "Ctrl / ⌘ + B" },
  { labelKey: "shortcutItalic", keys: "Ctrl / ⌘ + I" },
  { labelKey: "shortcutUnderline", keys: "Ctrl / ⌘ + U" },
  { labelKey: "shortcutStrikethrough", keys: "Ctrl / ⌘ + Shift + S" },
  { labelKey: "shortcutSelectAll", keys: "Ctrl / ⌘ + A" },
];

export default function ShortcutsHelp(props: ShortcutsHelpProps) {
  const { t } = useI18n();
  let dialogRef: HTMLDivElement | undefined;

  // Close on Escape and move focus into the dialog when it opens.
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (props.open && e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    };
    globalThis.addEventListener("keydown", handler);
    onCleanup(() => globalThis.removeEventListener("keydown", handler));
  });

  const focusDialog = (el: HTMLDivElement) => {
    dialogRef = el;
    queueMicrotask(() => dialogRef?.focus());
  };

  return (
    <Show when={props.open}>
      {/* Backdrop — click to dismiss */}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4"
        onClick={props.onClose}
      >
        <div
          ref={focusDialog}
          role="dialog"
          aria-modal="true"
          aria-label={t("shortcutsTitle")}
          tabindex="-1"
          class="w-full max-w-md rounded-xl bg-white dark:bg-neutral-900 text-gray-800 dark:text-neutral-100 shadow-xl border border-gray-200 dark:border-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-neutral-700">
            <h2 class="text-base font-medium">{t("shortcutsTitle")}</h2>
            <button
              type="button"
              class="p-1.5 rounded-full text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              onClick={props.onClose}
              title={t("shortcutClose")}
              aria-label={t("shortcutClose")}
            >
              <X size={18} />
            </button>
          </div>

          <ul class="px-5 py-3 divide-y divide-gray-100 dark:divide-neutral-800">
            <For each={SHORTCUTS}>
              {(s) => (
                <li class="flex items-center justify-between gap-4 py-2">
                  <span class="text-sm text-gray-700 dark:text-neutral-200">
                    {t(s.labelKey)}
                  </span>
                  <kbd class="shrink-0 rounded-md border border-gray-300 dark:border-neutral-600 bg-gray-50 dark:bg-neutral-800 px-2 py-1 text-xs font-mono text-gray-600 dark:text-neutral-300">
                    {s.keys}
                  </kbd>
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Show>
  );
}
