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
  let menuRef: HTMLDivElement | undefined;
  let menuOpener: HTMLElement | null = null;

  const handleContextMenu = (e: MouseEvent, sheetId: string) => {
    e.preventDefault();
    menuOpener = e.currentTarget instanceof HTMLElement
      ? e.currentTarget
      : (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setContextMenu({ x: e.clientX, y: e.clientY, sheetId });
  };

  const closeContextMenu = (restoreFocus = false) => {
    setContextMenu(null);
    const opener = menuOpener;
    menuOpener = null;
    if (restoreFocus && opener?.isConnected) {
      queueMicrotask(() => {
        if (opener.isConnected) opener.focus();
      });
    }
  };

  createEffect(() => {
    if (!contextMenu()) return;
    queueMicrotask(() => {
      menuRef?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef && e.target instanceof Node && menuRef.contains(e.target)) {
        return;
      }
      closeContextMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeContextMenu(true);
        return;
      }
      if (e.key === "Tab") {
        closeContextMenu();
        return;
      }
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Home" ||
        e.key === "End"
      ) {
        const items = Array.from(
          menuRef?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
        );
        if (items.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const activeIdx = items.indexOf(document.activeElement as HTMLElement);
        let nextIdx = 0;
        if (e.key === "ArrowDown") {
          nextIdx = activeIdx >= 0 ? (activeIdx + 1) % items.length : 0;
        } else if (e.key === "ArrowUp") {
          nextIdx = activeIdx >= 0
            ? (activeIdx - 1 + items.length) % items.length
            : items.length - 1;
        } else if (e.key === "Home") {
          nextIdx = 0;
        } else {
          nextIdx = items.length - 1;
        }
        items[nextIdx]?.focus();
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
      class="flex min-h-10 sm:h-8 items-center overflow-x-auto border-t border-gray-200 bg-gray-50 px-1 dark:border-neutral-700 dark:bg-neutral-800"
      onClick={handleWindowClick}
    >
      <For each={props.spreadsheet.sheets}>
        {(sheet) => (
          <Show
            when={renamingId() === sheet.id}
            fallback={
              <button
                type="button"
                class={`mr-0.5 flex min-h-8 sm:h-6 shrink-0 items-center rounded px-3 text-xs transition-colors ${
                  sheet.id === props.activeSheetId
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-neutral-700 dark:text-neutral-100 dark:ring-0 dark:shadow-none"
                    : "text-gray-600 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-300 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-100"
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
        class="flex h-8 w-8 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
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
            ref={menuRef}
            role="menu"
            class="context-menu"
            style={{
              left: `${Math.max(8, Math.min(menu().x, globalThis.innerWidth - 150))}px`,
              top: `${Math.max(8, menu().y - 84)}px`,
            }}
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
