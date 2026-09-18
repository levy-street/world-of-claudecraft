// The Sales History tab's realm-wide read (WocMarketService.realmSalesHistory)
// and its read-cache surface: the unfiltered shallow pages ride the cache
// (cross-player shared, like browse), every filtered or deep page bypasses,
// and a disabled market answers empty without a DB read. The SQL filter itself
// is proven against Postgres in the pg plan/scope suites; here the fake DB
// stands in so the service gate and the cache wiring are unit-provable.
import { describe, expect, it, vi } from 'vitest';
import {
  type WocMarketDb,
  WocMarketService,
  type WocSaleRow,
  type WocSalesQuery,
} from '../../server/woc_market';
import { WocMarketReadCache } from '../../server/woc_market_read_cache';
import { WOC_MARKET_RESTRICTED_POLICY } from '../../server/woc_market_rules';

const REALM = 'Claudemoon';

function sale(id: number, over: Partial<WocSaleRow> = {}): WocSaleRow {
  return {
    id,
    realm: REALM,
    listingId: id,
    itemId: 'deathlord_warplate',
    item: { itemId: 'deathlord_warplate', count: 1 },
    priceCents: 1000 + id,
    amountBase: null,
    sellerAccount: 1,
    buyerAccount: 2,
    sellerName: 'Aurelia',
    buyerName: 'Sable',
    saleType: 'auction',
    quality: 'epic',
    category: 'armor',
    subcategory: 'chest',
    excluded: false,
    atMs: 1_800_000_000_000 + id,
    ...over,
  };
}

/** A DB stub carrying only what realmSalesHistory reaches, plus a spy on the
 *  one read. Everything else throws if the service unexpectedly calls it. */
function stubDb(rows: WocSaleRow[]): { db: WocMarketDb; calls: () => WocSalesQuery[] } {
  const seen: WocSalesQuery[] = [];
  const salesForRealm = vi.fn(async (_realm: string, q: WocSalesQuery) => {
    seen.push(structuredClone(q));
    const filtered = rows
      .filter((s) => q.quality === null || s.quality === q.quality)
      .filter((s) => q.format === null || s.saleType === q.format)
      .filter((s) => q.category === null || s.category === q.category)
      .filter((s) => q.subcategory === null || s.subcategory === q.subcategory)
      .filter((s) => q.itemIds === null || q.itemIds.includes(s.itemId))
      .sort((a, b) => b.atMs - a.atMs || b.id - a.id);
    const pageSize = Math.min(Math.max(1, q.pageSize), 50);
    const start = Math.max(0, q.page) * pageSize;
    const page = filtered.slice(start, start + pageSize + 1);
    const hasMore = page.length > pageSize;
    return { rows: hasMore ? page.slice(0, pageSize) : page, hasMore };
  });
  const db = new Proxy(
    { salesForRealm },
    {
      get(target, prop) {
        if (prop in target) return (target as Record<string, unknown>)[prop as string];
        return () => {
          throw new Error(`unexpected db call: ${String(prop)}`);
        };
      },
    },
  ) as unknown as WocMarketDb;
  return { db, calls: () => seen };
}

function makeService(rows: WocSaleRow[], opts: { enabled?: boolean; cache?: boolean } = {}) {
  const { db, calls } = stubDb(rows);
  const readCache = opts.cache === false ? undefined : new WocMarketReadCache();
  const service = new WocMarketService({
    db,
    readCache,
    config: {
      enabled: opts.enabled ?? true,
      realm: REALM,
      policy: WOC_MARKET_RESTRICTED_POLICY,
      confirmingReviewMs: 6 * 3_600_000,
    },
    now: () => 1_800_000_100_000,
    // The read never reaches these; a cast keeps the harness to the surface
    // under test rather than a full deps bag.
  } as unknown as ConstructorParameters<typeof WocMarketService>[0]);
  return { service, calls };
}

const UNFILTERED: WocSalesQuery = {
  page: 0,
  pageSize: 25,
  quality: null,
  format: null,
  category: null,
  subcategory: null,
  itemIds: null,
};

describe('WocMarketService.realmSalesHistory', () => {
  it('returns realm sales most-recent-first with the pager envelope', async () => {
    const { service } = makeService([sale(1), sale(3), sale(2)]);
    const out = await service.realmSalesHistory(UNFILTERED);
    expect(out.sales.map((s) => s.id)).toEqual([3, 2, 1]);
    expect(out.page).toBe(0);
    expect(out.pageSize).toBe(25);
    expect(out.hasMore).toBe(false);
  });

  it('answers empty and never reads the DB when the market is disabled', async () => {
    const { service, calls } = makeService([sale(1)], { enabled: false });
    const out = await service.realmSalesHistory(UNFILTERED);
    expect(out.sales).toEqual([]);
    expect(out.hasMore).toBe(false);
    expect(calls()).toHaveLength(0);
  });

  it('caches the unfiltered shallow pages: two identical reads hit the DB once', async () => {
    const { service, calls } = makeService([sale(1), sale(2)]);
    await service.realmSalesHistory(UNFILTERED);
    await service.realmSalesHistory(UNFILTERED);
    expect(calls()).toHaveLength(1);
  });

  it('bypasses the cache for a filtered read (per-user, click-driven)', async () => {
    const { service, calls } = makeService([
      sale(1, { quality: 'epic' }),
      sale(2, { quality: 'rare' }),
    ]);
    const filtered: WocSalesQuery = { ...UNFILTERED, quality: 'epic' };
    const out = await service.realmSalesHistory(filtered);
    expect(out.sales.map((s) => s.id)).toEqual([1]);
    await service.realmSalesHistory(filtered);
    expect(calls()).toHaveLength(2);
  });

  it('bypasses the cache for a deep page even when unfiltered', async () => {
    const { service, calls } = makeService([sale(1)]);
    const deep: WocSalesQuery = { ...UNFILTERED, page: 9 };
    await service.realmSalesHistory(deep);
    await service.realmSalesHistory(deep);
    expect(calls()).toHaveLength(2);
  });

  it('filters by sale type through the format axis (directed shows only unfiltered)', async () => {
    const rows = [
      sale(1, { saleType: 'auction' }),
      sale(2, { saleType: 'buy_now' }),
      sale(3, { saleType: 'directed' }),
    ];
    const { service } = makeService(rows);
    const buyNow = await service.realmSalesHistory({ ...UNFILTERED, format: 'buy_now' });
    expect(buyNow.sales.map((s) => s.id)).toEqual([2]);
    const all = await service.realmSalesHistory(UNFILTERED);
    expect(all.sales.map((s) => s.id)).toEqual([3, 2, 1]);
  });
});

describe('the read cache sales surface', () => {
  it('a new sale drops the realm list through bustHistoryAll', async () => {
    const cache = new WocMarketReadCache();
    let n = 0;
    const read = () => cache.salesRealm(UNFILTERED, async () => ({ n: ++n }));
    expect((await read()).n).toBe(1);
    expect((await read()).n).toBe(1); // cached
    cache.bustHistoryAll();
    expect((await read()).n).toBe(2); // refreshed after the bust
  });
});
