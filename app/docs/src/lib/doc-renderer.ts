/**
 * Server-side document renderer using node-canvas (npm:canvas).
 *
 * Parses the HTML content of a document and renders it onto a canvas
 * with basic formatting (headings, bold, italic, underline, lists, etc.).
 */

import { createCanvas } from "canvas";

interface RenderOptions {
  width?: number;
  height?: number;
}

interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;
  color: string;
}

interface Block {
  runs: TextRun[];
  indent: number;
  bullet?: string;
  marginBottom: number;
}

const DEFAULT_FONT_SIZE = 14;
const LINE_HEIGHT_FACTOR = 1.5;
const MARGIN_LEFT = 40;
const MARGIN_TOP = 40;
const MARGIN_RIGHT = 40;

/**
 * Render a document to a PNG buffer.
 */
export function renderDocumentToBuffer(
  title: string,
  htmlContent: string,
  options?: RenderOptions,
): Uint8Array {
  const width = options?.width ?? 800;
  const height = options?.height ?? 1000;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const maxTextWidth = width - MARGIN_LEFT - MARGIN_RIGHT;
  let cursorY = MARGIN_TOP;

  // Draw title
  ctx.fillStyle = "#111827";
  ctx.font = "bold 28px sans-serif";
  ctx.textBaseline = "top";
  const titleLines = wrapText(ctx, title, maxTextWidth);
  for (const line of titleLines) {
    if (cursorY > height - 40) break;
    ctx.fillText(line, MARGIN_LEFT, cursorY);
    cursorY += 28 * LINE_HEIGHT_FACTOR;
  }
  cursorY += 12;

  // Separator line
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, cursorY);
  ctx.lineTo(width - MARGIN_RIGHT, cursorY);
  ctx.stroke();
  cursorY += 16;

  // Parse HTML to blocks
  const blocks = parseHtmlToBlocks(htmlContent);

  // Render blocks
  for (const block of blocks) {
    if (cursorY > height - 40) {
      // Overflow indicator
      ctx.fillStyle = "#9ca3af";
      ctx.font = "italic 12px sans-serif";
      ctx.fillText("... (content continues below)", MARGIN_LEFT, cursorY);
      break;
    }
    cursorY = renderBlock(ctx, block, MARGIN_LEFT, cursorY, maxTextWidth);
    cursorY += block.marginBottom;
  }

  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

function parseHtmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  if (!html || html.trim().length === 0) return blocks;

  // Normalize line breaks
  const normalized = html.replace(/<br\s*\/?>/gi, "\n");

  // Split into block-level elements
  const blockPattern =
    /<(h[1-6]|p|li|tr|div|blockquote)((?:\s[^>]*)?)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = blockPattern.exec(normalized)) !== null) {
    // Handle any text between blocks
    const between = normalized.slice(lastIndex, match.index).trim();
    if (between) {
      const stripped = stripTags(between).trim();
      if (stripped) {
        blocks.push({
          runs: [
            {
              text: stripped,
              bold: false,
              italic: false,
              underline: false,
              fontSize: DEFAULT_FONT_SIZE,
              color: "#374151",
            },
          ],
          indent: 0,
          marginBottom: 8,
        });
      }
    }
    lastIndex = match.index + match[0].length;

    const tag = match[1].toLowerCase();
    const innerHtml = match[3];

    const block = tagToBlock(tag, innerHtml);
    blocks.push(block);
  }

  // Remaining text after last block
  const remaining = normalized.slice(lastIndex).trim();
  if (remaining) {
    const stripped = stripTags(remaining).trim();
    if (stripped) {
      blocks.push({
        runs: [
          {
            text: stripped,
            bold: false,
            italic: false,
            underline: false,
            fontSize: DEFAULT_FONT_SIZE,
            color: "#374151",
          },
        ],
        indent: 0,
        marginBottom: 8,
      });
    }
  }

  // If no blocks were parsed, treat entire content as plain text
  if (blocks.length === 0) {
    const plainText = stripTags(html).trim();
    if (plainText) {
      blocks.push({
        runs: [
          {
            text: plainText,
            bold: false,
            italic: false,
            underline: false,
            fontSize: DEFAULT_FONT_SIZE,
            color: "#374151",
          },
        ],
        indent: 0,
        marginBottom: 8,
      });
    }
  }

  return blocks;
}

