/**
 * MCP Server for document editing tools.
 *
 * Exposes:
 * - docs_list, docs_create, docs_get, docs_delete, docs_search — Document management
 * - docs_set_title, docs_set_content, docs_insert_text, docs_replace_text, docs_append_text — Content editing
 * - docs_format_selection, docs_insert_table, docs_insert_image, docs_insert_link — Formatting
 * - docs_screenshot — Screenshot
 * - docs_export_html, docs_export_text — Export
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DocumentStore } from "./document-store.ts";
import { htmlToTiptapBlocks } from "./lib/html-to-tiptap.ts";
import {
  createDocsRuntimeCapabilityManifest,
  type DocsRuntimeCapabilityManifest,
  docsScreenshotUnavailableMessage,
} from "./runtime-capabilities.ts";
import {
  bytesToBase64,
  createAppMcpServer,
  createMcpRequestHandler as createSharedMcpRequestHandler,
  MAX_MCP_REQUEST_BYTES,
  mcpAuthMisconfigured as sharedMcpAuthMisconfigured,
  type McpAuthOptions,
  mcpError,
  mcpJson,
  mcpText,
} from "../../shared/mcp-factory.ts";

export const DOCS_MAX_MCP_REQUEST_BYTES = MAX_MCP_REQUEST_BYTES;
export type DocsMcpAuthOptions = McpAuthOptions;
export const mcpAuthMisconfigured = sharedMcpAuthMisconfigured;

const MAX_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 200;
const MAX_QUERY_LENGTH = 200;
const MAX_CONTENT_LENGTH = 250_000;
const MAX_TEXT_PATCH_LENGTH = 25_000;
const MAX_URL_LENGTH = 2_048;
const MAX_ALT_LENGTH = 500;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 20;
const MIN_SCREENSHOT_WIDTH = 200;
const MAX_SCREENSHOT_WIDTH = 2_400;
const MIN_SCREENSHOT_HEIGHT = 200;
const MAX_SCREENSHOT_HEIGHT = 3_200;
const DEFAULT_SCREENSHOT_WIDTH = 800;
const DEFAULT_SCREENSHOT_HEIGHT = 1_000;

const idSchema = z.string().trim().min(1).max(MAX_ID_LENGTH);
const titleSchema = z.string().max(MAX_TITLE_LENGTH);
const contentSchema = z.string().max(MAX_CONTENT_LENGTH);
const textPatchSchema = z.string().max(MAX_TEXT_PATCH_LENGTH);
const positionSchema = z.number().int().min(0).max(MAX_CONTENT_LENGTH);
const urlSchema = z.string().trim().min(1).max(MAX_URL_LENGTH);
const screenshotWidthSchema = z
  .number()
  .int()
  .min(MIN_SCREENSHOT_WIDTH)
  .max(MAX_SCREENSHOT_WIDTH);
const screenshotHeightSchema = z
  .number()
  .int()
  .min(MIN_SCREENSHOT_HEIGHT)
  .max(MAX_SCREENSHOT_HEIGHT);

type TiptapNode = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: { type?: unknown; attrs?: Record<string, unknown> }[];
};

const ALLOWED_HTML_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const VOID_HTML_TAGS = new Set(["br", "hr", "img"]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function isSafeUrl(value: string, opts: { image?: boolean } = {}): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return false;
  for (const char of trimmed) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return false;
  }

  if (
    opts.image &&
    /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(
      trimmed,
    )
  ) {
    return trimmed.length <= 100_000;
  }

  try {
    const parsed = new URL(trimmed, "https://takos.local");
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return true;
    }
    if (!opts.image && parsed.protocol === "mailto:") return true;
    return false;
  } catch {
    return false;
  }
}

function getSafeUrl(
  value: string,
  opts: { image?: boolean } = {},
): string | null {
  const trimmed = value.trim();
  return isSafeUrl(trimmed, opts) ? trimmed : null;
}

function sanitizeHtmlAttributes(tag: string, rawAttrs: string): string {
  const attrs: string[] = [];
  const attrPattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";

    if (tag === "a" && name === "href") {
      const href = getSafeUrl(value);
      if (href) attrs.push(`href="${escapeAttribute(href)}"`);
      continue;
    }

    if (tag === "img" && name === "src") {
      const src = getSafeUrl(value, { image: true });
      if (src) attrs.push(`src="${escapeAttribute(src)}"`);
      continue;
    }

    if (
      (tag === "img" || tag === "a") && (name === "alt" || name === "title")
    ) {
      attrs.push(
        `${name}="${escapeAttribute(value.slice(0, MAX_ALT_LENGTH))}"`,
      );
      continue;
    }

    if (
      (tag === "td" || tag === "th") &&
      (name === "colspan" || name === "rowspan")
    ) {
      const span = Number(value);
      if (Number.isInteger(span) && span >= 1 && span <= 100) {
        attrs.push(`${name}="${span}"`);
      }
    }
  }

  if (tag === "a" && attrs.some((attr) => attr.startsWith("href="))) {
    attrs.push('rel="noopener noreferrer"', 'target="_blank"');
  }

  return attrs.length ? ` ${attrs.join(" ")}` : "";
}

export function sanitizeHtmlForExport(html: string): string {
  let result = "";
  let lastIndex = 0;
  const tagPattern = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    result += escapeHtml(html.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;

    const tag = match[1].toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) continue;

    const isClosing = /^<\s*\//.test(match[0]);
    if (isClosing) {
      if (!VOID_HTML_TAGS.has(tag)) result += `</${tag}>`;
      continue;
    }

    const attrs = sanitizeHtmlAttributes(tag, match[2] ?? "");
    result += `<${tag}${attrs}>`;
  }

  result += escapeHtml(html.slice(lastIndex));
  return result;
}

function renderTiptapChildren(nodes: TiptapNode[] | undefined): string {
  return Array.isArray(nodes) ? nodes.map(renderTiptapNode).join("") : "";
}

function renderTiptapText(node: TiptapNode): string {
  let rendered = escapeHtml(String(node.text ?? ""));
  const marks = Array.isArray(node.marks) ? [...node.marks].reverse() : [];

  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        rendered = `<strong>${rendered}</strong>`;
        break;
      case "italic":
        rendered = `<em>${rendered}</em>`;
        break;
      case "underline":
        rendered = `<u>${rendered}</u>`;
        break;
      case "strike":
        rendered = `<s>${rendered}</s>`;
        break;
      case "code":
        rendered = `<code>${rendered}</code>`;
        break;
      case "link": {
        const href = typeof mark.attrs?.href === "string"
          ? getSafeUrl(mark.attrs.href)
          : null;
        if (href) {
          rendered = `<a href="${
            escapeAttribute(href)
          }" rel="noopener noreferrer" target="_blank">${rendered}</a>`;
        }
        break;
      }
    }
  }

  return rendered;
}

function renderTiptapNode(node: TiptapNode): string {
  const children = renderTiptapChildren(node.content);

  switch (node.type) {
    case "doc":
      return children;
    case "paragraph":
      return `<p>${children}</p>`;
    case "text":
      return renderTiptapText(node);
    case "hardBreak":
      return "<br>";
    case "heading": {
      const rawLevel = typeof node.attrs?.level === "number"
        ? node.attrs.level
        : 1;
      const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));
      return `<h${level}>${children}</h${level}>`;
    }
    case "bulletList":
    case "taskList":
      return `<ul>${children}</ul>`;
    case "orderedList":
      return `<ol>${children}</ol>`;
    case "listItem":
    case "taskItem":
      return `<li>${children}</li>`;
    case "blockquote":
      return `<blockquote>${children}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${children}</code></pre>`;
    case "horizontalRule":
      return "<hr>";
    case "table":
      return `<table>${children}</table>`;
    case "tableRow":
      return `<tr>${children}</tr>`;
    case "tableCell":
      return `<td>${children}</td>`;
    case "tableHeader":
      return `<th>${children}</th>`;
    case "image": {
      const src = typeof node.attrs?.src === "string"
        ? getSafeUrl(node.attrs.src, { image: true })
        : null;
      if (!src) return "";
      const alt = typeof node.attrs?.alt === "string"
        ? node.attrs.alt.slice(0, MAX_ALT_LENGTH)
        : "";
      const title = typeof node.attrs?.title === "string"
        ? node.attrs.title.slice(0, MAX_ALT_LENGTH)
        : "";
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<img src="${escapeAttribute(src)}" alt="${
        escapeAttribute(alt)
      }"${titleAttr}>`;
    }
    default:
      return children;
  }
}

function tryRenderTiptapJson(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(trimmed) as TiptapNode;
    if (!parsed || parsed.type !== "doc") return null;
    return renderTiptapNode(parsed);
  } catch {
    return null;
  }
}

function documentContentToSafeHtml(content: string): string {
  const fromJson = tryRenderTiptapJson(content);
  return fromJson ?? sanitizeHtmlForExport(content);
}

// ---------------------------------------------------------------------------
// Canonical model (TipTap JSON) editing
//
// The browser editor (components/Editor.tsx) stores content as a TipTap JSON
// string ({"type":"doc",...}); the Document.content field is canonically that
// JSON. The editing tools below operate on the parsed doc node and re-serialize
// with JSON.stringify, instead of slicing the raw stored string, so an agent
// edit can never corrupt the JSON the browser reloads.
// ---------------------------------------------------------------------------

type DocNode = TiptapNode & { type: "doc"; content: TiptapNode[] };

/** Convert a plain-text string into TipTap paragraph nodes (newline-split). */
function plainTextToParagraphs(text: string): TiptapNode[] {
  const lines = text.split("\n");
  return lines.map((line) => {
    const paragraph: TiptapNode = { type: "paragraph" };
    if (line.length > 0) {
      paragraph.content = [{ type: "text", text: line }];
    }
    return paragraph;
  });
}

