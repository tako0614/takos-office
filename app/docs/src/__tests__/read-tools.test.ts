import { expect, test } from "bun:test";

import { computeDocOutline, createDocsMcpServer, createMcpRequestHandler } from "../mcp.ts";
import type { Document } from "../types/index.ts";

// A document model with headings + paragraphs. Rendered text is the
// concatenation of every text node in order:
//   "Intro"            (h1, offset 0)
//   "Lead paragraph."  (p,  offset 5)
//   "Section One"      (h2, offset 20)
//   "Body of one."     (p,  offset 31)
//   "Section Two"      (h2, offset 43)
//   "Body of two."     (p,  offset 54)
const DOC_MODEL = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph", content: [{ type: "text", text: "Lead paragraph." }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section One" }] },
    { type: "paragraph", content: [{ type: "text", text: "Body of one." }] },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section Two" }] },
    { type: "paragraph", content: [{ type: "text", text: "Body of two." }] },
  ],
};

const RENDERED_TEXT =
  "IntroLead paragraph.Section OneBody of one.Section TwoBody of two.";

function fixtureDoc(): Document {
  const now = "2026-06-21T00:00:00.000Z";
  return {
    id: "doc-1",
    title: "Fixture",
    content: JSON.stringify(DOC_MODEL),
    createdAt: now,
    updatedAt: now,
  };
}

/** Minimal read-only store that returns the fixture for its id, null otherwise. */
function fixtureStore(doc: Document) {
  return {
    get(id: string) {
      return Promise.resolve(id === doc.id ? doc : null);
    },
  };
}

function mcpToolRequest(name: string, args: Record<string, unknown>): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function mcpResult(
  response: Response,
): Promise<{ text: string; isError: boolean }> {
  const body = await response.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine!.slice("data: ".length));
  return {
    text: payload.result.content[0].text,
    isError: payload.result.isError === true,
  };
}

function handlerFor(doc: Document) {
  return createMcpRequestHandler(
    () => createDocsMcpServer({ store: fixtureStore(doc) as never }),
    { allowUnauthenticated: true },
  );
}

test("computeDocOutline returns headings with rendered-text offsets in order", () => {
  // Drive the pure helper directly so the offset math is unit-tested without a
  // store. The doc model here is the same shape loadDocModel produces.
  const outline = computeDocOutline(DOC_MODEL as never);

  expect(outline).toEqual([
    { level: 1, text: "Intro", offset: 0 },
    { level: 2, text: "Section One", offset: 20 },
    { level: 2, text: "Section Two", offset: 43 },
  ]);
});

test("computeDocOutline clamps heading level and defaults missing level to 1", () => {
  const outline = computeDocOutline({
    type: "doc",
    content: [
      { type: "heading", content: [{ type: "text", text: "NoLevel" }] },
      { type: "heading", attrs: { level: 9 }, content: [{ type: "text", text: "TooDeep" }] },
    ],
  } as never);

  expect(outline.map((h) => h.level)).toEqual([1, 6]);
});

test("docs_get_text returns rendered text whose length is the editing offset space", async () => {
  const handler = handlerFor(fixtureDoc());
  const { text, isError } = await mcpResult(
    await handler(mcpToolRequest("docs_get_text", { id: "doc-1" })),
  );
  expect(isError).toEqual(false);

  const result = JSON.parse(text) as {
    id: string;
    text: string;
    length: number;
  };
  expect(result.id).toEqual("doc-1");
  expect(result.text).toEqual(RENDERED_TEXT);
  expect(result.length).toEqual(RENDERED_TEXT.length);
});

test("docs_get_outline offsets line up with docs_get_text", async () => {
  const handler = handlerFor(fixtureDoc());

  const textResult = JSON.parse(
    (await mcpResult(await handler(mcpToolRequest("docs_get_text", { id: "doc-1" }))))
      .text,
  ) as { text: string };

  const outlineResult = JSON.parse(
    (await mcpResult(await handler(mcpToolRequest("docs_get_outline", { id: "doc-1" }))))
      .text,
  ) as { id: string; headings: { level: number; text: string; offset: number }[] };

  expect(outlineResult.id).toEqual("doc-1");
  expect(outlineResult.headings).toHaveLength(3);

  // Each reported offset must point at the heading's text inside docs_get_text's
  // rendered text — that is the consistency contract an agent relies on.
  for (const heading of outlineResult.headings) {
    expect(
      textResult.text.slice(heading.offset, heading.offset + heading.text.length),
    ).toEqual(heading.text);
  }
});

test("docs_get_text returns an error result for a missing document", async () => {
  const handler = handlerFor(fixtureDoc());
  const { text, isError } = await mcpResult(
    await handler(mcpToolRequest("docs_get_text", { id: "nope" })),
  );
  expect(isError).toEqual(true);
  expect(text).toEqual("Document not found: nope");
});

test("docs_get_outline returns an error result for a missing document", async () => {
  const handler = handlerFor(fixtureDoc());
  const { text, isError } = await mcpResult(
    await handler(mcpToolRequest("docs_get_outline", { id: "nope" })),
  );
  expect(isError).toEqual(true);
  expect(text).toEqual("Document not found: nope");
});
