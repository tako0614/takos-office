import { expect, test } from "bun:test";

import {
  findMatches,
  nextMatchIndex,
  offsetToPmRange,
  previousMatchIndex,
  spansToText,
  type TextSpan,
} from "../lib/find-replace.ts";

// Two paragraphs. In a real ProseMirror doc the first paragraph's text starts
// at position 1 (entering the paragraph consumes position 0), and the second
// paragraph's text starts after the first paragraph's close + open tokens.
//   p("hello world")  -> text "hello world" at pos 1  (chars 1..12)
//   p("world peace")  -> text "world peace" at pos 15 (chars 15..25)
const SPANS: TextSpan[] = [
  { text: "hello world", from: 1 },
  { text: "world peace", from: 15 },
];

test("spansToText concatenates span text in order", () => {
  expect(spansToText(SPANS)).toEqual("hello worldworld peace");
});

test("offsetToPmRange maps a concatenated-text range into PM coordinates", () => {
  // "hello" is offsets [0,5) -> PM [1,6)
  expect(offsetToPmRange(SPANS, 0, 5)).toEqual({ from: 1, to: 6 });
  // "peace" is the tail of the second span: offsets [17,22) -> PM [21,26)
  expect(offsetToPmRange(SPANS, 17, 22)).toEqual({ from: 21, to: 26 });
});

test("offsetToPmRange returns null for out-of-range offsets", () => {
  expect(offsetToPmRange(SPANS, 0, 999)).toBeNull();
});

test("findMatches finds case-insensitive matches across span boundaries", () => {
  // "world" appears 3 times: end of span 1, and start+inside span 2.
  const matches = findMatches(SPANS, "World");
  expect(matches).toEqual([
    { from: 7, to: 12 }, // "world" inside "hello world"
    { from: 15, to: 20 }, // "world" at start of "world peace"
  ]);
});

test("findMatches respects case sensitivity when enabled", () => {
  const spans: TextSpan[] = [{ text: "Aa aa AA", from: 1 }];
  expect(findMatches(spans, "aa", true)).toEqual([{ from: 4, to: 6 }]);
  expect(findMatches(spans, "aa", false)).toHaveLength(3);
});

test("findMatches returns no matches for an empty query", () => {
  expect(findMatches(SPANS, "")).toEqual([]);
});

test("findMatches returns non-overlapping matches", () => {
  const spans: TextSpan[] = [{ text: "aaaa", from: 1 }];
  // "aa" should match at offsets 0 and 2, not 0/1/2/3.
  expect(findMatches(spans, "aa")).toEqual([
    { from: 1, to: 3 },
    { from: 3, to: 5 },
  ]);
});

test("nextMatchIndex picks the first match at/after the cursor, wrapping", () => {
  const matches = findMatches(SPANS, "world");
  // cursor before everything -> first match
  expect(nextMatchIndex(matches, 0)).toEqual(0);
  // cursor between the two matches -> second match
  expect(nextMatchIndex(matches, 13)).toEqual(1);
  // cursor past the last match -> wraps to first
  expect(nextMatchIndex(matches, 100)).toEqual(0);
  expect(nextMatchIndex([], 0)).toEqual(-1);
});

test("previousMatchIndex picks the last match before the cursor, wrapping", () => {
  const matches = findMatches(SPANS, "world");
  // cursor past everything -> last match
  expect(previousMatchIndex(matches, 100)).toEqual(1);
  // cursor right after the first match end -> first match
  expect(previousMatchIndex(matches, 12)).toEqual(0);
  // cursor before everything -> wraps to last
  expect(previousMatchIndex(matches, 0)).toEqual(1);
  expect(previousMatchIndex([], 0)).toEqual(-1);
});
