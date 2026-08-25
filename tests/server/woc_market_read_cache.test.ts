// The marketplace hot-read cache (server/woc_market_read_cache.ts): TTL,
// single-flight, key isolation, bust semantics, and the shared-value freeze.
// The clock is injected; no timers or sleeps anywhere.

import { describe, expect, it, vi } from 'vitest';
import type { WocBrowseQuery } from '../../server/woc_market';
import {
  WOC_MARKET_BROWSE_CACHE_MAX_ENTRIES,
  WOC_MARKET_BROWSE_CACHE_TTL_MS,
  WOC_MARKET_DETAIL_CACHE_MAX_ENTRIES,
  WOC_MARKET_DETAIL_CACHE_TTL_MS,
  WOC_MARKET_HISTORY_CACHE_MAX_ENTRIES,
  WOC_MARKET_HISTORY_CACHE_TTL_MS,
  WOC_MARKET_ME_CACHE_MAX_ENTRIES,
  WOC_MARKET_ME_CACHE_TTL_MS,
  WOC_MARKET_SELLER_CACHE_MAX_ENTRIES,
  WocMarketReadCache,
  wocBrowseCacheKey,
} from '../../server/woc_market_read_cache';

const Q: WocBrowseQuery = {
  page: 0,
  pageSize: 25,
  quality: null,
  format: null,
  category: null,
  subcategory: null,
  itemIds: null,
  sort: 'ending',
};

function rig() {
  let clock = 9_000_000;
  const cache = new WocMarketReadCache({ now: () => clock });
  return {
    cache,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the browse cache key', () => {
  it('is canonical per query tuple and distinguishes every field', () => {
    const base = wocBrowseCacheKey(Q);
    expect(wocBrowseCacheKey({ ...Q })).toBe(base);
    // Each field moves the key on its own: a collision on any one of these
    // would serve one filter's page under another filter.
    expect(wocBrowseCacheKey({ ...Q, page: 1 })).not.toBe(base);
    expect(wocBrowseCacheKey({ ...Q, pageSize: 26 })).not.toBe(base);
    expect(wocBrowseCacheKey({ ...Q, sort: 'newest' })).not.toBe(base);
    expect(wocBrowseCacheKey({ ...Q, quality: 'epic' })).not.toBe(base);
    expect(wocBrowseCacheKey({ ...Q, format: 'auction' })).not.toBe(base);
    expect(wocBrowseCacheKey({ ...Q, itemIds: ['sunblade'] })).not.toBe(base);
    // Absent-vs-empty itemIds share one key on purpose (both mean "no
    // filter" to the SQL); a one-id list does not collide with a two-id one.
    expect(wocBrowseCacheKey({ ...Q, itemIds: ['a', 'b'] })).not.toBe(
      wocBrowseCacheKey({ ...Q, itemIds: ['a'] }),
    );
    expect(wocBrowseCacheKey({ ...Q, itemIds: [] })).toBe(base);
  });

  it('the key shape is the pinned literal (separator and component order are load-bearing)', () => {
    // The \x1f separator and the field order are what keep distinct tuples
    // distinct; a reordered builder must fail HERE, not in production. The
    // category axes joined the tuple with the Browse filters (defensive:
    // live keys are unfiltered-only, the service gate).
    expect(wocBrowseCacheKey(Q)).toBe('0\x1f25\x1fending\x1f\x1f\x1f\x1f\x1f');
    expect(
      wocBrowseCacheKey({
        ...Q,
        quality: 'epic',
        format: 'auction',
        category: 'weapon',
        subcategory: 'sword',
        itemIds: ['a', 'b'],
      }),
    ).toBe('0\x1f25\x1fending\x1fepic\x1fauction\x1fweapon\x1fsword\x1fa,b');
  });
});

