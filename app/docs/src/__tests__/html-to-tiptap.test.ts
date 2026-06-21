import { expect, test } from "bun:test";
import { htmlToTiptapBlocks } from "../lib/html-to-tiptap.ts";

test("returns null for content with no block structure", () => {
  expect(htmlToTiptapBlocks("just <b>inline</b> text")).toBeNull();
  expect(htmlToTiptapBlocks("plain text")).toBeNull();
});

test("preserves headings with their level", () => {
  const blocks = htmlToTiptapBlocks("<h2>Title</h2>");
  expect(blocks).toEqual([
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
  ]);
});

test("preserves bold and italic marks inside a paragraph", () => {
  const blocks = htmlToTiptapBlocks("<p>a <strong>bold</strong> and <em>italic</em></p>");
  expect(blocks?.[0].type).toBe("paragraph");
  const content = blocks?.[0].content ?? [];
  expect(content).toEqual([
    { type: "text", text: "a " },
    { type: "text", text: "bold", marks: [{ type: "bold" }] },
    { type: "text", text: " and " },
    { type: "text", text: "italic", marks: [{ type: "italic" }] },
  ]);
});

test("preserves links with href", () => {
  const blocks = htmlToTiptapBlocks('<p>See <a href="https://x.test/a">here</a></p>');
  const content = blocks?.[0].content ?? [];
  expect(content[1]).toEqual({
    type: "text",
    text: "here",
    marks: [{ type: "link", attrs: { href: "https://x.test/a" } }],
  });
});

test("nested marks stack (bold + italic)", () => {
  const blocks = htmlToTiptapBlocks("<p><strong><em>both</em></strong></p>");
  expect(blocks?.[0].content).toEqual([
    { type: "text", text: "both", marks: [{ type: "bold" }, { type: "italic" }] },
  ]);
});

test("converts list items to paragraphs and blockquotes/pre to their nodes", () => {
  const blocks = htmlToTiptapBlocks(
    "<ul><li>one</li><li>two</li></ul><blockquote>quote</blockquote><pre>code</pre>",
  );
  expect(blocks?.map((b) => b.type)).toEqual([
    "paragraph",
    "paragraph",
    "blockquote",
    "codeBlock",
  ]);
});

test("decodes entities and keeps <br> as a hard break", () => {
  const blocks = htmlToTiptapBlocks("<p>a &amp; b<br>c</p>");
  expect(blocks?.[0].content).toEqual([
    { type: "text", text: "a & b" },
    { type: "hardBreak" },
    { type: "text", text: "c" },
  ]);
});
