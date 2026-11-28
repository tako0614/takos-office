/**
 * Extracts a concise plain-text snippet from TipTap JSON or plain/HTML text
 * content for document library preview cards.
 */
export function extractDocumentPreview(
  content: string,
  maxLength = 240,
): string {
  const raw = content?.trim();
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    const parts: string[] = [];
    let length = 0;
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object" || length >= maxLength) return;
      const rec = node as { text?: unknown; content?: unknown };
      if (typeof rec.text === "string" && rec.text.trim()) {
        parts.push(rec.text.trim());
        length += rec.text.length;
      }
      if (Array.isArray(rec.content)) {
        for (const child of rec.content) {
          visit(child);
          if (length >= maxLength) break;
        }
      }
    };
    visit(parsed);
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    if (joined) {
      return joined.length > maxLength
        ? `${joined.slice(0, maxLength - 1)}…`
        : joined;
    }
  } catch {
    const plain = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (plain) {
      return plain.length > maxLength
        ? `${plain.slice(0, maxLength - 1)}…`
        : plain;
    }
  }
  return "";
}