describe('read-through behavior', () => {
  it('serves a browse page from cache inside the TTL and refreshes past it', async () => {
    const r = rig();
    const refresh = vi.fn(async () => ({ rows: [{ id: 1 }], hasMore: false }));
    const first = await r.cache.browse(Q, refresh);
    r.advance(WOC_MARKET_BROWSE_CACHE_TTL_MS - 1);
    const second = await r.cache.browse(Q, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The SAME object: shared, which is why it is frozen (below).
    expect(second).toBe(first);
    r.advance(2);
    await r.cache.browse(Q, refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('single-flights a concurrent burst into one refresh (the burst proof)', async () => {
    const r = rig();
    const gate = deferred<{ rows: unknown[]; hasMore: boolean }>();
    const refresh = vi.fn(() => gate.promise);
    const reads = [
      r.cache.browse(Q, refresh),
      r.cache.browse(Q, refresh),
      r.cache.browse(Q, refresh),
    ];
    expect(refresh).toHaveBeenCalledTimes(1);
    gate.resolve({ rows: [], hasMore: false });
    const values = await Promise.all(reads);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(values[1]).toBe(values[0]);
    expect(values[2]).toBe(values[0]);
  });

  it('keys the activity readout BY ACCOUNT: two accounts never share an entry', async () => {
    const r = rig();
    const forA = vi.fn(async () => ({ listings: [], bids: [{ id: 'a' }] }));
    const forB = vi.fn(async () => ({ listings: [], bids: [{ id: 'b' }] }));
    const a = await r.cache.myActivity(7, forA);
    const b = await r.cache.myActivity(8, forB);
    expect(a).not.toBe(b);
    expect((a.bids[0] as { id: string }).id).toBe('a');
    expect((b.bids[0] as { id: string }).id).toBe('b');
    // And a warm read for A still answers A.
    expect(await r.cache.myActivity(7, forB)).toBe(a);
    expect(forB).toHaveBeenCalledTimes(1);
  });

  it('keys history by item id without cross-item leaks', async () => {
    const r = rig();
    const sunblade = await r.cache.sales('sunblade', async () => [{ id: 1 }]);
    const dawnaxe = await r.cache.sales('dawnaxe', async () => [{ id: 2 }]);
    expect(sunblade).not.toBe(dawnaxe);
    expect(await r.cache.sales('sunblade', async () => [{ id: 3 }])).toBe(sunblade);
  });

  it('freezes the shared value: result, arrays, rows, row items, and object values', async () => {
    const r = rig();
    const page = await r.cache.browse(Q, async () => ({
      rows: [{ id: 1, status: 'active', item: { itemId: 'sunblade', count: 1 } }],
      hasMore: false,
    }));
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.rows)).toBe(true);
    expect(Object.isFrozen(page.rows[0])).toBe(true);
    // The row's item payload is the nested object a future consumer could
    // plausibly redact in place; it freezes too.
    expect(Object.isFrozen((page.rows[0] as { item: object }).item)).toBe(true);
    // A consumer's in-place edit throws under strict mode instead of
    // corrupting every other caller's copy for the rest of the TTL.
    expect(() => {
      (page.rows as unknown[]).push({ id: 2 });
    }).toThrow();
    // Non-array object values (the activity readout's strike row) freeze as
    // well: result.strikes.strikes++ must throw, not corrupt.
    const readout = await r.cache.myActivity(7, async () => ({
      listings: [],
      strikes: { strikes: 1, suspendedUntilMs: null },
    }));
    expect(Object.isFrozen(readout.strikes)).toBe(true);
  });
});

describe('busts', () => {
  it('bustListings drops browse pages AND listing rows, immediately', async () => {
    const r = rig();
    let generation = 1;
    const browseRefresh = vi.fn(async () => ({ rows: [{ generation }], hasMore: false }));
    const rowRefresh = vi.fn(async () => ({ id: 4, generation }));
    await r.cache.browse(Q, browseRefresh);
    await r.cache.listingRow(4, rowRefresh);
    generation = 2;
    r.cache.bustListings();
    // No clock advance: the bust alone must expose the mutation (a TTL-only
    // cache on a money surface is the defect the busts exist to close).
    const page = await r.cache.browse(Q, browseRefresh);
    const row = await r.cache.listingRow(4, rowRefresh);
    expect((page.rows[0] as { generation: number }).generation).toBe(2);
    expect((row as { generation: number }).generation).toBe(2);
  });

  it('bustMe drops exactly the named account', async () => {
    const r = rig();
    let generation = 1;
    const refresh = vi.fn(async () => ({ generation }));
    await r.cache.myActivity(7, refresh);
    await r.cache.myActivity(8, refresh);
    generation = 2;
    r.cache.bustMe(7);
    expect((await r.cache.myActivity(7, refresh)).generation).toBe(2);
    // Account 8 keeps its cached readout: the bust is scoped.
    expect((await r.cache.myActivity(8, refresh)).generation).toBe(1);
  });

  it('bustHistoryAll drops the whole map (the arm knows only the sale id)', async () => {
    const r = rig();
    let generation = 1;
    const refresh = vi.fn(async () => [{ generation }]);
    await r.cache.sales('sunblade', refresh);
    await r.cache.sales('dawnaxe', refresh);
    generation = 2;
    r.cache.bustHistoryAll();
    expect((await r.cache.sales('sunblade', refresh))[0]?.generation).toBe(2);
    expect((await r.cache.sales('dawnaxe', refresh))[0]?.generation).toBe(2);
  });
});

describe('bounds', () => {
  it('the activity map evicts its least-recently-read account at the cap', async () => {
    const r = rig();
    const refresh = vi.fn(async () => ({}));
    // Fill past the cap; the earliest accounts fall out (LRU), so the map
    // can never grow with the realm's whole account space.
    for (let account = 1; account <= 513; account++) {
      await r.cache.myActivity(account, refresh);
    }
    expect(r.cache.stats().me.entries).toBe(512);
    expect(r.cache.stats().me.evictions).toBe(1);
    // Account 1 was evicted: reading it again refreshes.
    const calls = refresh.mock.calls.length;
    await r.cache.myActivity(1, refresh);
    expect(refresh.mock.calls.length).toBe(calls + 1);
  });

  it('exports the documented TTLs and caps (at or under the cadences that bound freshness)', () => {
    expect(WOC_MARKET_BROWSE_CACHE_TTL_MS).toBe(3_000);
    expect(WOC_MARKET_DETAIL_CACHE_TTL_MS).toBe(3_000);
    // The history TTL is the one that gates how long a moderation-adjacent
    // staleness can last between busts; the caps bound realm memory.
    expect(WOC_MARKET_HISTORY_CACHE_TTL_MS).toBe(10_000);
    expect(WOC_MARKET_ME_CACHE_TTL_MS).toBe(2_000);
    // 192: sized OVER the closed 144-key browse space (3 shallow pages x 4
    // sorts x 3 quality values x 4 formats) now that the Browse filters
    // ship; an LRU evicting inside a closed hot set re-buys OFFSET-walk
    // reads every cycle (the arithmetic lives at the constant).
    expect(WOC_MARKET_BROWSE_CACHE_MAX_ENTRIES).toBe(192);
    expect(WOC_MARKET_DETAIL_CACHE_MAX_ENTRIES).toBe(256);
    expect(WOC_MARKET_HISTORY_CACHE_MAX_ENTRIES).toBe(256);
    expect(WOC_MARKET_SELLER_CACHE_MAX_ENTRIES).toBe(256);
    expect(WOC_MARKET_ME_CACHE_MAX_ENTRIES).toBe(512);
  });
});
