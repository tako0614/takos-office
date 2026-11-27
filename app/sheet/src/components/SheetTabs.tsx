import { Component, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Sheet, Spreadsheet } from "../types";
import { isImeComposing } from "../../../shared/lib/dialog-a11y";
import { useI18n } from "../i18n";

interface SheetTabsProps {
  spreadsheet: Spreadsheet;
  activeSheetId: string;
  onSwitchSheet: (sheetId: string) => void;
  onAddSheet: () => void;
  onRenameSheet: (sheetId: string, newName: string) => void;
  onDeleteSheet: (sheetId: string) => void;
}

export const SheetTabs: Component<SheetTabsProps> = (props) => {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = createSignal<
    {
      x: number;
      y: number;
      sheetId: string;
    } | null
  >(null);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");

  const handleContextMenu = (e: MouseEvent, sheetId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sheetId });
  };

  const closeContextMenu = () => setContextMenu(null);

  createEffect(() => {
    if (!contextMenu()) return;
    const onPointerDown = () => closeContextMenu();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeContextMenu();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  const startRename = (sheet: Sheet) => {
    setRenamingId(sheet.id);
    setRenameValue(sheet.name);
    closeContextMenu();
  };

  const finishRename = () => {
    const id = renamingId();
    const value = renameValue().trim();
    if (id && value) {
      props.onRenameSheet(id, value);
    }
    setRenamingId(null);
  };

  const handleDelete = (sheetId: string) => {
    closeContextMenu();
    if (props.spreadsheet.sheets.length > 1) {
      props.onDeleteSheet(sheetId);
    }
  };

  // Close context menu when clicking outside
  const handleWindowClick = () => closeContextMenu();

  return (
    <div
      class="flex h-8 items-center overflow-x-auto border-t border-gray-200 bg-gray-50 px-1 dark:border-neutral-700 dark:bg-neutral-800"
      onClick={handleWindowClick}
    >
      <For each={props.spreadsheet.sheets}>
        {(sheet) => (
          <Show
            when={renamingId() === sheet.id}
            fallback={
              <button
                type="button"
                class={`mr-0.5 flex h-6 shrink-0 items-center rounded px-3 text-xs transition-colors ${
                  sheet.id === props.activeSheetId
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-neutral-700 dark:text-neutral-100 dark:ring-0 dark:shadow-none"
                    : "text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-200"
                }`}
                onClick={() => props.onSwitchSheet(sheet.id)}
                onContextMenu={(e) => handleContextMenu(e, sheet.id)}
              >
                {sheet.name}
              </button>
            }
          >
            <input
              class="mr-0.5 h-6 w-24 shrink-0 rounded bg-white px-2 text-xs text-gray-900 outline-none ring-1 ring-blue-500 dark:bg-neutral-700 dark:text-neutral-100"
              aria-label={t("renameSheet")}
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") finishRename();
                if (e.key === "Escape") setRenamingId(null);
              }}
              ref={(el) => setTimeout(() => el.focus(), 0)}
            />
          </Show>
        )}
      </For>

      {/* Add sheet button */}
      <button
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        onClick={props.onAddSheet}
        title={t("addSheet")}
        aria-label={t("addSheet")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {/* Context menu */}
      <Show when={contextMenu()}>
        {(menu) => (
          <div
            role="menu"
            class="context-menu"
            style={{
              left: `${Math.min(menu().x, Math.max(8, globalThis.innerWidth - 150))}px`,
              top: `${Math.max(8, menu().y - 84)}px`,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              class="context-menu-item w-full text-left"
              onClick={() => {
                const sheet = props.spreadsheet.sheets.find(
                  (s) => s.id === menu().sheetId,
                );
                if (sheet) startRename(sheet);
              }}
            >
              {t("rename")}
            </button>
            <Show when={props.spreadsheet.sheets.length > 1}>
              <button
                type="button"
                role="menuitem"
                class="context-menu-item w-full text-left text-red-600 dark:text-red-400"
                onClick={() => handleDelete(menu().sheetId)}
              >
                {t("delete")}
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};
