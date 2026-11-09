import { expect, test } from "bun:test";
import { UndoRedoManager, WorkbookHistory } from "../lib/history.ts";
import { evaluateSheet, shiftSheetStructure, type StructuralOp } from "../lib/formula.ts";
import type { Spreadsheet } from "../types/index.ts";

function workbook(): Spreadsheet {
  return {
    id: "workbook", title: "Related sheets", activeSheetId: "first", createdAt: "created", updatedAt: "revision",
    sheets: [
      { id: "first", name: "First", cells: { B2: { value: "10" } }, colWidths: {}, rowHeights: {} },
      { id: "second", name: "Second", cells: { A1: { value: "=First!B2" } }, colWidths: {}, rowHeights: {} },
    ],
  };
}

for (const operation of ["insertRows", "deleteRows", "insertColumns", "deleteColumns"] satisfies StructuralOp[]) {
  test(`workbook Undo/Redo restores all references after ${operation}`, () => {
    const before = workbook(), history = new WorkbookHistory();
    history.reset(before);
    const shifted = shiftSheetStructure(before.sheets[0], operation, 0, 1, before.sheets);
    const applied = before.sheets.map(sheet => ({ ...sheet, cells: shifted.get(sheet.id)! }));
    const after = { ...before, sheets: applied.map(sheet => ({ ...sheet, cells: evaluateSheet(sheet, applied) })) };
    expect(after.sheets[1].cells.A1.value).not.toBe(before.sheets[1].cells.A1.value);
    history.push(after);
    expect(history.undo()).toEqual(before);
    expect(history.redo()).toEqual(after);
  });
}

test("edits on another sheet are undone before an older structural change", () => {
  const original = workbook(), history = new WorkbookHistory();history.reset(original);
  const shifted = shiftSheetStructure(original.sheets[0], "insertRows", 0, 1, original.sheets);
  const inserted = { ...original, sheets: original.sheets.map(sheet => ({ ...sheet, cells: shifted.get(sheet.id)! })) };
  history.push(inserted);
  const later = structuredClone(inserted);later.activeSheetId = "second";later.sheets[1].cells.B1 = { value: "new draft" };
  history.push(later);
  const undoneEdit = history.undo()!;
  expect(undoneEdit).toEqual(inserted);
  expect(undoneEdit.sheets[1].cells.A1.value).toBe("=First!B3");
  expect(history.undo()).toEqual(original);
  expect(history.redo()).toEqual(inserted);
  expect(history.redo()).toEqual(later);
});

test("workbook checkpoints are isolated from later evaluation and returned snapshot mutation", () => {
  const original = workbook(), expected = structuredClone(original), history = new WorkbookHistory();history.reset(original);
  const edited = structuredClone(original);edited.sheets[0].cells.B2.value = "20";history.push(edited);
  original.sheets[1].cells.A1.value = "changed after capture";
  edited.sheets[0].cells.B2.value = "changed after edit";
  const restored = history.undo()!;expect(restored).toEqual(expected);
  restored.sheets.length = 0;
  expect(history.redo()!.sheets[0].cells.B2.value).toBe("20");
  expect(history.undo()).toEqual(expected);
});

test("sheet creation, metadata and edits share one chronological history; a new edit retires Redo", () => {
  const original = workbook(), history = new WorkbookHistory();history.reset(original);
  const appended = structuredClone(original);appended.sheets.push({ id: "third", name: "Third", cells: {}, colWidths: {}, rowHeights: {} });appended.activeSheetId = "third";history.push(appended);
  const renamed = structuredClone(appended);renamed.title = "Renamed book";renamed.sheets[0].name = "Renamed sheet";renamed.sheets[0].colWidths[0] = 200;history.push(renamed);
  expect(history.undo()).toEqual(appended);
  expect(history.undo()).toEqual(original);
  history.push({ ...original, title: "new branch" });
  expect(history.canRedo()).toBe(false);expect(history.redo()).toBeNull();
  history.reset({ ...original, id: "other book" });
  expect(history.canUndo()).toBe(false);expect(history.canRedo()).toBe(false);
});

