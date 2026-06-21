// Pure text-mapping helpers for the Find & Replace panel.
//
// The component extracts the editor's text nodes as a list of spans, each with
// the ProseMirror position of its first character (`from`). Concatenating the
// span texts gives the searchable document text; these helpers find query
// matches in that concatenated text and map each match back to a ProseMirror
// {from, to} range. Keeping the mapping pure lets us unit-test the offset math
// without a live editor.

/** A run of text in the document and the PM position of its first character. */
export interface TextSpan {
  text: string;
  /** ProseMirror position immediately before this span's first character. */
  from: number;
}

/** A located match as a ProseMirror range. */
export interface MatchRange {
  from: number;
  to: number;
}

/** Concatenate spans into the single searchable document string. */
export function spansToText(spans: TextSpan[]): string {
  let out = "";
  for (const span of spans) out += span.text;
  return out;
}

/**
 * Map a [start, end) range expressed in concatenated-text offsets to a
 * ProseMirror {from, to} range using the spans' PM positions. Returns null if
 * the offsets fall outside the spans (defensive; should not happen for matches
 * found within `spansToText`).
 */
export function offsetToPmRange(
  spans: TextSpan[],
  start: number,
  end: number,
): MatchRange | null {
  const total = spansToText(spans).length;
  if (start < 0 || end > total || start > end) return null;

  let consumed = 0;
  let from: number | null = null;
  let to: number | null = null;

  for (const span of spans) {
    const spanStart = consumed;
    const spanEnd = consumed + span.text.length;

    // The start of a match maps to the span that *contains* its first
    // character: prefer a strictly-interior offset so a boundary offset is
    // attributed to the following span (whose PM position differs across a
    // block boundary), not the trailing edge of the previous span.
    if (
      from === null &&
      (start < spanEnd || (start === spanEnd && spanEnd === total))
    ) {
      from = span.from + (start - spanStart);
    }
    // The end of a match maps to the span where the last character lives: the
    // first span whose range reaches the end offset.
    if (to === null && end <= spanEnd) {
      to = span.from + (end - spanStart);
    }
    consumed = spanEnd;
    if (from !== null && to !== null) break;
  }

  if (from === null || to === null) return null;
  return { from, to };
}

/**
 * Find every (non-overlapping) occurrence of `query` in the spans' concatenated
 * text and return them as ProseMirror ranges in document order.
 *
 * - Empty query yields no matches.
 * - `caseSensitive` defaults to false (case-insensitive search).
 */
export function findMatches(
  spans: TextSpan[],
  query: string,
  caseSensitive = false,
): MatchRange[] {
  if (!query) return [];
  const haystackRaw = spansToText(spans);
  const haystack = caseSensitive ? haystackRaw : haystackRaw.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  const ranges: MatchRange[] = [];
  let searchFrom = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, searchFrom);
    if (idx === -1) break;
    const range = offsetToPmRange(spans, idx, idx + needle.length);
    if (range) ranges.push(range);
    // Advance past this match to keep matches non-overlapping.
    searchFrom = idx + needle.length;
  }
  return ranges;
}

/**
 * Pick the index of the next match at/after a cursor position, wrapping to the
 * first match. Returns -1 when there are no matches.
 */
export function nextMatchIndex(
  matches: MatchRange[],
  cursor: number,
): number {
  if (matches.length === 0) return -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= cursor) return i;
  }
  return 0;
}

/**
 * Pick the index of the previous match strictly before a cursor position,
 * wrapping to the last match. Returns -1 when there are no matches.
 */
export function previousMatchIndex(
  matches: MatchRange[],
  cursor: number,
): number {
  if (matches.length === 0) return -1;
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].to <= cursor) return i;
  }
  return matches.length - 1;
}
