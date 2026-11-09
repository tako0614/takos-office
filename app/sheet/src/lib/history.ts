import type { Spreadsheet } from "../types/index.ts";

/**
 * Generic undo/redo manager that stores state snapshots.
 *
 * T will typically be `Record<string, CellData>` (the cells of a sheet).
 */
export class UndoRedoManager<T> {
  private stack: T[] = [];
  private pointer = -1;
  private maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  /** Push a new state snapshot. Discards any redo history after the pointer. */
  push(state: T): void {
    // Discard redo states
    this.stack = this.stack.slice(0, this.pointer + 1);
    this.stack.push(state);

    // Trim oldest entries if over the limit
    if (this.stack.length > this.maxSize) {
      this.stack = this.stack.slice(this.stack.length - this.maxSize);
    }

    this.pointer = this.stack.length - 1;
  }

  /** Return the previous state, or null if nothing to undo. */
  undo(): T | null {
    if (!this.canUndo()) return null;
    this.pointer--;
    return this.stack[this.pointer];
  }

  /** Return the next state, or null if nothing to redo. */
  redo(): T | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    return this.stack[this.pointer];
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }
}

/** Row/column edits rewrite references across sheets: one edit is one workbook. */
export class WorkbookHistory {
  private states = new UndoRedoManager<Spreadsheet>(50);

  reset(initial?: Spreadsheet): void {
    this.states = new UndoRedoManager<Spreadsheet>(50);
    if (initial) this.push(initial);
  }

  push(book: Spreadsheet): void {
    this.states.push(structuredClone(book));
  }

  undo(): Spreadsheet | null {
    const book = this.states.undo();
    return book ? structuredClone(book) : null;
  }

  redo(): Spreadsheet | null {
    const book = this.states.redo();
    return book ? structuredClone(book) : null;
  }

  canUndo(): boolean { return this.states.canUndo(); }
  canRedo(): boolean { return this.states.canRedo(); }
}
