import { Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { CellData, CellFormat, Sheet, Spreadsheet } from "../types";
import {
  addSheet,
  deleteSheet,
  getSpreadsheet,
  loadSpreadsheetFromApi,
  renameSheet,
  updateSpreadsheet,
} from "../lib/storage";
import { evaluateSheet, setCellValue } from "../lib/formula";
import { formatCellAddress, parseCellAddress } from "../lib/cell-utils";
import { parseCsv } from "../lib/csv-parser";
import { UndoRedoManager } from "../lib/history";
import { Grid } from "../components/Grid";
import { Toolbar } from "../components/Toolbar";
import { FormulaBar } from "../components/FormulaBar";
import { SheetTabs } from "../components/SheetTabs";
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

  /** Push a snapshot of the current sheet cells for undo. */
  const pushHistory = () => {
    const ss = spreadsheet();
    if (!ss) return;
    const sheet = ss.sheets.find((s) => s.id === ss.activeSheetId);
    if (!sheet) return;
    const mgr = getHistory(ss.activeSheetId);
    // Deep clone cells
    mgr.push(JSON.parse(JSON.stringify(sheet.cells)));
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
      activeSheet.cells = evaluateSheet(activeSheet);
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

    pushHistory();
    const address = selectedCell();
    const value = editValue();
    const updatedCells = setCellValue(sheet, address, value);
    updateCells(updatedCells);
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

    pushHistory();
    // Submit current value first
    const address = selectedCell();
    const value = editValue();
    const updatedCells = setCellValue(sheet, address, value);
    updateCells(updatedCells);
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

    pushHistory();
    const address = selectedCell();
    const cell = sheet.cells[address] ?? { value: "" };
    const updatedCells = {
      ...sheet.cells,
      [address]: {
        ...cell,
        format: { ...cell.format, ...format },
      },
    };
    updateCells(updatedCells);
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

    pushHistory();
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
    const evaluated = evaluateSheet({ ...sheet, cells: updatedCells });
    updateCells(evaluated);
  };

  // Keyboard shortcut handler for undo/redo
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
      newSheet.cells = evaluateSheet(newSheet);
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
    <div class="flex h-screen flex-col bg-neutral-900">
      <Show
        when={spreadsheet()}
        fallback={
          <div class="flex h-screen items-center justify-center text-neutral-500">
            {t("loading")}
          </div>
        }
      >
        {(ss) => (
          <>
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
          </>
        )}
      </Show>
    </div>
  );
};