/** Strip HTML to plain text, mirroring the docs_export_text normalization. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Load doc.content as a canonical TipTap doc node.
 *
 * - Valid TipTap JSON ({"type":"doc",...}) is used directly.
 * - Legacy HTML is parsed into TipTap block/inline nodes (headings, lists,
 *   blockquotes, bold/italic/underline/links/code), preserving formatting
 *   rather than flattening it. Content with no recognisable block structure
 *   (or plain text) becomes paragraph nodes.
 */
function loadDocModel(content: string): DocNode {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as TiptapNode;
      if (parsed && parsed.type === "doc") {
        return {
          ...parsed,
          type: "doc",
          content: Array.isArray(parsed.content) ? parsed.content : [],
        };
      }
    } catch {
      // fall through to legacy handling
    }
  }

  if (/<[a-z!/][^>]*>/i.test(content)) {
    const blocks = htmlToTiptapBlocks(content);
    if (blocks) return { type: "doc", content: blocks as TiptapNode[] };
    // No block structure: strip inline tags to text rather than show raw tags.
    return { type: "doc", content: plainTextToParagraphs(htmlToPlainText(content)) };
  }
  return { type: "doc", content: plainTextToParagraphs(content) };
}

function serializeDocModel(doc: DocNode): string {
  return JSON.stringify(doc);
}

