// Client-side document export: build Markdown / plain text / HTML from the
// current document content and trigger a browser file download.
//
// HTML and plain text reuse the exact serialization the MCP export path uses
// (buildExportHtml / documentContentToPlainText, both exported pure helpers in
// mcp.ts) so a downloaded file matches what an agent would get over MCP.
// Markdown uses the dedicated converter in lib/markdown.ts.

import { buildExportHtml, documentContentToPlainText } from "../mcp.ts";
import { documentContentToMarkdown } from "./markdown.ts";

export type ExportFormat = "markdown" | "text" | "html";

interface ExportSpec {
  extension: string;
  mimeType: string;
}

const EXPORT_SPECS: Record<ExportFormat, ExportSpec> = {
  markdown: { extension: "md", mimeType: "text/markdown;charset=utf-8" },
  text: { extension: "txt", mimeType: "text/plain;charset=utf-8" },
  html: { extension: "html", mimeType: "text/html;charset=utf-8" },
};

/** Serialize the document content to the requested export format. */
export function serializeDocument(
  format: ExportFormat,
  title: string,
  content: string,
): string {
  switch (format) {
    case "markdown":
      return documentContentToMarkdown(content);
    case "text":
      return documentContentToPlainText(content);
    case "html":
      return buildExportHtml(title || "Untitled", content);
  }
}

/**
 * Turn a document title into a filesystem-friendly base name. Falls back to
 * "document" when the title is empty or strips to nothing.
 */
export function sanitizeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[\\/:*?"<>|]/g, "") // characters illegal in common filesystems
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return base.length > 0 ? base : "document";
}

/** Build the download filename for a title + format. */
export function exportFilename(format: ExportFormat, title: string): string {
  return `${sanitizeFilename(title)}.${EXPORT_SPECS[format].extension}`;
}

/**
 * Serialize and download the document in the given format via a temporary
 * anchor + object URL. No-op outside a browser (no document object).
 */
export function downloadDocument(
  format: ExportFormat,
  title: string,
  content: string,
): void {
  const doc = globalThis.document;
  if (!doc) return;

  const data = serializeDocument(format, title, content);
  const blob = new Blob([data], { type: EXPORT_SPECS[format].mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = exportFilename(format, title);
  doc.body.appendChild(anchor);
  anchor.click();
  doc.body.removeChild(anchor);
  // Revoke on the next tick so the click has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