test("new manager has nothing to undo or redo", () => {
  const mgr = new UndoRedoManager<string>();
  expect(mgr.canUndo()).toEqual(false);
  expect(mgr.canRedo()).toEqual(false);
});

test("undo returns null on empty manager", () => {
  const mgr = new UndoRedoManager<string>();
  expect(mgr.undo()).toEqual(null);
});

test("redo returns null on empty manager", () => {
  const mgr = new UndoRedoManager<string>();
  expect(mgr.redo()).toEqual(null);
});

test("push then undo retrieves previous state", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("state-0");
  mgr.push("state-1");
  expect(mgr.canUndo()).toEqual(true);
  const undone = mgr.undo();
  expect(undone).toEqual("state-0");
});

test("undo then redo retrieves next state", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("A");
  mgr.push("B");
  mgr.undo();
  expect(mgr.canRedo()).toEqual(true);
  const redone = mgr.redo();
  expect(redone).toEqual("B");
});

test("pushing after undo clears redo history", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("A");
  mgr.push("B");
  mgr.push("C");
  mgr.undo(); // back to B
  mgr.push("D"); // should discard C from redo
  expect(mgr.canRedo()).toEqual(false);
  expect(mgr.redo()).toEqual(null);
});

test("canUndo is false after single push", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("only");
  // pointer is at 0 so canUndo returns false
  expect(mgr.canUndo()).toEqual(false);
});

test("undo at start returns null", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("A");
  mgr.push("B");
  mgr.undo(); // -> A
  expect(mgr.undo()).toEqual(null); // nothing before A
});

test("redo at end returns null", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("A");
  mgr.push("B");
  expect(mgr.redo()).toEqual(null); // already at latest
});

test("max size trims oldest entries", () => {
  const mgr = new UndoRedoManager<number>(5);
  for (let i = 0; i < 10; i++) {
    mgr.push(i);
  }
  // Stack should contain only 5 entries: [5,6,7,8,9]
  // Walk back through undo
  const collected: number[] = [];
  let val = mgr.undo();
  while (val !== null) {
    collected.push(val);
    val = mgr.undo();
  }
  // We can undo 4 times (back from pointer 4 to pointer 0)
  expect(collected.length).toEqual(4);
  expect(collected).toEqual([8, 7, 6, 5]);
});

test("multiple undo/redo cycles work correctly", () => {
  const mgr = new UndoRedoManager<string>();
  mgr.push("A");
  mgr.push("B");
  mgr.push("C");

  expect(mgr.undo()).toEqual("B");
  expect(mgr.undo()).toEqual("A");
  expect(mgr.redo()).toEqual("B");
  expect(mgr.redo()).toEqual("C");
  expect(mgr.redo()).toEqual(null);
});

test("editor commit pattern: redo restores the edit (not a stale pre-edit copy)", () => {
  // Mirrors EditorPage: seed the initial state on load, then snapshot AFTER
  // each mutation. The old code snapshotted the pre-edit state, so redo
  // replayed the duplicate and lost the last edit.
  const mgr = new UndoRedoManager<string>();
  mgr.push("initial"); // seeded on load
  // user edits "initial" -> "edited"; commit snapshots the post-edit state
  mgr.push("edited");

  expect(mgr.undo()).toEqual("initial");
  expect(mgr.redo()).toEqual("edited"); // the edit is recoverable
});

test("default max size is 50", () => {
  const mgr = new UndoRedoManager<number>();
  for (let i = 0; i < 60; i++) {
    mgr.push(i);
  }
  // Should be able to undo 49 times (50 entries, pointer at 49)
  let undoCount = 0;
  while (mgr.canUndo()) {
    mgr.undo();
    undoCount++;
  }
  expect(undoCount).toEqual(49);
});