/** Collect every text node in document order so offsets index rendered text. */
function collectTextNodes(node: TiptapNode, acc: TiptapNode[]): void {
  if (node.type === "text" && typeof node.text === "string") {
    acc.push(node);
    return;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectTextNodes(child, acc);
  }
}

/** Total rendered-text length of the doc (sum of text-node text). */
function docTextLength(doc: DocNode): number {
  const nodes: TiptapNode[] = [];
  collectTextNodes(doc, nodes);
  let total = 0;
  for (const n of nodes) total += String(n.text ?? "").length;
  return total;
}

/**
 * Insert text at a rendered-text offset, splicing it into the text node that
 * spans that offset (or appending a new paragraph when the offset is at/after
 * the document end and there is no trailing text node).
 */
function insertTextAtOffset(doc: DocNode, offset: number, insert: string): {
  insertedAt: number;
} {
  const nodes: TiptapNode[] = [];
  collectTextNodes(doc, nodes);
  const total = docTextLength(doc);
  const clamped = Math.max(0, Math.min(offset, total));

  let consumed = 0;
  for (const node of nodes) {
    const t = String(node.text ?? "");
    const next = consumed + t.length;
    // Prefer the text node whose interior contains the offset; for an offset
    // exactly at a boundary, the first node ending there wins (append to it).
    if (clamped <= next) {
      const within = clamped - consumed;
      node.text = t.slice(0, within) + insert + t.slice(within);
      return { insertedAt: clamped };
    }
    consumed = next;
  }

  // No text node covered the offset (e.g. empty doc): append a paragraph.
  doc.content.push({
    type: "paragraph",
    content: [{ type: "text", text: insert }],
  });
  return { insertedAt: clamped };
}

/** Append text as a trailing paragraph (matches "new block" append intent). */
function appendTextBlock(doc: DocNode, insert: string): void {
  for (const line of insert.split("\n")) {
    const paragraph: TiptapNode = { type: "paragraph" };
    if (line.length > 0) paragraph.content = [{ type: "text", text: line }];
    doc.content.push(paragraph);
  }
}

/**
 * Find-and-replace within the concatenated rendered text. Replacement is split
 * across the text nodes it spans; the first spanned node receives the new text
 * and the remainder of the matched range is cleared from subsequent nodes.
 */
