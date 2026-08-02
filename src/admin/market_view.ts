// Pure view logic for the Market pages: overview filtering/sorting/paging and
// the detail-page chart point builders. No Svelte, no fetch, no locale reads;
// formatters arrive as arguments (the online_players_view idiom) so a Vitest
// drives everything in plain Node.

import type {
  BarPoint,
  LinePoint,
  MarketAskHistoryPoint,
  MarketOverviewItem,
  MarketPriceHistoryPoint,
} from './types';

export const MARKET_PAGE_LIMIT = 50;

export type MarketSortColumn = 'name' | 'ask' | 'listings' | 'quantity' | 'median7d' | 'sales7d';
export type MarketSortDirection = 'asc' | 'desc';

export interface MarketOverviewViewOptions {
  query: string;
  kind: string; // 'all' or an ItemKind value
  listedOnly: boolean;
  // Starred item ids (src/admin/market_watchlist.ts); watchlistOnly narrows
  // the table to them.
  watchlist: ReadonlySet<string>;
  watchlistOnly: boolean;
  sort: MarketSortColumn;
  dir: MarketSortDirection;
  page: number;
  locale: string;
}

export interface MarketOverviewView {
  rows: MarketOverviewItem[];
  total: number;
  page: number;
  limit: number;
  kinds: string[];
}

// Sort key per column; null asks sink to the bottom in EITHER direction so
// unlisted items never crowd the interesting end of the table.
function sortValue(row: MarketOverviewItem, column: MarketSortColumn): number | string | null {
  switch (column) {
    case 'name':
      return row.name;
    case 'ask':
      return row.lowestAskUnitCopper;
    case 'listings':
      return row.listingCount;
    case 'quantity':
      return row.listedQuantity;
    case 'median7d':
      return row.sales7d?.medianUnitPriceCopper ?? null;
    case 'sales7d':
      return row.sales7d?.sales ?? null;
  }
}

export function buildMarketOverviewView(
  items: MarketOverviewItem[],
  options: MarketOverviewViewOptions,
): MarketOverviewView {
  const query = options.query.trim().toLowerCase();
  const collator = new Intl.Collator(options.locale, { sensitivity: 'base' });
  const kinds = [...new Set(items.map((row) => row.kind))].sort((a, b) => collator.compare(a, b));
  let rows = items.filter(
    (row) =>
      (options.kind === 'all' || row.kind === options.kind) &&
      (!options.listedOnly || row.listingCount > 0) &&
      (!options.watchlistOnly || options.watchlist.has(row.itemId)) &&
      (query === '' ||
        row.name.toLowerCase().includes(query) ||
        row.itemId.toLowerCase().includes(query)),
  );
  const factor = options.dir === 'asc' ? 1 : -1;
  rows = rows.slice().sort((a, b) => {
    const va = sortValue(a, options.sort);
    const vb = sortValue(b, options.sort);
    if (va === null && vb === null) return collator.compare(a.name, b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp =
      typeof va === 'string' && typeof vb === 'string'
        ? collator.compare(va, vb)
        : Number(va) - Number(vb);
    return cmp === 0 ? collator.compare(a.name, b.name) : cmp * factor;
  });
  const total = rows.length;
  const page = Math.max(
    1,
    Math.min(options.page, Math.max(1, Math.ceil(total / MARKET_PAGE_LIMIT))),
  );
  const offset = (page - 1) * MARKET_PAGE_LIMIT;
  return {
    rows: rows.slice(offset, offset + MARKET_PAGE_LIMIT),
    total,
    page,
    limit: MARKET_PAGE_LIMIT,
    kinds,
  };
}

// Merge the sale-price and lowest-ask series onto one chart: primary = the
// bucket's median sale price, secondary = the bucket's lowest ask. Buckets
// exist in either series alone (a quiet hour can have listings but no sales),
// so the union of bucket starts drives the x axis; a missing median carries
// the previous one forward so the line stays contiguous instead of collapsing
// to zero on quiet buckets.
export function buildPriceChartPoints(
  priceHistory: MarketPriceHistoryPoint[],
  askHistory: MarketAskHistoryPoint[],
  labelFor: (iso: string) => string,
  moneyFor: (copper: number) => string,
): LinePoint[] {
  const byBucketPrice = new Map(priceHistory.map((row) => [row.bucketStart, row]));
  const byBucketAsk = new Map(askHistory.map((row) => [row.bucketStart, row]));
  const buckets = [...new Set([...byBucketPrice.keys(), ...byBucketAsk.keys()])].sort();
  const points: LinePoint[] = [];
  let lastMedian = 0;
  for (const bucket of buckets) {
    const price = byBucketPrice.get(bucket);
    const ask = byBucketAsk.get(bucket);
    if (price) lastMedian = price.medianUnitPriceCopper;
    const median = price?.medianUnitPriceCopper ?? lastMedian;
    const label = labelFor(bucket);
    const parts = [
      price ? `${moneyFor(median)} (${price.sales})` : moneyFor(median),
      ask ? moneyFor(ask.lowestAskUnitCopper) : null,
    ].filter((part) => part !== null);
    points.push({
      label,
      value: median,
      secondaryValue: ask?.lowestAskUnitCopper,
      title: `${label}: ${parts.join(' / ')}`,
    });
  }
  return points;
}

export function buildVolumeChartPoints(
  priceHistory: MarketPriceHistoryPoint[],
  labelFor: (iso: string) => string,
): BarPoint[] {
  return priceHistory.map((row) => ({
    label: labelFor(row.bucketStart),
    value: row.quantity,
    title: `${labelFor(row.bucketStart)}: ${row.quantity}`,
  }));
}
