import { expect, test } from "bun:test";
import {
  collectOfficeItems,
  type OfficeStores,
  searchOfficeItems,
} from "../office-items.ts";

function stores(over: Partial<{
  docs: { id: string; title: string; updatedAt: string }[];
  docsSearch: { id: string; title: string; updatedAt: string }[];
  slides: { id: string; title: string; updatedAt: string }[];
  sheets: { id: string; title: string; updatedAt: string }[];
}> = {}): OfficeStores {
  return {
    docs: {
      list: () => Promise.resolve(over.docs ?? []),
      search: () => Promise.resolve(over.docsSearch ?? []),
    },
    slide: { list: () => Promise.resolve(over.slides ?? []) },
    sheet: { listSpreadsheets: () => Promise.resolve(over.sheets ?? []) },
  };
}

test("collectOfficeItems merges all three apps, newest first", async () => {
  const items = await collectOfficeItems(stores({
    docs: [{ id: "d1", title: "Doc", updatedAt: "2026-06-01T00:00:00Z" }],
    slides: [{ id: "p1", title: "Deck", updatedAt: "2026-06-03T00:00:00Z" }],
    sheets: [{ id: "s1", title: "Budget", updatedAt: "2026-06-02T00:00:00Z" }],
  }));
  expect(items.map((i) => [i.app, i.id])).toEqual([
    ["slide", "p1"],
    ["sheet", "s1"],
    ["docs", "d1"],
  ]);
});

test("collectOfficeItems falls back to Untitled and tolerates a failing store", async () => {
  const s = stores({ slides: [{ id: "p1", title: "  ", updatedAt: "2026-06-03T00:00:00Z" }] });
  s.docs.list = () => Promise.reject(new Error("boom"));
  const items = await collectOfficeItems(s);
  expect(items).toEqual([
    { app: "slide", id: "p1", title: "Untitled", updatedAt: "2026-06-03T00:00:00Z" },
  ]);
});

test("searchOfficeItems uses docs.search and filters slide/sheet by title", async () => {
  const items = await searchOfficeItems(
    stores({
      docsSearch: [{ id: "d1", title: "Report", updatedAt: "2026-06-01T00:00:00Z" }],
      slides: [
        { id: "p1", title: "Budget deck", updatedAt: "2026-06-02T00:00:00Z" },
        { id: "p2", title: "Other", updatedAt: "2026-06-04T00:00:00Z" },
      ],
      sheets: [{ id: "s1", title: "BUDGET", updatedAt: "2026-06-03T00:00:00Z" }],
    }),
    "budget",
  );
  expect(items.map((i) => i.id)).toEqual(["s1", "p1", "d1"]);
});

test("searchOfficeItems returns nothing for a blank query", async () => {
  expect(await searchOfficeItems(stores({ docsSearch: [] }), "   ")).toEqual([]);
});