function tagToBlock(tag: string, innerHtml: string): Block {
  const runs = parseInlineRuns(innerHtml);

  switch (tag) {
    case "h1":
      return {
        runs: runs.map((r) => ({
          ...r,
          bold: true,
          fontSize: 28,
          color: "#111827",
        })),
        indent: 0,
        marginBottom: 16,
      };
    case "h2":
      return {
        runs: runs.map((r) => ({
          ...r,
          bold: true,
          fontSize: 22,
          color: "#1f2937",
        })),
        indent: 0,
        marginBottom: 12,
      };
    case "h3":
      return {
        runs: runs.map((r) => ({
          ...r,
          bold: true,
          fontSize: 18,
          color: "#374151",
        })),
        indent: 0,
        marginBottom: 10,
      };
    case "h4":
    case "h5":
    case "h6":
      return {
        runs: runs.map((r) => ({
          ...r,
          bold: true,
          fontSize: 16,
          color: "#374151",
        })),
        indent: 0,
        marginBottom: 8,
      };
    case "li":
      return {
        runs,
        indent: 20,
        bullet: "\u2022",
        marginBottom: 4,
      };
    case "blockquote":
      return {
        runs: runs.map((r) => ({
          ...r,
          italic: true,
          color: "#6b7280",
        })),
        indent: 20,
        marginBottom: 10,
      };
    default:
      return { runs, indent: 0, marginBottom: 8 };
  }
}

function parseInlineRuns(html: string): TextRun[] {
  // Simple inline tag parsing
  const runs: TextRun[] = [];
  const remaining = html;

  // Flatten inline tags into runs
  const text = stripTags(remaining).trim();
  if (!text) return runs;

  // Detect inline formatting from wrapping tags
  const hasBold = /<(strong|b)\b/i.test(html) && /<\/(strong|b)>/i.test(html);
  const hasItalic = /<(em|i)\b/i.test(html) && /<\/(em|i)>/i.test(html);
  const hasUnderline = /<u\b/i.test(html) && /<\/u>/i.test(html);

  runs.push({
    text,
    bold: hasBold,
    italic: hasItalic,
    underline: hasUnderline,
    fontSize: DEFAULT_FONT_SIZE,
    color: "#374151",
  });

  return runs;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type Ctx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function renderBlock(
  ctx: Ctx,
  block: Block,
  x: number,
  y: number,
  maxWidth: number,
): number {
  const effectiveX = x + block.indent;
  const effectiveWidth = maxWidth - block.indent;
  let cursorY = y;

  // Draw bullet
  if (block.bullet) {
    const firstRun = block.runs[0];
    const fontSize = firstRun?.fontSize ?? DEFAULT_FONT_SIZE;
    ctx.fillStyle = firstRun?.color ?? "#374151";
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(block.bullet, effectiveX - 14, cursorY);
  }

  for (const run of block.runs) {
    const bold = run.bold ? "bold " : "";
    const italic = run.italic ? "italic " : "";
    ctx.font = `${italic}${bold}${run.fontSize}px sans-serif`;
    ctx.fillStyle = run.color;
    ctx.textBaseline = "top";

    const lines = wrapText(ctx, run.text, effectiveWidth);
    const lineHeight = run.fontSize * LINE_HEIGHT_FACTOR;

    for (const line of lines) {
      ctx.fillText(line, effectiveX, cursorY);

      // Underline
      if (run.underline) {
        const metrics = ctx.measureText(line);
        ctx.strokeStyle = run.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(effectiveX, cursorY + run.fontSize + 2);
        ctx.lineTo(effectiveX + metrics.width, cursorY + run.fontSize + 2);
        ctx.stroke();
      }

      cursorY += lineHeight;
    }
  }

  return cursorY;
}

function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }

  return lines;
}
