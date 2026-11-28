import { Component, createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
  let tablistRef: HTMLDivElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let menuOpener: HTMLElement | null = null;

  const sheetIds = createMemo(() => props.spreadsheet.sheets.map((s) => s.id));
  const sheetById = (id: string) =>
    props.spreadsheet.sheets.find((s) => s.id === id);
  const activeSheet = () => sheetById(props.activeSheetId);

  const focusTabById = (sheetId: string | null) => {
    queueMicrotask(() => {
      const tabs = Array.from(
        tablistRef?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
      );
      const idx = sheetId
        ? props.spreadsheet.sheets.findIndex((s) => s.id === sheetId)
        : -1;
      const target = idx >= 0
        ? tabs[idx]
        : tablistRef?.querySelector<HTMLElement>(
          '[role="tab"][aria-selected="true"]',
        );
      target?.focus();
    });
  };

  const handleTabKeyDown = (
    e: KeyboardEvent,
    sheetId: string,
    index: number,
  ) => {
    if (isImeComposing(e)) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      openMenuAtElement(e.currentTarget as HTMLElement, sheetId);
      return;
    }
    if (
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.key === "ArrowRight" ||
        e.key === "ArrowLeft" ||
        e.key === "Home" ||
        e.key === "End")
    ) {
      const sheets = props.spreadsheet.sheets;
      if (sheets.length === 0) return;
      e.preventDefault();
      let nextIdx = index;
      if (e.key === "ArrowRight") {
        nextIdx = (index + 1) % sheets.length;
      } else if (e.key === "ArrowLeft") {
        nextIdx = (index - 1 + sheets.length) % sheets.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else {
        nextIdx = sheets.length - 1;
      }
      const nextSheet = sheets[nextIdx];
      if (!nextSheet) return;
      props.onSwitchSheet(nextSheet.id);
      queueMicrotask(() => {
        const tabs = tablistRef?.querySelectorAll<HTMLElement>('[role="tab"]');
        tabs?.[nextIdx]?.focus();
      });
    }
  };

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
    const activeMenu = contextMenu();
    if (!activeMenu) return;
    queueMicrotask(() => {
      menuRef?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef && e.target instanceof Node && menuRef.contains(e.target)) {
        return;
      }
      if (
        e.target instanceof Element &&
        e.target.closest("[data-sheet-menu-trigger]")?.getAttribute(
          "data-sheet-menu-trigger",
        ) === activeMenu.sheetId
      ) {
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
        e.preventDefault();
        closeContextMenu(true);
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

  const openMenuAtElement = (trigger: HTMLElement, sheetId: string) => {
    const rect = trigger.getBoundingClientRect();
    menuOpener = trigger;
    setContextMenu({ x: rect.left, y: rect.top, sheetId });
  };

  // Close context menu when clicking outside
  const handleWindowClick = () => closeContextMenu();

  return (
    <div
      class="flex min-h-11 sm:h-8 items-center gap-1 overflow-x-auto border-t border-gray-200 bg-gray-50 px-1 dark:border-neutral-700 dark:bg-neutral-800"
      onClick={handleWindowClick}
    >
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t("sheetTabsLabel")}
        class="flex items-center gap-0.5 shrink-0"
      >
        <For each={sheetIds()}>
          {(sheetId, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={sheetId === props.activeSheetId}
              tabIndex={sheetId === props.activeSheetId ? 0 : -1}
              class={`flex min-h-11 sm:min-h-6 sm:h-6 shrink-0 items-center rounded px-3 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                sheetId === props.activeSheetId
                  ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-neutral-700 dark:text-neutral-100 dark:ring-0 dark:shadow-none"
                  : "text-gray-600 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-300 dark:hover:bg-neutral-700/50 dark:hover:text-neutral-100"
              }`}
              onClick={() => props.onSwitchSheet(sheetId)}
              onContextMenu={(e) => handleContextMenu(e, sheetId)}
              onKeyDown={(e) => handleTabKeyDown(e, sheetId, index())}
            >
              {sheetById(sheetId)?.name ?? ""}
            </button>
          )}
        </For>
      </div>

      {/* Inline rename input (outside role="tablist" to preserve WAI-ARIA required children) */}
      <Show when={renamingId()}>
        <input
          class="h-9 sm:h-6 w-28 shrink-0 rounded bg-white px-2 text-xs text-gray-900 outline-none ring-1 ring-blue-500 dark:bg-neutral-700 dark:text-neutral-100"
          aria-label={t("renameSheet")}
          value={renameValue()}
          onInput={(e) => setRenameValue(e.currentTarget.value)}
          onBlur={finishRename}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") {
              const id = renamingId();
              e.preventDefault();
              finishRename();
              focusTabById(id);
            }
            if (e.key === "Escape") {
              const id = renamingId();
              e.preventDefault();
              setRenamingId(null);
              focusTabById(id);
            }
          }}
          ref={(el) => setTimeout(() => {
            el.focus();
            el.select();
          }, 0)}
        />
      </Show>

      {/* Active sheet actions menu trigger (outside role="tablist") */}
      <Show when={!renamingId() ? activeSheet() : undefined}>
        {(active) => (
          <button
            type="button"
            data-sheet-menu-trigger={active().id}
            aria-label={t("sheetActions", { name: active().name })}
            title={t("sheetActions", { name: active().name })}
            aria-haspopup="menu"
            aria-expanded={contextMenu()?.sheetId === active().id}
            class="flex h-11 w-11 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={(e) => {
              e.stopPropagation();
              if (contextMenu()?.sheetId === active().id) {
                closeContextMenu();
              } else {
                openMenuAtElement(e.currentTarget, active().id);
              }
            }}
          >
            ⋮
          </button>
        )}
      </Show>

      {/* Add sheet button */}
      <button
        type="button"
        class="flex h-11 w-11 sm:h-6 sm:w-6 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-gray-200 hover:text-gray-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
              top: `${Math.max(8, menu().y - ((globalThis.innerWidth ?? 1024) < 640 ? 112 : 84))}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              class="context-menu-item flex min-h-11 sm:min-h-8 w-full items-center text-left"
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
                class="context-menu-item flex min-h-11 sm:min-h-8 w-full items-center text-left text-red-600 dark:text-red-400"
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
