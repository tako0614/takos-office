import { expect, test } from "bun:test";
import { nextBoundDoc } from "../lib/editor-sync.ts";
import type { Document } from "../types/index.ts";

function makeDoc(overrides: Partial<Document> = {}): Document {
  const now = "2026-04-30T00:00:00.000Z";
  return {
    id: overrides.id ?? "doc-1",
    title: overrides.title ?? "Notes",
    content: overrides.content ?? JSON.stringify({ type: "doc", content: [] }),
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

test("load binds the freshly loaded document", () => {
  const loaded = makeDoc({ content: "C0" });
  expect(nextBoundDoc(null, { kind: "load", doc: loaded })).toBe(loaded);
});

test("conflict adopts the server's current document", () => {
  const current = makeDoc({ content: "local" });
  const server = makeDoc({ content: "theirs", updatedAt: "later" });
  expect(nextBoundDoc(current, { kind: "conflict", doc: server })).toBe(server);
});

test("a save echo never resets the bound document (no mid-typing revert)", () => {
  // Scenario: user loaded C0, typed so the editor sent C1, paused -> save C1
  // fires. During the response round-trip the user keeps typing (editor now
  // C1+x). When C1's echo lands it must NOT become the bound document, or the
  // reactive editor prop would reset the editor and drop the "x" keystrokes.
  const bound = makeDoc({ content: "C0" }); // load-time bound doc
  const echo = makeDoc({ content: "C1", updatedAt: "echo" }); // server echo
  const result = nextBoundDoc(bound, { kind: "saveEcho", doc: echo });
  expect(result).toBe(bound);
  expect(result?.content).toEqual("C0");
});