function replaceTextInModel(
  doc: DocNode,
  find: string,
  replace: string,
  all: boolean,
): number {
  if (find.length === 0) return 0;
  let count = 0;
  let searchFrom = 0;

  // Re-collect each pass because node text shifts after a replacement.
  for (;;) {
    const nodes: TiptapNode[] = [];
    collectTextNodes(doc, nodes);
    const full = nodes.map((n) => String(n.text ?? "")).join("");
    const idx = full.indexOf(find, searchFrom);
    if (idx === -1) break;

    applyRangeReplacement(nodes, idx, idx + find.length, replace);
    count += 1;
    searchFrom = idx + replace.length;
    if (!all) break;
  }
  return count;
}

/** Replace [from, to) of rendered text across the given text nodes. */
function applyRangeReplacement(
  nodes: TiptapNode[],
  from: number,
  to: number,
  replacement: string,
): void {
  let consumed = 0;
  let placed = false;
  for (const node of nodes) {
    const t = String(node.text ?? "");
    const nodeStart = consumed;
    const nodeEnd = consumed + t.length;
    consumed = nodeEnd;

    if (nodeEnd <= from || nodeStart >= to) continue;

    const localStart = Math.max(0, from - nodeStart);
    const localEnd = Math.min(t.length, to - nodeStart);
    if (!placed) {
      node.text = t.slice(0, localStart) + replacement + t.slice(localEnd);
      placed = true;
    } else {
      node.text = t.slice(0, localStart) + t.slice(localEnd);
    }
  }
}

/**
 * Apply formatting marks (bold/italic/underline) and/or a heading to a
 * rendered-text range by splitting the spanned text nodes and adding marks,
 * and by converting the enclosing block(s) to a heading when requested.
 */
function formatRangeInModel(
  doc: DocNode,
  from: number,
  to: number,
  format: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    heading?: 1 | 2 | 3;
  },
): { from: number; to: number } {
  const total = docTextLength(doc);
  const start = Math.max(0, Math.min(from, total));
  const end = Math.max(start, Math.min(to, total));

  const markTypes: string[] = [];
  if (format.bold) markTypes.push("bold");
  if (format.italic) markTypes.push("italic");
  if (format.underline) markTypes.push("underline");

  if (markTypes.length > 0 && end > start) {
    applyMarksToRange(doc, start, end, markTypes);
  }
  if (format.heading) {
    applyHeadingToRange(doc, start, end, format.heading);
  }
  return { from: start, to: end };
}

/** Split text nodes at the range boundaries and add the given marks. */
function applyMarksToRange(
  doc: DocNode,
  from: number,
  to: number,
  markTypes: string[],
): void {
  const addMarks = (node: TiptapNode) => {
    const existing = Array.isArray(node.marks) ? node.marks : [];
    const have = new Set(existing.map((m) => m.type));
    const next = [...existing];
    for (const type of markTypes) {
      if (!have.has(type)) next.push({ type });
    }
    node.marks = next;
  };

  // Walk text nodes, splitting any that straddle [from, to) into up to three
  // pieces so marks apply exactly to the selected range.
  const rewrite = (parent: TiptapNode, baseOffset: { value: number }) => {
    if (!Array.isArray(parent.content)) return;
    const out: TiptapNode[] = [];
    for (const child of parent.content) {
      if (child.type === "text") {
        const t = String(child.text ?? "");
        const nodeStart = baseOffset.value;
        const nodeEnd = nodeStart + t.length;
        baseOffset.value = nodeEnd;

        if (nodeEnd <= from || nodeStart >= to || t.length === 0) {
          out.push(child);
          continue;
        }
        const localStart = Math.max(0, from - nodeStart);
        const localEnd = Math.min(t.length, to - nodeStart);
        const before = t.slice(0, localStart);
        const mid = t.slice(localStart, localEnd);
        const after = t.slice(localEnd);
        if (before) out.push({ ...child, text: before });
        const midNode: TiptapNode = { ...child, text: mid };
        addMarks(midNode);
        out.push(midNode);
        if (after) out.push({ ...child, text: after });
      } else {
        rewrite(child, baseOffset);
        out.push(child);
      }
    }
    parent.content = out;
  };
  rewrite(doc, { value: 0 });
}

