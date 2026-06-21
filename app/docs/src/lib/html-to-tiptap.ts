/**
 * Minimal HTML -> TipTap converter for legacy documents.
 *
 * Legacy `.takosdoc` files predating the TipTap JSON format stored rendered
 * HTML. Flattening that to plain text on the first edit dropped headings,
 * bold/italic, links and lists. This converter preserves the common block and
 * inline structure instead. It is intentionally small (no full DOM): block
 * elements are tokenized, then inline content is walked with a mark stack.
 * Anything it does not recognise degrades to text, never to raw tags.
 */

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}
interface Node {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: Mark[];
}

const VOID_INLINE = new Set(["br"]);
const INLINE_MARKS: Record<string, Mark | null> = {
  strong: { type: "bold" },
  b: { type: "bold" },
  em: { type: "italic" },
  i: { type: "italic" },
  u: { type: "underline" },
  s: { type: "strike" },
  strike: { type: "strike" },
  del: { type: "strike" },
  code: { type: "code" },
  mark: { type: "highlight" },
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Parse inline HTML into TipTap text nodes, tracking a stack of active marks. */
function parseInline(html: string): Node[] {
  const nodes: Node[] = [];
  const markStack: Mark[] = [];
  const tagRe = /<\/?([a-z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;
  let lastIndex = 0;

  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    if (!text) return;
    const node: Node = { type: "text", text };
    if (markStack.length) node.marks = markStack.map((m) => ({ ...m }));
    nodes.push(node);
  };

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    pushText(html.slice(lastIndex, match.index));
    lastIndex = tagRe.lastIndex;

    const tag = match[1].toLowerCase();
    const isClose = match[0].startsWith("</");

    if (tag === "br") {
      nodes.push({ type: "hardBreak" });
      continue;
    }
    if (tag === "a") {
      if (isClose) {
        const i = markStack.findIndex((m) => m.type === "link");
        if (i >= 0) markStack.splice(i, 1);
      } else {
        const href = match[2].match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i);
        markStack.push({
          type: "link",
          attrs: { href: href ? href[1] ?? href[2] ?? "" : "" },
        });
      }
      continue;
    }
    const mark = INLINE_MARKS[tag];
    if (mark) {
      if (isClose) {
        const i = markStack.map((m) => m.type).lastIndexOf(mark.type);
        if (i >= 0) markStack.splice(i, 1);
      } else {
        markStack.push(mark);
      }
    }
    // Unknown inline tags are dropped (their text content is still emitted).
  }
  pushText(html.slice(lastIndex));
  return nodes;
}

function block(type: string, inner: string, attrs?: Record<string, unknown>): Node {
  const content = parseInline(inner).filter((n) =>
    n.type !== "text" || (n.text ?? "") !== ""
  );
  const node: Node = { type };
  if (attrs) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

/**
 * Convert legacy HTML into TipTap block nodes. Returns `null` when the input
 * has no recognisable block structure, so the caller can fall back.
 */
export function htmlToTiptapBlocks(html: string): Node[] | null {
  const blocks: Node[] = [];
  const blockRe =
    /<(h[1-6]|p|blockquote|pre|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let matchedAny = false;

  while ((match = blockRe.exec(html)) !== null) {
    matchedAny = true;
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (/^h[1-6]$/.test(tag)) {
      blocks.push(block("heading", inner, { level: Number(tag[1]) }));
    } else if (tag === "li") {
      blocks.push(block("paragraph", inner));
    } else if (tag === "blockquote") {
      blocks.push({ type: "blockquote", content: [block("paragraph", inner)] });
    } else if (tag === "pre") {
      blocks.push(block("codeBlock", inner));
    } else {
      blocks.push(block("paragraph", inner));
    }
  }

  if (!matchedAny) return null;
  return blocks.length ? blocks : null;
}
