import { expect, test } from "bun:test";

// doc-renderer.ts uses npm:canvas. The parseHtmlToBlocks / tagToBlock /
// parseInlineRuns / stripTags helpers are not exported, so we test the public
// API (renderDocumentToBuffer) which produces a PNG buffer.
let renderDocumentToBuffer: (
  title: string,
  html: string,
  options?: { width?: number; height?: number },
) => Uint8Array;

try {
  const mod = await import("../lib/doc-renderer.ts");
  renderDocumentToBuffer = mod.renderDocumentToBuffer;
} catch (cause) {
  throw new Error(
    "doc-renderer tests require native canvas; install dependencies with Bun in takos-docs.",
    { cause },
  );
}

// PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
const PNG_MAGIC = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

test("renderDocumentToBuffer returns a valid PNG for simple text", () => {
  const buf = renderDocumentToBuffer("Title", "<p>Hello world</p>");
  expect(buf.length > PNG_MAGIC.length).toBeTruthy();
  const header = new Uint8Array(buf.buffer, buf.byteOffset, 8);
  expect([...header]).toEqual([...PNG_MAGIC]);
});

test("renderDocumentToBuffer handles empty HTML content", () => {
  const buf = renderDocumentToBuffer("Empty", "");
  const header = new Uint8Array(buf.buffer, buf.byteOffset, 8);
  expect([...header]).toEqual([...PNG_MAGIC]);
});

test("renderDocumentToBuffer handles heading tags", () => {
  const html = "<h1>Heading 1</h1><h2>Heading 2</h2><p>Body</p>";
  const buf = renderDocumentToBuffer("Headings", html);
  expect(buf.length > 0).toBeTruthy();
  const header = new Uint8Array(buf.buffer, buf.byteOffset, 8);
  expect([...header]).toEqual([...PNG_MAGIC]);
});

test("renderDocumentToBuffer handles list items", () => {
  const html = "<li>Item one</li><li>Item two</li>";
  const buf = renderDocumentToBuffer("List", html);
  expect(buf.length > 0).toBeTruthy();
});

test("renderDocumentToBuffer handles inline formatting", () => {
  const html =
    "<p><strong>Bold</strong> and <em>italic</em> and <u>underline</u></p>";
  const buf = renderDocumentToBuffer("Formatting", html);
  expect(buf.length > 0).toBeTruthy();
});

test("renderDocumentToBuffer handles blockquote", () => {
  const html = "<blockquote>A quote</blockquote>";
  const buf = renderDocumentToBuffer("Quote", html);
  expect(buf.length > 0).toBeTruthy();
});

test("renderDocumentToBuffer respects custom dimensions", () => {
  const buf = renderDocumentToBuffer("Size", "<p>Text</p>", {
    width: 400,
    height: 300,
  });
  expect(buf.length > 0).toBeTruthy();
  const header = new Uint8Array(buf.buffer, buf.byteOffset, 8);
  expect([...header]).toEqual([...PNG_MAGIC]);
});

test("renderDocumentToBuffer handles HTML entities", () => {
  const html = "<p>&amp; &lt; &gt; &quot; &#39; &nbsp;</p>";
  const buf = renderDocumentToBuffer("Entities", html);
  expect(buf.length > 0).toBeTruthy();
});

test("renderDocumentToBuffer handles plain text without block tags", () => {
  const buf = renderDocumentToBuffer("Plain", "Just plain text, no tags");
  expect(buf.length > 0).toBeTruthy();
  const header = new Uint8Array(buf.buffer, buf.byteOffset, 8);
  expect([...header]).toEqual([...PNG_MAGIC]);
});
