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

export interface OfficeItemsResult {
  items: OfficeItem[];
  unavailableApps: OfficeApp[];
}

async function readOfficeItems(
  readers: Record<OfficeApp, () => Promise<TitledRecord[]>>,
): Promise<OfficeItemsResult> {
  const apps: OfficeApp[] = ["docs", "slide", "sheet"];
  const results = await Promise.all(apps.map(async (app) => {
    try {
      return { app, records: await readers[app](), unavailable: false };
    } catch {
      // Preserve healthy editors without disguising failed reads as empty data.
      return { app, records: [] as TitledRecord[], unavailable: true };
    }
  }));
  return {
    items: results.flatMap(({ app, records }) => records.map((r) => toItem(app, r))).sort(byUpdatedDesc),
    unavailableApps: results.filter((result) => result.unavailable).map(({ app }) => app),
  };
}

/** Merge and sort (newest first), retaining incomplete-read information. */
export function collectOfficeItems(
  stores: OfficeStores,
): Promise<OfficeItemsResult> {
  return readOfficeItems({
    docs: () => stores.docs.list(),
    slide: () => stores.slide.list(),
    sheet: () => stores.sheet.listSpreadsheets(),
  });
}

/** Cross-app title/content search; newest first. */
export async function searchOfficeItems(
  stores: OfficeStores,
  query: string,
): Promise<OfficeItemsResult> {
  const q = query.trim().toLowerCase();
  if (!q) return { items: [], unavailableApps: [] };
  const matchesTitle = (r: TitledRecord) => r.title?.toLowerCase().includes(q);
  return readOfficeItems({
    docs: () => stores.docs.search(query),
    slide: async () => (await stores.slide.list()).filter(matchesTitle),
    sheet: async () => (await stores.sheet.listSpreadsheets()).filter(matchesTitle),
  });
}
