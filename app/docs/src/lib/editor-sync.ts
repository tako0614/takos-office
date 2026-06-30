import type { Document } from "../types/index.ts";

/**
 * Policy for when the docs editor may be (re)loaded from the document store.
 *
 * The TipTap editor is bound reactively to the `doc` signal's content, so any
 * change to the bound document re-applies into the live editor (resetting its
 * content and cursor). That must only happen for an EXTERNAL source of truth:
 *   - `load`     — opening a document or switching ids
 *   - `conflict` — adopting the server's version after a 409 optimistic-
 *                  concurrency rejection
 *
 * A *successful* autosave echoes back the exact content the client just sent.
 * Feeding that echo back into the bound document would reset the editor
 * mid-typing and drop any keystrokes entered during the save round-trip (cursor
 * jump + silent data loss). So a `saveEcho` never changes the bound document —
 * the editor already holds that content (plus newer local edits), and the
 * optimistic-concurrency base lives in localStorage, not this signal. This
 * mirrors the slide/sheet editors, which ignore their save responses.
 */
export type DocSyncEvent =
  | { kind: "load"; doc: Document }
  | { kind: "conflict"; doc: Document }
  | { kind: "saveEcho"; doc: Document };

/**
 * Return the document to bind to the editor/UI after a store event, or the
 * current one unchanged when the event must not reset the live editor.
 */
export function nextBoundDoc(
  current: Document | null,
  event: DocSyncEvent,
): Document | null {
  switch (event.kind) {
    case "load":
    case "conflict":
      return event.doc;
    case "saveEcho":
      return current;
  }
}
