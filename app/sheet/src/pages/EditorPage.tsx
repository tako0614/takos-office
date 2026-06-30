import { Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { CellData, CellFormat, Sheet, Spreadsheet } from "../types";
import {
  addSheet,
  deleteSheet,
  getSpreadsheet,
  loadSpreadsheetFromApi,
  renameSheet,
  SpreadsheetConflictError,
  updateSpreadsheet,
} from "../lib/storage";
import {
  evaluateSheet,
  setCellValue,
  shiftSheetStructure,
  type StructuralOp,
} from "../lib/formula";
import {
  computeUsedRange,
  formatCellAddress,
  parseCellAddress,
} from "../lib/cell-utils";
import { sortRangeRows } from "../lib/sheet-ops";
import { parseCsv } from "../lib/csv-parser";
import { UndoRedoManager } from "../lib/history";
import { Grid } from "../components/Grid";
import { Toolbar } from "../components/Toolbar";
import { FormulaBar } from "../components/FormulaBar";
import { SheetTabs } from "../components/SheetTabs";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import OfficeNav from "../components/OfficeNav";
import { useI18n } from "../i18n";

export const EditorPage: Component = () => {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [spreadsheet, setSpreadsheet] = createSignal<Spreadsheet | null>(null);
  const [selectedCell, setSelectedCell] = createSignal("A1");
  const [selectionRange, setSelectionRange] = createSignal<
    {
      start: string;
      end: string;
    } | null
  >(null);
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  const [showShortcuts, setShowShortcuts] = createSignal(false);

  // Undo/redo managers keyed by sheet id
  const historyManagers = new Map<
    string,
    UndoRedoManager<Record<string, CellData>>
  >();
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);

  const getHistory = (
    sheetId: string,
  ): UndoRedoManager<Record<string, CellData>> => {
    let mgr = historyManagers.get(sheetId);
    if (!mgr) {
      mgr = new UndoRedoManager<Record<string, CellData>>(50);
      historyManagers.set(sheetId, mgr);
    }
    return mgr;
  };

  const refreshUndoRedo = () => {
    const ss = spreadsheet();
    if (!ss) return;
    const mgr = getHistory(ss.activeSheetId);
    setCanUndo(mgr.canUndo());
    setCanRedo(mgr.canRedo());
  };

  /**
   * Apply new cells and record them as the next undo checkpoint. The snapshot
   * is taken AFTER the mutation (the initial state is seeded on load), so
   * redo restores the edit instead of replaying a stale pre-edit copy.
   */
  const commitCells = (cells: Record<string, CellData>) => {
    updateCells(cells);
    const ss = spreadsheet();
    if (!ss) return;
    const mgr = getHistory(ss.activeSheetId);
    mgr.push(JSON.parse(JSON.stringify(cells)));
    refreshUndoRedo();
  };

  // Load spreadsheet on mount
  onMount(() => {
    void loadSpreadsheetFromApi(params.id)
      .then((remote) => setSpreadsheetForEditing(remote))
      .catch(() => {
        if (!spreadsheet()) navigate("/");
      });

    // Register undo/redo keyboard shortcuts
    document.addEventListener("keydown", handleGlobalKeyDown);
  });

  const setSpreadsheetForEditing = (ss: Spreadsheet) => {
    // Evaluate all formulas on load
    const activeSheet = ss.sheets.find((s) => s.id === ss.activeSheetId) ??
      ss.sheets[0];
    if (activeSheet) {
      activeSheet.cells = evaluateSheet(activeSheet, ss.sheets);
      // Seed undo history with the initial state
      const mgr = getHistory(activeSheet.id);
      mgr.push(JSON.parse(JSON.stringify(activeSheet.cells)));
    }
    setSpreadsheet(ss);
    refreshUndoRedo();
  };

  onCleanup(() => {
    document.removeEventListener("keydown", handleGlobalKeyDown);
  });

  // Get active sheet
  const activeSheet = (): Sheet | null => {
    const ss = spreadsheet();
    if (!ss) return null;
    return ss.sheets.find((s) => s.id === ss.activeSheetId) ?? ss.sheets[0] ??
      null;
  };

  // Get selected cell data
  const selectedCellData = (): CellData | undefined => {
    const sheet = activeSheet();
    if (!sheet) return undefined;
    return sheet.cells[selectedCell()];
  };

  // Save spreadsheet to localStorage
  const save = (ss: Spreadsheet) => {
    setSpreadsheet({ ...ss });
    void updateSpreadsheet(ss).catch((error) => {
      if (error instanceof SpreadsheetConflictError) {
        // Another writer (e.g. an agent over MCP) changed the spreadsheet
        // between our load and this autosave. Adopt their version instead of
        // silently overwriting it; the editor reloads from the refreshed copy.
        setSpreadsheetForEditing(error.current);
        return;
      }
      console.error("[takos-excel] Failed to save spreadsheet", error);
    });
  };

  // Update cells in active sheet
  const updateCells = (cells: Record<string, CellData>) => {
    const ss = spreadsheet();
    if (!ss) return;
    const updated = {
      ...ss,
      sheets: ss.sheets.map((s) =>
        s.id === ss.activeSheetId ? { ...s, cells } : s
      ),
    };
    save(updated);
  };

  // Handle cell selection
  const handleSelectCell = (address: string) => {
    setSelectedCell(address);
    if (!isEditing()) {
      const cell = activeSheet()?.cells[address];
      setEditValue(cell?.value ?? "");
    }
  };

  // Start editing a cell
  const handleStartEdit = (address: string, value?: string) => {
    setSelectedCell(address);
    setIsEditing(true);
    setEditValue(value ?? "");
  };

  // Submit cell edit
  const handleSubmitEdit = () => {
    const sheet = activeSheet();
    if (!sheet) return;

    const address = selectedCell();
    const value = editValue();
    const updatedCells = setCellValue(sheet, address, value, spreadsheet()?.sheets);
    commitCells(updatedCells);
    setIsEditing(false);

    // Move down after submit
    try {
      const { col, row } = parseCellAddress(address);
      const newAddr = formatCellAddress(col, row + 1);
      setSelectedCell(newAddr);
      const newCell = sheet.cells[newAddr];
      setEditValue(newCell?.value ?? "");
    } catch {
      // stay in place
    }
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setIsEditing(false);
    const cell = selectedCellData();
    setEditValue(cell?.value ?? "");
  };

  // Tab in editor
  const handleTabEdit = (shiftKey: boolean) => {
    const sheet = activeSheet();
    if (!sheet) return;

    // Submit current value first
    const address = selectedCell();
    const value = editValue();
    const updatedCells = setCellValue(sheet, address, value, spreadsheet()?.sheets);
    commitCells(updatedCells);
    setIsEditing(false);

    // Move to next/prev cell
    try {
      const { col, row } = parseCellAddress(address);
      const newCol = shiftKey ? Math.max(0, col - 1) : col + 1;
      const newAddr = formatCellAddress(newCol, row);
      setSelectedCell(newAddr);
      const newCell = sheet.cells[newAddr];
      setEditValue(newCell?.value ?? "");
    } catch {
      // stay in place
    }
  };

  // Formula bar value change
  const handleFormulaBarChange = (value: string) => {
    setEditValue(value);
    if (!isEditing()) {
      setIsEditing(true);
    }
  };

  // Formula bar submit
  const handleFormulaBarSubmit = () => {
    handleSubmitEdit();
  };

  // Format change
  const handleFormatChange = (format: Partial<CellFormat>) => {
    const sheet = activeSheet();
    if (!sheet) return;

    const address = selectedCell();
    const cell = sheet.cells[address] ?? { value: "" };
    const updatedCells = {
      ...sheet.cells,
      [address]: {
        ...cell,
        format: { ...cell.format, ...format },
      },
    };
    commitCells(updatedCells);
  };

  // Title change
  const handleTitleChange = (title: string) => {
    const ss = spreadsheet();
    if (!ss) return;
    save({ ...ss, title });
  };

  // Undo
  const handleUndo = () => {
    const ss = spreadsheet();
    if (!ss) return;
    const mgr = getHistory(ss.activeSheetId);
    const prev = mgr.undo();
    if (prev) {
      updateCells(JSON.parse(JSON.stringify(prev)));
      refreshUndoRedo();
    }
  };

  // Redo
  const handleRedo = () => {
    const ss = spreadsheet();
    if (!ss) return;
    const mgr = getHistory(ss.activeSheetId);
    const next = mgr.redo();
    if (next) {
      updateCells(JSON.parse(JSON.stringify(next)));
      refreshUndoRedo();
    }
  };

  // Import CSV into current sheet
  const handleImportCsv = (content: string) => {
    const sheet = activeSheet();
    if (!sheet) return;

    const rows = parseCsv(content);
    const updatedCells = { ...sheet.cells };
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const addr = formatCellAddress(c, r);
        const existing = updatedCells[addr];
        updatedCells[addr] = {
          ...existing,
          value: rows[r][c],
          format: existing?.format,
        };
      }
    }
    const evaluated = evaluateSheet({ ...sheet, cells: updatedCells }, spreadsheet()?.sheets);
    commitCells(evaluated);
  };

  // Insert / delete rows & columns at the selected cell, adjusting formula
  // references via HyperFormula (whole workbook loaded for cross-sheet refs).
  const applyStructuralOp = (op: StructuralOp) => {
    const ss = spreadsheet();
    const sheet = activeSheet();
    if (!ss || !sheet) return;
    try {
      const { col, row } = parseCellAddress(selectedCell());
      const at = op === "insertRows" || op === "deleteRows" ? row : col;
      // shiftSheetStructure returns adjusted cells for EVERY sheet (the target
      // shifts; other sheets' cross-sheet refs are re-pointed). Apply all of
      // them, then re-evaluate each against the updated workbook so references
      // resolve to their new positions.
      const shifted = shiftSheetStructure(sheet, op, at, 1, ss.sheets);
      const applied = ss.sheets.map((s) => {
        const cells = shifted.get(s.id);
        return cells ? { ...s, cells } : s;
      });
      const evaluatedSheets = applied.map((s) => ({
        ...s,
        cells: evaluateSheet(s, applied),
      }));
      save({ ...ss, sheets: evaluatedSheets });
      // Record undo history for the active sheet (undo is per active sheet).
      const active = evaluatedSheets.find((s) => s.id === ss.activeSheetId);
      if (active) {
        getHistory(ss.activeSheetId).push(
          JSON.parse(JSON.stringify(active.cells)),
        );
        refreshUndoRedo();
      }
    } catch {
      // Out-of-bounds selection: no-op.
    }
  };

  const handleInsertRow = () => applyStructuralOp("insertRows");
  const handleDeleteRow = () => applyStructuralOp("deleteRows");
  const handleInsertColumn = () => applyStructuralOp("insertColumns");
  const handleDeleteColumn = () => applyStructuralOp("deleteColumns");

  // Sort the used range by the selected cell's column.
  const handleSort = (direction: "asc" | "desc") => {
    const ss = spreadsheet();
    const sheet = activeSheet();
    if (!ss || !sheet) return;
    const used = computeUsedRange(sheet.cells);
    if (used.range === null) return;
    try {
      const { col } = parseCellAddress(selectedCell());
      const columnIndex = Math.min(
        Math.max(col - used.startCol, 0),
        used.endCol - used.startCol,
      );
      const sorted = sortRangeRows(
        sheet.cells,
        {
          startCol: used.startCol,
          startRow: used.startRow,
          endCol: used.endCol,
          endRow: used.endRow,
        },
        columnIndex,
        direction,
      );
      const evaluated = evaluateSheet({ ...sheet, cells: sorted }, ss.sheets);
      commitCells(evaluated);
    } catch {
      // No-op on bad selection.
    }
  };

  // View-only column filter on the selected column (row 0 stays as a header).
  const setActiveSheetFilter = (filter: Sheet["filter"]) => {
    const ss = spreadsheet();
    const sheet = activeSheet();
    if (!ss || !sheet) return;
    save({
      ...ss,
      sheets: ss.sheets.map((s) => (s.id === sheet.id ? { ...s, filter } : s)),
    });
  };
  const handleApplyFilter = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setActiveSheetFilter(undefined);
      return;
    }
    try {
      const { col } = parseCellAddress(selectedCell());
      setActiveSheetFilter({ column: col, query: trimmed });
    } catch {
      // ignore bad selection
    }
  };
  const handleClearFilter = () => setActiveSheetFilter(undefined);

  // True when keyboard focus is in a text input / textarea / select / editable
  // element, so global single-key shortcuts (like `?`) don't hijack typing.
  const isTypingTarget = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable === true
    );
  };

  // Keyboard shortcut handler for undo/redo + shortcut help.
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
    } else if (
      ((e.ctrlKey || e.metaKey) && e.key === "y") ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z")
    ) {
      e.preventDefault();
      handleRedo();
    } else if (
      e.key === "?" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !isEditing() &&
      !isTypingTarget(e.target)
    ) {
      // Shift+/ opens the keyboard-shortcut help.
      e.preventDefault();
      setShowShortcuts(true);
    }
  };

  // Sheet operations
  const handleSwitchSheet = (sheetId: string) => {
    const ss = spreadsheet();
    if (!ss) return;
    const updated = { ...ss, activeSheetId: sheetId };
    // Evaluate formulas for the new sheet
    const newSheet = updated.sheets.find((s) => s.id === sheetId);
    if (newSheet) {
      newSheet.cells = evaluateSheet(newSheet, updated.sheets);
      // Seed undo history for this sheet if not already present
      const mgr = getHistory(sheetId);
      if (!mgr.canUndo() && !mgr.canRedo()) {
        mgr.push(JSON.parse(JSON.stringify(newSheet.cells)));
      }
    }
    save(updated);
    setSelectedCell("A1");
    setEditValue("");
    setIsEditing(false);
    refreshUndoRedo();
  };

  const handleAddSheet = () => {
    const ss = spreadsheet();
    if (!ss) return;
    const result = addSheet(
      ss.id,
      t("newSheetName", { number: ss.sheets.length + 1 }),
    );
    const newSheet = result.value;
    void result.remote.catch((error) => {
      console.error("[takos-excel] Failed to add sheet", error);
    });
    if (newSheet) {
      const reloaded = getSpreadsheet(ss.id);
      if (reloaded) {
        setSpreadsheet(reloaded);
        setSelectedCell("A1");
        setEditValue("");
      }
    }
  };

  const handleRenameSheet = (sheetId: string, newName: string) => {
    const ss = spreadsheet();
    if (!ss) return;
    const result = renameSheet(ss.id, sheetId, newName);
    void result.remote.catch((error) => {
      console.error("[takos-excel] Failed to rename sheet", error);
    });
    const reloaded = getSpreadsheet(ss.id);
    if (reloaded) setSpreadsheet(reloaded);
  };

  const handleDeleteSheet = (sheetId: string) => {
    const ss = spreadsheet();
    if (!ss) return;
    if (ss.sheets.length <= 1) return;
    if (confirm(t("deleteSheetConfirm"))) {
      const result = deleteSheet(ss.id, sheetId);
      void result.remote.catch((error) => {
        console.error("[takos-excel] Failed to delete sheet", error);
      });
      const reloaded = getSpreadsheet(ss.id);
      if (reloaded) {
        setSpreadsheet(reloaded);
        setSelectedCell("A1");
        setEditValue("");
      }
    }
  };

  // Column width change
  const handleColWidthChange = (colIndex: number, width: number) => {
    const ss = spreadsheet();
    if (!ss) return;
    const updated = {
      ...ss,
      sheets: ss.sheets.map((s) =>
        s.id === ss.activeSheetId
          ? { ...s, colWidths: { ...s.colWidths, [colIndex]: width } }
          : s
      ),
    };
    save(updated);
  };

  return (
    <div class="flex h-screen flex-col bg-white dark:bg-neutral-900">
      <Show
        when={spreadsheet()}
        fallback={
          <div class="flex h-screen items-center justify-center text-gray-500 dark:text-neutral-500">
            {t("loading")}
          </div>
        }
      >
        {(ss) => (
          <>
            {/* Office nav - return to the shell / switch apps from inside a sheet */}
            <div class="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
              <OfficeNav />
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                onClick={() => setShowShortcuts(true)}
                aria-label={t("shortcutsOpen")}
                title={t("shortcutsOpen")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </button>
            </div>

            {/* Toolbar */}
            <Toolbar
              format={selectedCellData()?.format}
              onFormatChange={handleFormatChange}
              title={ss().title}
              onTitleChange={handleTitleChange}
              onNavigateHome={() => navigate("/")}
              onImportCsv={handleImportCsv}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo()}
              canRedo={canRedo()}
              onInsertRow={handleInsertRow}
              onDeleteRow={handleDeleteRow}
              onInsertColumn={handleInsertColumn}
              onDeleteColumn={handleDeleteColumn}
              onSortAsc={() => handleSort("asc")}
              onSortDesc={() => handleSort("desc")}
              onApplyFilter={handleApplyFilter}
              onClearFilter={handleClearFilter}
              filterActive={!!activeSheet()?.filter}
            />

            {/* Formula Bar */}
            <FormulaBar
              cellAddress={selectedCell()}
              value={editValue()}
              onValueChange={handleFormulaBarChange}
              onSubmit={handleFormulaBarSubmit}
              onCancel={handleCancelEdit}
            />

            {/* Grid */}
            <Show when={activeSheet()}>
              {(sheet) => (
                <Grid
                  sheet={sheet()}
                  selectedCell={selectedCell()}
                  selectionRange={selectionRange()}
                  isEditing={isEditing()}
                  editValue={editValue()}
                  onSelectCell={handleSelectCell}
                  onStartEdit={handleStartEdit}
                  onEditChange={setEditValue}
                  onSubmitEdit={handleSubmitEdit}
                  onCancelEdit={handleCancelEdit}
                  onTabEdit={handleTabEdit}
                  onSelectionRange={setSelectionRange}
                  onColWidthChange={handleColWidthChange}
                />
              )}
            </Show>

            {/* Sheet Tabs */}
            <SheetTabs
              spreadsheet={ss()}
              activeSheetId={ss().activeSheetId}
              onSwitchSheet={handleSwitchSheet}
              onAddSheet={handleAddSheet}
              onRenameSheet={handleRenameSheet}
              onDeleteSheet={handleDeleteSheet}
            />

            {/* Keyboard-shortcut help modal */}
            <Show when={showShortcuts()}>
              <ShortcutsHelp onClose={() => setShowShortcuts(false)} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};
