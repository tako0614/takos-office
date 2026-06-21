import { expect, test } from "bun:test";

import {
  documentContentToMarkdown,
  type MarkdownNode,
  tiptapJsonToMarkdown,
} from "../lib/markdown.ts";

function doc(...content: MarkdownNode[]): MarkdownNode {
  return { type: "doc", content };
}

function p(...content: MarkdownNode[]): MarkdownNode {
  return { type: "paragraph", content };
}

function text(value: string, marks?: MarkdownNode["marks"]): MarkdownNode {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

test("paragraphs are separated by a blank line and end with one newline", () => {
  const md = tiptapJsonToMarkdown(doc(p(text("First")), p(text("Second"))));
  expect(md).toEqual("First\n\nSecond\n");
});

test("headings render with the matching number of hashes, clamped 1-6", () => {
  const md = tiptapJsonToMarkdown(
    doc(
      { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
      { type: "heading", attrs: { level: 3 }, content: [text("Sub")] },
      { type: "heading", attrs: { level: 9 }, content: [text("Deep")] },
      { type: "heading", content: [text("NoLevel")] },
    ),
  );
  expect(md).toEqual("# Title\n\n### Sub\n\n###### Deep\n\n# NoLevel\n");
});

test("bold / italic / strike / code marks render correctly", () => {
  const md = tiptapJsonToMarkdown(
    doc(
      p(text("bold", [{ type: "bold" }])),
      p(text("italic", [{ type: "italic" }])),
      p(text("struck", [{ type: "strike" }])),
      p(text("snippet", [{ type: "code" }])),
    ),
  );
  expect(md).toEqual("**bold**\n\n*italic*\n\n~~struck~~\n\n`snippet`\n");
});

test("combined bold + italic nest as **_text_**", () => {
  const md = tiptapJsonToMarkdown(
    doc(p(text("emph", [{ type: "italic" }, { type: "bold" }]))),
  );
  expect(md).toEqual("***emph***\n");
});

test("inline code is emitted literally without escaping inner markup", () => {
  const md = tiptapJsonToMarkdown(
    doc(p(text("a*b_c", [{ type: "code" }]))),
  );
  expect(md).toEqual("`a*b_c`\n");
});

test("links wrap their (mark-decorated) label", () => {
  const md = tiptapJsonToMarkdown(
    doc(
      p(text("Takos", [{ type: "link", attrs: { href: "https://takos.jp" } }])),
      p(
        text("bold link", [
          { type: "bold" },
          { type: "link", attrs: { href: "https://example.com" } },
        ]),
      ),
    ),
  );
  expect(md).toEqual(
    "[Takos](https://takos.jp)\n\n[**bold link**](https://example.com)\n",
  );
});

test("bullet lists render with - markers", () => {
  const md = tiptapJsonToMarkdown(
    doc({
      type: "bulletList",
      content: [
        { type: "listItem", content: [p(text("one"))] },
        { type: "listItem", content: [p(text("two"))] },
      ],
    }),
  );
  expect(md).toEqual("- one\n- two\n");
});

test("ordered lists number from attrs.start (default 1)", () => {
  const md = tiptapJsonToMarkdown(
    doc({
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        { type: "listItem", content: [p(text("c"))] },
        { type: "listItem", content: [p(text("d"))] },
      ],
    }),
  );
  expect(md).toEqual("3. c\n4. d\n");
});

test("nested lists indent under the parent item marker", () => {
  const md = tiptapJsonToMarkdown(
    doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p(text("parent")),
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [p(text("child"))] },
              ],
            },
          ],
        },
      ],
    }),
  );
  expect(md).toEqual("- parent\n  - child\n");
});

test("blockquote prefixes each line with >", () => {
  const md = tiptapJsonToMarkdown(
    doc({
      type: "blockquote",
      content: [p(text("quoted")), p(text("more"))],
    }),
  );
  expect(md).toEqual("> quoted\n>\n> more\n");
});

test("code blocks fence with the language and preserve text verbatim", () => {
  const md = tiptapJsonToMarkdown(
    doc({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const x = 1;\nconst y = 2;")],
    }),
  );
  expect(md).toEqual("```ts\nconst x = 1;\nconst y = 2;\n```\n");
});

test("code blocks without a language emit a bare fence", () => {
  const md = tiptapJsonToMarkdown(
    doc({ type: "codeBlock", content: [text("plain")] }),
  );
  expect(md).toEqual("```\nplain\n```\n");
});

test("horizontal rule renders as ---", () => {
  const md = tiptapJsonToMarkdown(
    doc(p(text("a")), { type: "horizontalRule" }, p(text("b"))),
  );
  expect(md).toEqual("a\n\n---\n\nb\n");
});

test("hard breaks become a Markdown line break (two spaces + newline)", () => {
  const md = tiptapJsonToMarkdown(
    doc(p(text("line one"), { type: "hardBreak" }, text("line two"))),
  );
  expect(md).toEqual("line one  \nline two\n");
});

test("images render as ![alt](src) with optional title", () => {
  const md = tiptapJsonToMarkdown(
    doc(
      p({ type: "image", attrs: { src: "https://x/y.png", alt: "Y" } }),
      p({
        type: "image",
        attrs: { src: "https://x/z.png", alt: "Z", title: "cap" },
      }),
    ),
  );
  expect(md).toEqual(
    "![Y](https://x/y.png)\n\n![Z](https://x/z.png \"cap\")\n",
  );
});

test("special Markdown characters in plain text are escaped", () => {
  const md = tiptapJsonToMarkdown(doc(p(text("1 * 2 _ 3 # 4"))));
  expect(md).toEqual("1 \\* 2 \\_ 3 \\# 4\n");
});

test("documentContentToMarkdown parses a JSON content string", () => {
  const content = JSON.stringify(doc({
    type: "heading",
    attrs: { level: 2 },
    content: [text("Hi")],
  }, p(text("body"))));
  expect(documentContentToMarkdown(content)).toEqual("## Hi\n\nbody\n");
});

test("documentContentToMarkdown falls back to plain text for non-JSON content", () => {
  expect(documentContentToMarkdown("just text")).toEqual("just text\n");
});

test("an empty document yields a single newline", () => {
  expect(tiptapJsonToMarkdown(doc())).toEqual("\n");
});
