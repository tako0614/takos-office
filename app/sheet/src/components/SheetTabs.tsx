import { Component, createSignal, For, Show } from "solid-js";
import type { Sheet, Spreadsheet } from "../types";
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
      class="flex h-8 items-center border-t border-neutral-700 bg-neutral-800 px-1"
      onClick={handleWindowClick}
    >
      <For each={props.spreadsheet.sheets}>
        {(sheet) => (
          <Show
            when={renamingId() === sheet.id}
            fallback={
              <button
                type="button"
                class={`mr-0.5 flex h-6 items-center rounded px-3 text-xs transition-colors ${
                  sheet.id === props.activeSheetId
                    ? "bg-neutral-700 text-neutral-100"
                    : "text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200"
                }`}
                onClick={() => props.onSwitchSheet(sheet.id)}
                onContextMenu={(e) => handleContextMenu(e, sheet.id)}
              >
                {sheet.name}
              </button>
            }
          >
            <input
              class="mr-0.5 h-6 w-24 rounded bg-neutral-700 px-2 text-xs text-neutral-100 outline-none ring-1 ring-blue-500"
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
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
        class="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        onClick={props.onAddSheet}
        title={t("addSheet")}
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
            class="context-menu"
            style={{
              left: `${menu().x}px`,
              top: `${menu().y - 80}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              class="context-menu-item"
              onClick={() => {
                const sheet = props.spreadsheet.sheets.find(
                  (s) => s.id === menu().sheetId,
                );
                if (sheet) startRename(sheet);
              }}
            >
              {t("rename")}
            </div>
            <Show when={props.spreadsheet.sheets.length > 1}>
              <div
                class="context-menu-item text-red-400"
                onClick={() => handleDelete(menu().sheetId)}
              >
                {t("delete")}
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
};
