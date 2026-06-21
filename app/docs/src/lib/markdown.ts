// Pure TipTap-JSON -> Markdown converter for the client-side Export menu.
//
// This is a standalone, dependency-free serializer over the same TipTap doc
// shape the browser editor stores (components/Editor.tsx -> editor.getJSON()).
// It is intentionally independent of mcp.ts (which serializes to HTML/text);
// keeping it separate means the MCP export behavior is untouched.
//
// Supported nodes: doc, paragraph, heading (1-6), bulletList, orderedList,
// listItem, blockquote, codeBlock, horizontalRule, hardBreak, text, image.
// Supported marks: bold, italic, strike, code, link.

export interface MarkdownMark {
  type?: unknown;
  attrs?: Record<string, unknown>;
}

export interface MarkdownNode {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: MarkdownNode[];
  marks?: MarkdownMark[];
}

/** Escape Markdown-significant characters in inline text runs. */
function escapeInline(text: string): string {
  // Backslash first so we don't double-escape the escapes we add below.
  return text.replace(/([\\`*_{}\[\]()#+\-.!~>|])/g, "\\$1");
}

/** Render a text node's content with its marks applied (code wins outermost). */
function renderText(node: MarkdownNode): string {
  const raw = String(node.text ?? "");
  const marks = Array.isArray(node.marks) ? node.marks : [];

  const hasCode = marks.some((m) => m.type === "code");
  // Inside an inline-code span Markdown does not interpret other syntax, so we
  // emit the literal text and skip escaping entirely.
  let out = hasCode ? raw : escapeInline(raw);

  if (hasCode) {
    out = `\`${raw}\``;
  }

  // Apply emphasis marks. Order is stable: strike, italic, bold (innermost ->
  // outermost) so the result reads **_text_** style.
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
    }
  }

  // Links wrap the (already mark-decorated) label.
  const link = marks.find((m) => m.type === "link");
  if (link && typeof link.attrs?.href === "string") {
    const href = link.attrs.href.trim();
    if (href) out = `[${out}](${href})`;
  }

  return out;
}

/** Render a sequence of inline nodes (text / image / hardBreak) to a string. */
function renderInline(nodes: MarkdownNode[] | undefined): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += renderText(node);
        break;
      case "hardBreak":
        // Two trailing spaces + newline is the Markdown hard line break.
        out += "  \n";
        break;
      case "image": {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src.trim() : "";
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        const title = typeof node.attrs?.title === "string" && node.attrs.title
          ? ` "${node.attrs.title}"`
          : "";
        if (src) out += `![${alt}](${src}${title})`;
        break;
      }
      default:
        // Unknown inline content: fall back to its rendered children/text.
        if (Array.isArray(node.content)) out += renderInline(node.content);
        else if (typeof node.text === "string") out += renderText(node);
    }
  }
  return out;
}

/** Indent every line of a block by the given prefix (for nested list items). */
function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join("\n");
}

function renderList(node: MarkdownNode, ordered: boolean): string {
  const items = Array.isArray(node.content) ? node.content : [];
  const startRaw = ordered && typeof node.attrs?.start === "number"
    ? node.attrs.start
    : 1;
  const lines: string[] = [];

  items.forEach((item, index) => {
    const marker = ordered ? `${startRaw + index}. ` : "- ";
    const pad = " ".repeat(marker.length);
    // A list item contains block children (usually one paragraph, possibly a
    // nested list). Render each, then indent continuation lines under the
    // marker so nested content stays inside the item.
    const childBlocks = Array.isArray(item.content) ? item.content : [];
    const rendered = childBlocks
      .map((child) => renderBlock(child))
      .filter((s) => s.length > 0)
      .join("\n");
    const indented = indent(rendered, pad).slice(pad.length); // first line keeps marker
    lines.push(marker + indented);
  });

  return lines.join("\n");
}

function renderBlock(node: MarkdownNode): string {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content);
    case "heading": {
      const rawLevel = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));
      return `${"#".repeat(level)} ${renderInline(node.content)}`;
    }
    case "bulletList":
    case "taskList":
      return renderList(node, false);
    case "orderedList":
      return renderList(node, true);
    case "listItem":
    case "taskItem":
      // Reached when a list item is rendered directly (not via renderList);
      // serialize its children stacked.
      return (Array.isArray(node.content) ? node.content : [])
        .map(renderBlock)
        .filter((s) => s.length > 0)
        .join("\n");
    case "blockquote": {
      const inner = (Array.isArray(node.content) ? node.content : [])
        .map(renderBlock)
        .filter((s) => s.length > 0)
        .join("\n\n");
      return inner
        .split("\n")
        .map((line) => (line.length > 0 ? `> ${line}` : ">"))
        .join("\n");
    }
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (Array.isArray(node.content) ? node.content : [])
        .map((n) => String(n.text ?? ""))
        .join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image":
    case "hardBreak":
    case "text":
      // Bare inline node at block level: wrap as a paragraph.
      return renderInline([node]);
    default:
      // Unknown block: recurse into children so we don't drop content.
      return (Array.isArray(node.content) ? node.content : [])
        .map(renderBlock)
        .filter((s) => s.length > 0)
        .join("\n\n");
  }
}

/**
 * Convert a TipTap document node into a Markdown string. Blocks are separated
 * by blank lines; the result has a single trailing newline.
 */
export function tiptapJsonToMarkdown(doc: MarkdownNode): string {
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  const rendered = blocks
    .map((block) => renderBlock(block))
    // An empty paragraph renders to "" — keep it so adjacent blank lines are a
    // deliberate blank paragraph, but trim leading/trailing blanks at the end.
    .join("\n\n");
  return rendered.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Parse a stored Document.content string (canonical TipTap JSON, or plain text
 * fallback) and convert it to Markdown. Mirrors Editor.tsx's parse fallback so
 * a legacy plain-text doc still exports sensibly.
 */
export function documentContentToMarkdown(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as MarkdownNode;
      if (parsed && parsed.type === "doc") return tiptapJsonToMarkdown(parsed);
    } catch {
      // fall through
    }
  }
  // Plain text: each line becomes a paragraph already; just normalize.
  return content.trim() + "\n";
}
