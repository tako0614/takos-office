/**
 * Cross-editor aggregation for the Office shell.
 *
 * Merges the docs / slide / sheet listings into one recent-items view and a
 * cross-app search, so the shell at `/` can surface everything in a Workspace
 * without the client juggling three subpath APIs. Kept store-shape-minimal so
 * it is unit-testable with fakes.
 */

export type OfficeApp = "docs" | "slide" | "sheet";

export interface OfficeItem {
  app: OfficeApp;
  id: string;
  title: string;
  updatedAt: string;
}

interface TitledRecord {
  id: string;
  title: string;
  updatedAt: string;
}

export interface OfficeStores {
  docs: {
    list(): Promise<TitledRecord[]>;
    search(query: string): Promise<TitledRecord[]>;
  };
  slide: { list(): Promise<TitledRecord[]> };
  sheet: { listSpreadsheets(): Promise<TitledRecord[]> };
}

const UNTITLED = "Untitled";

function toItem(app: OfficeApp, r: TitledRecord): OfficeItem {
  return {
    app,
    id: r.id,
    title: r.title?.trim() ? r.title : UNTITLED,
    updatedAt: r.updatedAt,
  };
}

function byUpdatedDesc(a: OfficeItem, b: OfficeItem): number {
  const ta = Date.parse(a.updatedAt) || 0;
  const tb = Date.parse(b.updatedAt) || 0;
  return tb - ta;
}

/** Merge and sort (newest first) the listings of all three editors. */
export async function collectOfficeItems(
  stores: OfficeStores,
): Promise<OfficeItem[]> {
  const [docs, slides, sheets] = await Promise.all([
    stores.docs.list().catch(() => []),
    stores.slide.list().catch(() => []),
    stores.sheet.listSpreadsheets().catch(() => []),
  ]);
  return [
    ...docs.map((d) => toItem("docs", d)),
    ...slides.map((s) => toItem("slide", s)),
    ...sheets.map((s) => toItem("sheet", s)),
  ].sort(byUpdatedDesc);
}

/** Cross-app title/content search; newest first. */
export async function searchOfficeItems(
  stores: OfficeStores,
  query: string,
): Promise<OfficeItem[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matchesTitle = (r: TitledRecord) => r.title?.toLowerCase().includes(q);
  const [docs, slides, sheets] = await Promise.all([
    stores.docs.search(query).catch(() => []),
    stores.slide.list().catch(() => []),
    stores.sheet.listSpreadsheets().catch(() => []),
  ]);
  return [
    ...docs.map((d) => toItem("docs", d)),
    ...slides.filter(matchesTitle).map((s) => toItem("slide", s)),
    ...sheets.filter(matchesTitle).map((s) => toItem("sheet", s)),
  ].sort(byUpdatedDesc);
}
