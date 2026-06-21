import { expect, test } from "bun:test";
import { parseCsv } from "../lib/csv-parser.ts";

test("parseCsv parses simple CSV", () => {
  const result = parseCsv("a,b,c\n1,2,3");
  expect(result).toEqual([
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv handles quoted fields", () => {
  const result = parseCsv('"hello","world"');
  expect(result).toEqual([["hello", "world"]]);
});

test("parseCsv handles escaped quotes inside quoted fields", () => {
  const result = parseCsv('"he said ""hi""","ok"');
  expect(result).toEqual([['he said "hi"', "ok"]]);
});

test("parseCsv handles CRLF line endings", () => {
  const result = parseCsv("a,b\r\nc,d\r\n");
  expect(result).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("parseCsv handles LF line endings", () => {
  const result = parseCsv("a,b\nc,d\n");
  expect(result).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("parseCsv handles empty fields", () => {
  const result = parseCsv(",b,\n,,");
  expect(result).toEqual([
    ["", "b", ""],
    ["", "", ""],
  ]);
});

test("parseCsv handles single column", () => {
  const result = parseCsv("a\nb\nc");
  expect(result).toEqual([["a"], ["b"], ["c"]]);
});

test("parseCsv handles single row", () => {
  const result = parseCsv("a,b,c");
  expect(result).toEqual([["a", "b", "c"]]);
});

test("parseCsv returns empty array for empty input", () => {
  const result = parseCsv("");
  expect(result).toEqual([]);
});

test("parseCsv handles commas inside quoted fields", () => {
  const result = parseCsv('"a,b",c');
  expect(result).toEqual([["a,b", "c"]]);
});

test("parseCsv handles newlines inside quoted fields", () => {
  const result = parseCsv('"line1\nline2",b');
  expect(result).toEqual([["line1\nline2", "b"]]);
});

test("parseCsv handles mixed quoted and unquoted fields", () => {
  const result = parseCsv('plain,"quoted",plain2');
  expect(result).toEqual([["plain", "quoted", "plain2"]]);
});

test("parseCsv handles bare CR line endings", () => {
  const result = parseCsv("a,b\rc,d");
  expect(result).toEqual([
    ["a", "b"],
    ["c", "d"],
  ]);
});