/** Convert top-level blocks overlapping [from, to) into headings. */
function applyHeadingToRange(
  doc: DocNode,
  from: number,
  to: number,
  level: 1 | 2 | 3,
): void {
  let consumed = 0;
  for (const block of doc.content) {
    const nodes: TiptapNode[] = [];
    collectTextNodes(block, nodes);
    let blockLen = 0;
    for (const n of nodes) blockLen += String(n.text ?? "").length;
    const blockStart = consumed;
    const blockEnd = consumed + blockLen;
    consumed = blockEnd;

    const overlaps = blockEnd > from && blockStart < to;
    if (overlaps && (block.type === "paragraph" || block.type === "heading")) {
      block.type = "heading";
      block.attrs = { ...(block.attrs ?? {}), level };
    }
  }
}

/**
 * Insert a block-level node (table, image) at the top-level block boundary
 * nearest the rendered-text offset. Block nodes cannot live inside a text run,
 * so we split between blocks rather than mid-text.
 */
function insertBlockAtOffset(
  doc: DocNode,
  offset: number,
  block: TiptapNode,
): number {
  const total = docTextLength(doc);
  const clamped = Math.max(0, Math.min(offset, total));

  let consumed = 0;
  let insertIndex = doc.content.length;
  for (let i = 0; i < doc.content.length; i++) {
    const nodes: TiptapNode[] = [];
    collectTextNodes(doc.content[i], nodes);
    let blockLen = 0;
    for (const n of nodes) blockLen += String(n.text ?? "").length;
    const blockEnd = consumed + blockLen;
    // Insert after the first block whose rendered text ends at/after offset.
    if (clamped <= blockEnd) {
      insertIndex = clamped <= consumed ? i : i + 1;
      break;
    }
    consumed = blockEnd;
  }
  doc.content.splice(insertIndex, 0, block);
  return clamped;
}

/** Build a TipTap table node with a header row and empty body cells. */
function buildTableNode(rows: number, cols: number): TiptapNode {
  const headerCells: TiptapNode[] = Array.from({ length: cols }, (_, i) => ({
    type: "tableHeader",
    content: [{
      type: "paragraph",
      content: [{ type: "text", text: `Header ${i + 1}` }],
    }],
  }));
  const headerRow: TiptapNode = { type: "tableRow", content: headerCells };
  const bodyRows: TiptapNode[] = Array.from({ length: rows - 1 }, () => ({
    type: "tableRow",
    content: Array.from({ length: cols }, () => ({
      type: "tableCell",
      content: [{ type: "paragraph" }],
    })),
  }));
  return { type: "table", content: [headerRow, ...bodyRows] };
}

/**
 * Insert an inline link node at a rendered-text offset by splitting the spanned
 * text node and dropping a marked text node in between. Falls back to a new
 * trailing paragraph when no text node covers the offset.
 */
function insertLinkAtOffset(
  doc: DocNode,
  offset: number,
  linkText: string,
  href: string,
): number {
  const total = docTextLength(doc);
  const clamped = Math.max(0, Math.min(offset, total));
  const linkNode: TiptapNode = {
    type: "text",
    text: linkText,
    marks: [{
      type: "link",
      attrs: { href, target: "_blank", rel: "noopener noreferrer" },
    }],
  };

  const splitInParent = (
    parent: TiptapNode,
    base: { value: number },
  ): boolean => {
    if (!Array.isArray(parent.content)) return false;
    const out: TiptapNode[] = [];
    let placed = false;
    for (const child of parent.content) {
      if (placed) {
        out.push(child);
        continue;
      }
      if (child.type === "text") {
        const t = String(child.text ?? "");
        const nodeStart = base.value;
        const nodeEnd = nodeStart + t.length;
        base.value = nodeEnd;
        if (clamped <= nodeEnd) {
          const within = clamped - nodeStart;
          const before = t.slice(0, within);
          const after = t.slice(within);
          if (before) out.push({ ...child, text: before });
          out.push(linkNode);
          if (after) out.push({ ...child, text: after });
          placed = true;
        } else {
          out.push(child);
        }
      } else {
        placed = splitInParent(child, base);
        out.push(child);
      }
    }
    parent.content = out;
    return placed;
  };

  const placed = splitInParent(doc, { value: 0 });
  if (!placed) {
    doc.content.push({ type: "paragraph", content: [linkNode] });
  }
  return clamped;
}

