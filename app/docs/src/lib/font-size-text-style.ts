import TextStyle from "@tiptap/extension-text-style";

const VALID_FONT_SIZE = /^\d+(?:\.\d+)?(?:pt|px)?$/;

export function parseFontSizeAttribute(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return VALID_FONT_SIZE.test(trimmed) ? trimmed : null;
}

export function renderFontSizeAttribute(
  fontSize: unknown,
): Record<string, string> {
  if (typeof fontSize !== "string") return {};
  const valid = parseFontSizeAttribute(fontSize);
  return valid ? { style: `font-size: ${valid}` } : {};
}

/**
 * Extends TipTap's `TextStyle` mark with a validated `fontSize` attribute so
 * Docs toolbar font-size changes persist in ProseMirror state, render as inline
 * CSS, and stay reactive in the toolbar `<select>`.
 */
export const FontSizeTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element) =>
          parseFontSizeAttribute(element.style?.fontSize),
        renderHTML: (attributes) =>
          renderFontSizeAttribute(attributes.fontSize),
      },
    };
  },
});
