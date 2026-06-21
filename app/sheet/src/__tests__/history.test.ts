import { expect, test } from "bun:test";
import { UndoRedoManager } from "../lib/history.ts";

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
