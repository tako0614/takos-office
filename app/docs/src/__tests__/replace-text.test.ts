import { expect, test } from "bun:test";
import { type DocNode, replaceTextInModel } from "../mcp.ts";

function paragraph(...texts: string[]): DocNode["content"][number] {
  return {
    type: "paragraph",
    content: texts.map((text) => ({ type: "text", text })),
  };
}

function plainText(doc: DocNode): string {
  const out: string[] = [];
  const walk = (node: { type?: string; text?: unknown; content?: unknown[] }) => {
    if (node.type === "text" && typeof node.text === "string") out.push(node.text);
    if (Array.isArray(node.content)) {
      for (const c of node.content) walk(c as typeof node);
    }
  };
  walk(doc);
  return out.join("");
}

test("replaceTextInModel replaces only the first match when all=false", () => {
  const doc: DocNode = { type: "doc", content: [paragraph("foo foo foo")] };
  expect(replaceTextInModel(doc, "foo", "bar", false)).toBe(1);
  expect(plainText(doc)).toBe("bar foo foo");
});

test("replaceTextInModel replaces every non-overlapping match when all=true", () => {
  const doc: DocNode = { type: "doc", content: [paragraph("aaaa")] };
  // String.replaceAll semantics: matches at 0 and 2, not 0/1/2/3.
  expect(replaceTextInModel(doc, "aa", "a", true)).toBe(2);
  expect(plainText(doc)).toBe("aa");
});

test("replaceTextInModel handles a match spanning multiple text nodes", () => {
  // "bc" spans the boundary of two adjacent text nodes "ab" + "cd".
  const doc: DocNode = { type: "doc", content: [paragraph("ab", "cd")] };
  expect(replaceTextInModel(doc, "bc", "X", true)).toBe(1);
  expect(plainText(doc)).toBe("aXd");
});

test("replaceTextInModel deletes matched text with an empty replacement", () => {
  const doc: DocNode = { type: "doc", content: [paragraph("a-b-c-d")] };
  expect(replaceTextInModel(doc, "-", "", true)).toBe(3);
  expect(plainText(doc)).toBe("abcd");
});

test("replaceTextInModel is linear, not quadratic, on a worst-case input", () => {
  // The old re-collect+re-join-per-match loop was O(matches * docSize); a
  // 200 KB single-char doc with find='a' replace='' all=true is the worst case.
  const big = "a".repeat(200_000);
  const doc: DocNode = { type: "doc", content: [paragraph(big)] };
  const start = performance.now();
  const count = replaceTextInModel(doc, "a", "", true);
  const elapsed = performance.now() - start;
  expect(count).toBe(200_000);
  expect(plainText(doc)).toBe("");
  // Generous bound that a quadratic implementation (~4e10 ops) cannot meet.
  expect(elapsed).toBeLessThan(2_000);
});