export function buildExportHtml(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${documentContentToSafeHtml(content)}
</body>
</html>`;
}

export function normalizeScreenshotDimensions(width?: number, height?: number) {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.trunc(value)));

  return {
    width: clamp(
      width ?? DEFAULT_SCREENSHOT_WIDTH,
      MIN_SCREENSHOT_WIDTH,
      MAX_SCREENSHOT_WIDTH,
    ),
    height: clamp(
      height ?? DEFAULT_SCREENSHOT_HEIGHT,
      MIN_SCREENSHOT_HEIGHT,
      MAX_SCREENSHOT_HEIGHT,
    ),
  };
}

export interface McpServerDeps {
  store: DocumentStore;
  nativeRendering?: boolean;
  runtimeCapabilities?: DocsRuntimeCapabilityManifest;
}

export function createDocsMcpServer(deps: McpServerDeps): McpServer {
  const { store } = deps;
  const runtimeCapabilities = deps.runtimeCapabilities ??
    createDocsRuntimeCapabilityManifest({
      nativeRendering: deps.nativeRendering ?? true,
    });

  return createAppMcpServer({
    name: "takos-docs",
    version: "1.0.0",
    registerTools: (server) =>
      registerDocsTools(server, store, runtimeCapabilities),
  });
}

export function registerDocsTools(
  server: McpServer,
  store: DocumentStore,
  runtimeCapabilities: DocsRuntimeCapabilityManifest,
): void {
  const text = mcpText;
  const json = mcpJson;
  const error = mcpError;

  // ---------------------------------------------------------------------------
  // Document Management
  // ---------------------------------------------------------------------------

  server.tool(
    "docs_list",
    "List all documents. Returns array of {id, title, updatedAt}.",
    {},
    async () => {
      const docs = (await store.list()).map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
      }));
      return json({ documents: docs });
    },
  );

  server.tool(
    "docs_create",
    "Create a new document. Returns the created document with its id.",
    {
      title: titleSchema.describe("Document title"),
      content: contentSchema.optional().describe(
        "Initial content (TipTap JSON canonical, or HTML which is normalized)",
      ),
    },
    async ({ title, content }: { title: string; content?: string }) => {
      // Normalize any supplied content to canonical TipTap JSON so a doc
      // created via MCP loads identically in the browser editor.
      const normalized = content !== undefined && content !== ""
        ? serializeDocModel(loadDocModel(content))
        : content;
      const doc = await store.create(title, normalized);
      return json(doc);
    },
  );

  server.tool(
    "docs_get",
    "Get a document by id. Returns the full document (title, content as canonical TipTap JSON).",
    {
      id: idSchema.describe("Document id"),
    },
    async ({ id }: { id: string }) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);
      return json(doc);
    },
  );

  server.tool(
    "docs_delete",
    "Delete a document by id.",
    {
      id: idSchema.describe("Document id"),
    },
    async ({ id }: { id: string }) => {
      const deleted = await store.delete(id);
      if (!deleted) return error(`Document not found: ${id}`);
      return text(`Deleted document ${id}`);
    },
  );

  server.tool(
    "docs_search",
    "Search documents by title or content. Returns matching documents.",
    {
      query: z.string().max(MAX_QUERY_LENGTH).describe("Search query"),
    },
    async ({ query }: { query: string }) => {
      const results = (await store.search(query)).map((d) => ({
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
      }));
      return json({ results });
    },
  );

  // ---------------------------------------------------------------------------
  // Content Editing
  // ---------------------------------------------------------------------------

  server.tool(
    "docs_set_title",
    "Set the title of a document.",
    {
      id: idSchema.describe("Document id"),
      title: titleSchema.describe("New title"),
    },
    async ({ id, title }: { id: string; title: string }) => {
      const doc = await store.update(id, { title });
      if (!doc) return error(`Document not found: ${id}`);
      return json({ id: doc.id, title: doc.title });
    },
  );

  server.tool(
    "docs_set_content",
    "Set the full content of a document. Accepts TipTap JSON (canonical) or HTML; HTML and plain text are normalized to the canonical TipTap JSON the browser editor stores.",
    {
      id: idSchema.describe("Document id"),
      content: contentSchema.describe(
        "Full document content (TipTap JSON or HTML)",
      ),
    },
    async ({ id, content }: { id: string; content: string }) => {
      // Normalize whatever the agent supplies to canonical TipTap JSON so the
      // browser editor and the export path read the same shape.
      const normalized = serializeDocModel(loadDocModel(content));
      const doc = await store.update(id, { content: normalized });
      if (!doc) return error(`Document not found: ${id}`);
      return json({
        id: doc.id,
        title: doc.title,
        contentLength: doc.content.length,
      });
    },
  );

  server.tool(
    "docs_insert_text",
    "Insert text at a rendered-text character position in the document (positions index the visible text, not the stored JSON).",
    {
      id: idSchema.describe("Document id"),
      position: positionSchema.describe(
        "Rendered-text character position to insert at (0-based)",
      ),
      text: textPatchSchema.describe("Text to insert"),
    },
    async (
      { id, position, text: insertText }: {
        id: string;
        position: number;
        text: string;
      },
    ) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);
      const model = loadDocModel(doc.content);
      const { insertedAt } = insertTextAtOffset(model, position, insertText);
      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({
        id: updated!.id,
        insertedAt,
        contentLength: updated!.content.length,
      });
    },
  );

  server.tool(
    "docs_replace_text",
    "Find and replace text in the document content.",
    {
      id: idSchema.describe("Document id"),
      find: z.string().min(1).max(MAX_TEXT_PATCH_LENGTH).describe(
        "Text to find",
      ),
      replace: textPatchSchema.describe("Replacement text"),
      all: z.boolean().optional().describe(
        "Replace all occurrences (default: false, first only)",
      ),
    },
    async (
      { id, find, replace, all }: {
        id: string;
        find: string;
        replace: string;
        all?: boolean;
      },
    ) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      const model = loadDocModel(doc.content);
      // Find/replace operates on the rendered text, splicing matches into the
      // spanning text nodes rather than the raw JSON string.
      const count = replaceTextInModel(model, find, replace, all ?? false);
      if (count === 0) {
        return error(`Text not found in document ${id}: "${find}"`);
      }

      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({
        id: updated!.id,
        replacements: count,
        contentLength: updated!.content.length,
      });
    },
  );

  server.tool(
    "docs_append_text",
    "Append text to the end of the document content.",
    {
      id: idSchema.describe("Document id"),
      text: textPatchSchema.describe("Text to append"),
    },
    async ({ id, text: appendText }: { id: string; text: string }) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);
      const model = loadDocModel(doc.content);
      // Append as new trailing paragraph block(s) instead of concatenating onto
      // the raw JSON string.
      appendTextBlock(model, appendText);
      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({ id: updated!.id, contentLength: updated!.content.length });
    },
  );

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  server.tool(
    "docs_format_selection",
    "Apply formatting (bold/italic/underline marks, heading) to a rendered-text character range by editing the document model.",
    {
      id: idSchema.describe("Document id"),
      from: positionSchema.describe(
        "Start rendered-text position (0-based, inclusive)",
      ),
      to: positionSchema.describe(
        "End rendered-text position (0-based, exclusive)",
      ),
      format: z.object({
        bold: z.boolean().optional().describe("Apply bold"),
        italic: z.boolean().optional().describe("Apply italic"),
        underline: z.boolean().optional().describe("Apply underline"),
        heading: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
          .describe("Heading level"),
      }).describe("Formatting options"),
    },
    async (
      { id, from, to, format }: {
        id: string;
        from: number;
        to: number;
        format: {
          bold?: boolean;
          italic?: boolean;
          underline?: boolean;
          heading?: 1 | 2 | 3;
        };
      },
    ) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      const model = loadDocModel(doc.content);
      const { from: start, to: end } = formatRangeInModel(
        model,
        from,
        to,
        format,
      );
      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({
        id: updated!.id,
        formattedRange: [start, end],
        contentLength: updated!.content.length,
      });
    },
  );

  server.tool(
    "docs_insert_table",
    "Insert a table at a rendered-text position in the document (inserted at the nearest block boundary).",
    {
      id: idSchema.describe("Document id"),
      rows: z.number().int().min(1).max(MAX_TABLE_ROWS).describe(
        "Number of rows",
      ),
      cols: z.number().int().min(1).max(MAX_TABLE_COLS).describe(
        "Number of columns",
      ),
      position: positionSchema.optional().describe(
        "Rendered-text position to insert at (default: end)",
      ),
    },
    async (
      { id, rows, cols, position }: {
        id: string;
        rows: number;
        cols: number;
        position?: number;
      },
    ) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      const model = loadDocModel(doc.content);
      const table = buildTableNode(rows, cols);
      const pos = position !== undefined ? position : docTextLength(model);
      const insertedAt = insertBlockAtOffset(model, pos, table);
      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({
        id: updated!.id,
        insertedAt,
        rows,
        cols,
        contentLength: updated!.content.length,
      });
    },
  );

  server.tool(
    "docs_insert_image",
    "Insert an image node at a rendered-text position in the document (inserted at the nearest block boundary).",
    {
      id: idSchema.describe("Document id"),
      url: urlSchema.refine(
        (value) => isSafeUrl(value, { image: true }),
        "Image URL must be http(s) or a supported data image",
      ).describe("Image URL"),
      alt: z.string().max(MAX_ALT_LENGTH).optional().describe("Alt text"),
      position: positionSchema.optional().describe(
        "Rendered-text position to insert at (default: end)",
      ),
    },
    async (
      { id, url, alt, position }: {
        id: string;
        url: string;
        alt?: string;
        position?: number;
      },
    ) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      const safeUrl = getSafeUrl(url, { image: true });
      if (!safeUrl) return error("Invalid image URL");

      const model = loadDocModel(doc.content);
      const imageNode: TiptapNode = {
        type: "image",
        attrs: {
          src: safeUrl,
          alt: alt ? alt.slice(0, MAX_ALT_LENGTH) : null,
        },
      };
      const pos = position !== undefined ? position : docTextLength(model);
      const insertedAt = insertBlockAtOffset(model, pos, imageNode);
      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({
        id: updated!.id,
        insertedAt,
        contentLength: updated!.content.length,
      });
    },
  );

  server.tool(
    "docs_insert_link",
    "Insert a hyperlink at a rendered-text position in the document.",
    {
      id: idSchema.describe("Document id"),
      url: urlSchema.refine(
        (value) => isSafeUrl(value),
        "Link URL must be http(s), mailto, or relative",
      ).describe("Link URL"),
      text: textPatchSchema.describe("Link display text"),
      position: positionSchema.optional().describe(
        "Rendered-text position to insert at (default: end)",
      ),
    },
    async (
      { id, url, text: linkText, position }: {
        id: string;
        url: string;
        text: string;
        position?: number;
      },
    ) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      const safeUrl = getSafeUrl(url);
      if (!safeUrl) return error("Invalid link URL");

      const model = loadDocModel(doc.content);
      const pos = position !== undefined ? position : docTextLength(model);
      const insertedAt = insertLinkAtOffset(model, pos, linkText, safeUrl);
      const updated = await store.update(id, {
        content: serializeDocModel(model),
      });
      return json({
        id: updated!.id,
        insertedAt,
        contentLength: updated!.content.length,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // Screenshot
  // ---------------------------------------------------------------------------

  server.tool(
    "docs_screenshot",
    "Render a document as a PNG image for visual inspection.",
    {
      id: idSchema.describe("Document ID"),
      width: screenshotWidthSchema.optional().describe(
        "Image width in pixels (default: 800)",
      ),
      height: screenshotHeightSchema.optional().describe(
        "Image height in pixels (default: 1000)",
      ),
    },
    async (
      { id, width, height }: { id: string; width?: number; height?: number },
    ) => {
      const unavailable = docsScreenshotUnavailableMessage(
        runtimeCapabilities.screenshot,
      );
      if (unavailable) return error(unavailable);

      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      try {
        const size = normalizeScreenshotDimensions(width, height);
        const rendererModule = "./lib/doc-renderer.ts";
        const { renderDocumentToBuffer } = await import(
          rendererModule
        ) as typeof import("./lib/doc-renderer.ts");
        const buf = renderDocumentToBuffer(
          doc.title,
          documentContentToSafeHtml(doc.content),
          size,
        );
        const base64 = bytesToBase64(buf);
        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: "image/png",
            },
          ],
        };
      } catch (e) {
        return error(`Failed to render document: ${String(e)}`);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  server.tool(
    "docs_export_html",
    "Export a document as a full HTML page.",
    {
      id: idSchema.describe("Document id"),
    },
    async ({ id }: { id: string }) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      return text(buildExportHtml(doc.title, doc.content));
    },
  );

  server.tool(
    "docs_export_text",
    "Export a document as plain text (HTML tags stripped).",
    {
      id: idSchema.describe("Document id"),
    },
    async ({ id }: { id: string }) => {
      const doc = await store.get(id);
      if (!doc) return error(`Document not found: ${id}`);

      // Normalize browser-created TipTap JSON to HTML first, then strip tags
      // for plain text export so JSON docs don't dump raw JSON.
      const html = documentContentToSafeHtml(doc.content);
      const plainText = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/tr>/gi, "\n")
        .replace(/<\/td>/gi, "\t")
        .replace(/<\/th>/gi, "\t")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return text(plainText);
    },
  );
}

/**
 * Create a request handler for the MCP server that works with Hono.
 * Handles POST /mcp for Streamable HTTP transport.
 */
export function createMcpRequestHandler(
  createServer: () => McpServer,
  options: DocsMcpAuthOptions = {},
) {
  return createSharedMcpRequestHandler(createServer, options);
}
