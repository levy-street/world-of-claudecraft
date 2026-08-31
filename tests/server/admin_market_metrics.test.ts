// Unit coverage for server/admin_market_metrics.ts and its registry-only
// RouteDef (GET /admin/api/market/metrics in server/admin.ts): the derived
// six-bucket classification (relations against the content tables, never
// rotting literals), the soulbound tripwire premises behind the essence
// bucket, the pure builder over a literal listings fixture, and the endpoint
// through its real middleware chain (withErrors + requireAdmin) with fakeCtx
// and the db bundle faked via setAdminDbForTests.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_market_metrics';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAdminDbForTests, routes, setAdminDbForTests } from '../../server/admin';
import {
  type AdminMarketMetrics,
  buildAdminMarketMetrics,
  classifyMarketMetricsItem,
  configureAdminMarketMetrics,
  configureAdminMarketSoldVolume,
  foldMarketSoldVolume,
  MARKET_METRICS_BUCKET_SETS,
  MARKET_METRICS_BUCKETS,
  readAdminMarketMetrics,
  resetAdminMarketMetricsForTests,
  withMarketSoldVolume,
} from '../../server/admin_market_metrics';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { MARKET_SOLD_VOLUME_WINDOW_DAYS } from '../../server/market_sold_volume_db';
import { resetAdminAnalyticsRateLimits } from '../../server/ratelimit';
import {
  FARM_CROPS,
  FARM_SUPPLY_ITEM_IDS,
  FARM_WITHERED_HUSK_ITEM_ID,
} from '../../src/sim/content/farm_crops';
import { ITEMS } from '../../src/sim/data';
import { lowestListingPricePerUnit, type MarketListing } from '../../src/sim/market';
import {
  MAKERS_EMBER_ITEM_ID,
  SUNDERED_ESSENCE_ITEM_ID,
  WYRMFALL_CORE_ITEM_ID,
} from '../../src/sim/professions/masterwrought_materials';
import { type FakeRes, fakeCtx } from './helpers';

describe('market metrics bucket derivation (relations, not literals)', () => {
  it('patterns is exactly the kind === recipe subset of the merged ITEMS table', () => {
    const expected = new Set(
      Object.values(ITEMS)
        .filter((def) => def.kind === 'recipe')
        .map((def) => def.id),
    );
    expect(expected.size).toBeGreaterThan(0);
    expect(MARKET_METRICS_BUCKET_SETS.patterns).toEqual(expected);
  });

  it('every FARM_CROPS row contributes its seed, produce, and fine ids', () => {
    const crops = Object.values(FARM_CROPS);
    expect(crops.length).toBeGreaterThan(0);
    for (const crop of crops) {
      expect(MARKET_METRICS_BUCKET_SETS.seeds.has(crop.seedItemId)).toBe(true);
      expect(MARKET_METRICS_BUCKET_SETS.produce.has(crop.produceItemId)).toBe(true);
      expect(MARKET_METRICS_BUCKET_SETS.produce.has(crop.fineProduceItemId)).toBe(true);
    }
    expect(MARKET_METRICS_BUCKET_SETS.seeds.size).toBe(crops.length);
    expect(MARKET_METRICS_BUCKET_SETS.produce.size).toBe(crops.length * 2);
  });

  it('the withered husk is excluded on purpose (a failure by-product)', () => {
    expect(classifyMarketMetricsItem(FARM_WITHERED_HUSK_ITEM_ID)).toBeNull();
  });

  it('compost equals FARM_SUPPLY_ITEM_IDS; cores and essence equal the id constants', () => {
    expect(MARKET_METRICS_BUCKET_SETS.compost).toEqual(new Set(FARM_SUPPLY_ITEM_IDS));
    expect(MARKET_METRICS_BUCKET_SETS.cores).toEqual(new Set([WYRMFALL_CORE_ITEM_ID]));
    expect(MARKET_METRICS_BUCKET_SETS.essence).toEqual(
      new Set([SUNDERED_ESSENCE_ITEM_ID, MAKERS_EMBER_ITEM_ID]),
    );
  });

  it('the six sets are pairwise disjoint and classification agrees with membership', () => {
    for (const a of MARKET_METRICS_BUCKETS) {
      for (const b of MARKET_METRICS_BUCKETS) {
        if (a === b) continue;
        for (const id of MARKET_METRICS_BUCKET_SETS[a]) {
          expect(MARKET_METRICS_BUCKET_SETS[b].has(id), `${id} in both ${a} and ${b}`).toBe(false);
        }
      }
      for (const id of MARKET_METRICS_BUCKET_SETS[a]) {
        expect(classifyMarketMetricsItem(id)).toBe(a);
      }
    }
    expect(classifyMarketMetricsItem('not_a_real_item_id')).toBeNull();
  });

  it('every derived id resolves in ITEMS (names render server-side)', () => {
    for (const bucket of MARKET_METRICS_BUCKETS) {
      for (const id of MARKET_METRICS_BUCKET_SETS[bucket]) {
        expect(ITEMS[id], `${bucket}: ${id}`).toBeDefined();
        expect(typeof ITEMS[id].name).toBe('string');
      }
    }
  });
});

describe('the essence tripwire premises', () => {
  // If either flag ever flips, the bucket semantics change: essence stops
  // being a structural zero, or cores stops being the tradable-supply signal.
  it('both essence materials are soulbound (the market refuses them at list time)', () => {
    expect(ITEMS[SUNDERED_ESSENCE_ITEM_ID].soulbound).toBe(true);
    expect(ITEMS[MAKERS_EMBER_ITEM_ID].soulbound).toBe(true);
  });

  it('the wyrmfall core stays tradable (not soulbound, not noMarketList)', () => {
    expect(ITEMS[WYRMFALL_CORE_ITEM_ID].soulbound).not.toBe(true);
    expect(ITEMS[WYRMFALL_CORE_ITEM_ID].noMarketList).not.toBe(true);
  });
});

function listing(
  overrides: Partial<MarketListing> & Pick<MarketListing, 'id' | 'itemId' | 'count' | 'price'>,
): MarketListing {
  return {
    sellerKey: '10',
    sellerName: 'seller',
    expiresAt: 100,
    house: false,
    ...overrides,
  };
}

// Mixed buckets, an unclassified id, a house row, and multi-count stacks.
const SEED_ID = Object.values(FARM_CROPS)[0].seedItemId;
const PRODUCE_ID = Object.values(FARM_CROPS)[0].produceItemId;
const FIXTURE: MarketListing[] = [
  listing({ id: 1, itemId: WYRMFALL_CORE_ITEM_ID, count: 4, price: 10 }), // per unit ceil(10/4)=3
  listing({ id: 2, itemId: WYRMFALL_CORE_ITEM_ID, count: 1, price: 5 }), // per unit 5
  listing({
    id: 3,
    itemId: PRODUCE_ID,
    count: 5,
    price: 7, // per unit ceil(7/5)=2
    sellerKey: '',
    sellerName: 'Merchant',
    expiresAt: Number.POSITIVE_INFINITY,
    house: true,
  }),
  listing({ id: 4, itemId: 'roasted_boar', count: 2, price: 9 }), // unclassified, ignored
  listing({ id: 5, itemId: SEED_ID, count: 3, price: 10 }), // per unit ceil(10/3)=4
];

describe('buildAdminMarketMetrics', () => {
  it('carries the realm and all six buckets in fixed order', () => {
    const out = buildAdminMarketMetrics(FIXTURE, 'eastbrook');
    expect(out.realm).toBe('eastbrook');
    expect(out.buckets.map((b) => b.bucket)).toEqual([...MARKET_METRICS_BUCKETS]);
  });

  it('aggregates counts, quantities, and ceil per-unit prices per bucket', () => {
    const out = buildAdminMarketMetrics(FIXTURE, 'eastbrook');
    const byBucket = new Map(out.buckets.map((b) => [b.bucket, b]));

    const cores = byBucket.get('cores');
    expect(cores).toMatchObject({ listingCount: 2, totalQuantity: 5, listedItemCount: 1 });
    expect(cores?.trackedItemCount).toBe(MARKET_METRICS_BUCKET_SETS.cores.size);
    expect(cores?.items).toEqual([
      {
        itemId: WYRMFALL_CORE_ITEM_ID,
        name: ITEMS[WYRMFALL_CORE_ITEM_ID].name,
        listingCount: 2,
        totalQuantity: 5,
        lowestPerUnit: 3,
        // Even count: rounds up on the split, the never-understate stance.
        medianPerUnit: 4,
      },
    ]);
    // Rounding parity with the book's own per-unit rule.
    expect(cores?.items[0].lowestPerUnit).toBe(
      lowestListingPricePerUnit(FIXTURE, WYRMFALL_CORE_ITEM_ID),
    );

    // The house row counts as real supply.
    const produce = byBucket.get('produce');
    expect(produce).toMatchObject({ listingCount: 1, totalQuantity: 5, listedItemCount: 1 });
    expect(produce?.items[0]).toMatchObject({
      itemId: PRODUCE_ID,
      lowestPerUnit: 2,
      medianPerUnit: 2,
    });

    const seeds = byBucket.get('seeds');
    expect(seeds?.items).toEqual([
      {
        itemId: SEED_ID,
        name: ITEMS[SEED_ID].name,
        listingCount: 1,
        totalQuantity: 3,
        lowestPerUnit: 4,
        medianPerUnit: 4,
      },
    ]);

    // The unclassified row is ignored: no bucket carries it.
    const totalListings = out.buckets.reduce((sum, b) => sum + b.listingCount, 0);
    expect(totalListings).toBe(4);

    // The essence tripwire renders as a structural zero with its tracked size.
    const essence = byBucket.get('essence');
    expect(essence).toMatchObject({ listingCount: 0, totalQuantity: 0, listedItemCount: 0 });
    expect(essence?.trackedItemCount).toBe(2);
    expect(essence?.items).toEqual([]);
  });

  it('takes the plain middle for an odd per-unit count', () => {
    const extended = [
      ...FIXTURE,
      listing({ id: 6, itemId: WYRMFALL_CORE_ITEM_ID, count: 2, price: 20 }),
    ];
    const cores = buildAdminMarketMetrics(extended, 'eastbrook').buckets.find(
      (b) => b.bucket === 'cores',
    );
    // Per-unit values [3, 5, 10]: median 5.
    expect(cores?.items[0].medianPerUnit).toBe(5);
    expect(cores?.items[0].lowestPerUnit).toBe(3);
  });

  it('returns fresh aggregates with no reference into the input rows', () => {
    const before = structuredClone(FIXTURE);
    const out = buildAdminMarketMetrics(FIXTURE, 'eastbrook');
    for (const bucket of out.buckets) {
      for (const row of bucket.items) {
        row.listingCount = -1;
        row.totalQuantity = -1;
        row.name = 'mutated';
      }
      bucket.listingCount = -1;
    }
    expect(FIXTURE).toEqual(before);
    // And a rebuild is unaffected by the mutation above.
    const rebuilt = buildAdminMarketMetrics(FIXTURE, 'eastbrook');
    expect(rebuilt.buckets.find((b) => b.bucket === 'cores')?.listingCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The endpoint through its real middleware chain (the admin_oversight.test.ts
// harness shape).
// ---------------------------------------------------------------------------

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;
const METRICS_PATH = '/admin/api/market/metrics';

function authedAdminDb(
  roles: string[] = ['superadmin'],
  overrides: Record<string, unknown> = {},
): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  } as Parameters<typeof setAdminDbForTests>[0]);
}

// Rate-limit outcome stubs typed off the real bundle (the admin_oversight
// harness shape): a RateLimitOutcome shape change fails at tsc.
type AdminDbBundle = Parameters<typeof setAdminDbForTests>[0];
const allowed = (): ReturnType<NonNullable<AdminDbBundle['adminAnalyticsReadRateLimited']>> => ({
  allowed: true,
  remaining: 1,
  resetSeconds: 0,
});
const denied = (): ReturnType<NonNullable<AdminDbBundle['adminAnalyticsReadRateLimited']>> => ({
  allowed: false,
  remaining: 0,
  resetSeconds: 30,
});

function readRes(res: http.ServerResponse): { status: number; body: unknown; rawBody: string } {
  const fake = res as unknown as FakeRes;
  let body: unknown;
  try {
    body = fake.body ? JSON.parse(fake.body) : undefined;
  } catch {
    body = undefined;
  }
  return { status: fake.statusCode, body, rawBody: fake.body };
}

async function runMetricsRoute(headers: Record<string, string> = {}) {
  const route = routes.find((r) => r.method === ('GET' as Method) && r.path === METRICS_PATH);
  if (!route) throw new Error(`no route GET ${METRICS_PATH}`);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({ method: 'GET', url: METRICS_PATH, headers });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

const SAMPLE_METRICS: AdminMarketMetrics = buildAdminMarketMetrics(FIXTURE, 'eastbrook');

describe('GET /admin/api/market/metrics', () => {
  beforeEach(() => {
    resetAdminMarketMetricsForTests();
    resetAdminAnalyticsRateLimits();
  });

  afterEach(() => {
    resetAdminMarketMetricsForTests();
    resetAdminAnalyticsRateLimits();
    resetAdminDbForTests();
    vi.restoreAllMocks();
  });

  it('200s the metrics envelope for an analytics.read holder (pins the permission row)', async () => {
    authedAdminDb(['viewer']); // the viewer bundle carries analytics.read
    configureAdminMarketMetrics(() => SAMPLE_METRICS);
    const r = await runMetricsRoute({ authorization: BEARER });
    expect(r.status).toBe(200);
    expect(r.reached).toBe(true);
    expect(r.body).toEqual({ success: true, data: SAMPLE_METRICS, error: null });
  });

  it('401s without a bearer and never reaches the handler', async () => {
    authedAdminDb();
    configureAdminMarketMetrics(() => SAMPLE_METRICS);
    const r = await runMetricsRoute();
    expect(r.status).toBe(401);
    expect(r.reached).toBe(false);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'admin authentication required',
    });
  });

  it('403s a staff role without analytics.read (requireAdmin fails closed)', async () => {
    authedAdminDb(['unknown-role']);
    configureAdminMarketMetrics(() => SAMPLE_METRICS);
    const r = await runMetricsRoute({ authorization: BEARER });
    expect(r.status).toBe(403);
    expect(r.reached).toBe(false);
  });

  it('serves two immediate reads from one source hit (the 15s TTL cache)', async () => {
    // Deliberately TTL-only: no moderation action changes the listing book,
    // so there is no bust wire to exercise; the cache primitive itself is
    // covered by tests/server/board_read_single_flight.test.ts.
    authedAdminDb(['viewer']);
    const source = vi.fn(() => SAMPLE_METRICS);
    configureAdminMarketMetrics(source);
    const first = await runMetricsRoute({ authorization: BEARER });
    const second = await runMetricsRoute({ authorization: BEARER });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the boot wiring never ran', () => {
    expect(() => readAdminMarketMetrics()).toThrow('call configureAdminMarketMetrics');
  });

  it('429s on the analytics read bucket BEFORE touching the metrics read', async () => {
    const source = vi.fn(() => SAMPLE_METRICS);
    configureAdminMarketMetrics(source);
    authedAdminDb(['viewer'], { adminAnalyticsReadRateLimited: vi.fn(denied) });
    const r = await runMetricsRoute({ authorization: BEARER });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'too many requests, wait a moment and try again',
    });
    expect(source).not.toHaveBeenCalled();
  });

  it('meters on the ANALYTICS bucket, never the oversight bucket (scoping pin)', async () => {
    const analytics = vi.fn(allowed);
    const oversight = vi.fn(allowed);
    configureAdminMarketMetrics(() => SAMPLE_METRICS);
    authedAdminDb(['viewer'], {
      adminAnalyticsReadRateLimited: analytics,
      adminOversightReadRateLimited: oversight,
    });
    const r = await runMetricsRoute({ authorization: BEARER });
    expect(r.status).toBe(200);
    expect(analytics).toHaveBeenCalledTimes(1);
    expect(analytics).toHaveBeenCalledWith(expect.anything(), ADMIN_ACCOUNT_ID);
    expect(oversight).not.toHaveBeenCalled();
  });

  it('serializes the envelope ONCE per cache turnover and serves the memoized bytes', async () => {
    authedAdminDb(['viewer']);
    // A fresh object identity per configure, so this test's stringify count
    // can never be satisfied by another test's warm memo entry.
    const metrics = buildAdminMarketMetrics(FIXTURE, 'memo-realm');
    configureAdminMarketMetrics(() => metrics);
    const stringify = vi.spyOn(JSON, 'stringify');
    const first = await runMetricsRoute({ authorization: BEARER });
    const second = await runMetricsRoute({ authorization: BEARER });
    const envelopeCalls = stringify.mock.calls.filter(
      ([value]) => (value as { data?: unknown } | null)?.data === metrics,
    );
    stringify.mockRestore();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // One stringify served both requests inside the TTL window.
    expect(envelopeCalls.length).toBe(1);
    // And the served bytes are EXACTLY what ok() would have produced.
    expect(first.rawBody).toBe(JSON.stringify({ success: true, data: metrics, error: null }));
    expect(second.rawBody).toBe(first.rawBody);
  });

  it('installs a DEEP-frozen snapshot so the memoized bytes cannot be poisoned', async () => {
    configureAdminMarketMetrics(() => buildAdminMarketMetrics(FIXTURE, 'eastbrook'));
    const first = await readAdminMarketMetrics();
    const second = await readAdminMarketMetrics();
    expect(Object.isFrozen(first)).toBe(true);
    // Whole, not shallow (the hot-path review's nit): the buckets array, every
    // bucket, its items array, and every item row are frozen, so a consumer
    // cannot mutate the rows the route's memoized envelope was built from.
    expect(Object.isFrozen(first.buckets)).toBe(true);
    expect(first.buckets.length).toBeGreaterThan(0);
    for (const bucket of first.buckets) {
      expect(Object.isFrozen(bucket)).toBe(true);
      expect(Object.isFrozen(bucket.items)).toBe(true);
      for (const row of bucket.items) expect(Object.isFrozen(row)).toBe(true);
    }
    const cores = first.buckets.find((b) => b.bucket === 'cores');
    expect(cores?.items.length).toBeGreaterThan(0);
    expect(() => {
      (cores as { items: unknown[] }).items.push({});
    }).toThrow();
    // Same installed object inside the TTL: the identity the memo keys on.
    expect(second).toBe(first);
  });
});

describe('sold volume (the accumulating store, folded into the readout)', () => {
  afterEach(() => {
    resetAdminMarketMetricsForTests();
  });

  it('zeroes sold volume in the pure builder and states the window', () => {
    // The builder folds the in-process listing book and must stay synchronous
    // and database-free; the volume half arrives separately.
    const out = buildAdminMarketMetrics(FIXTURE, 'eastbrook');
    expect(out.soldWindowDays).toBe(MARKET_SOLD_VOLUME_WINDOW_DAYS);
    expect(out.soldAvailable).toBe(false);
    for (const bucket of out.buckets) {
      expect(bucket.sold, bucket.bucket).toEqual({ saleCount: 0, quantity: 0, copper: 0 });
    }
  });

  it('folds store rows into buckets through the SAME classification as supply', () => {
    const totals = foldMarketSoldVolume([
      { itemId: WYRMFALL_CORE_ITEM_ID, saleCount: 2, quantity: 5, copper: 1500 },
      { itemId: SEED_ID, saleCount: 1, quantity: 3, copper: 90 },
      { itemId: PRODUCE_ID, saleCount: 4, quantity: 40, copper: 200 },
      // An id no bucket owns: the writer refuses these, and a row left behind
      // by a retired content id must not land in some other bucket.
      { itemId: 'roasted_boar', saleCount: 9, quantity: 9, copper: 9 },
    ]);
    expect(totals.cores).toEqual({ saleCount: 2, quantity: 5, copper: 1500 });
    expect(totals.seeds).toEqual({ saleCount: 1, quantity: 3, copper: 90 });
    expect(totals.produce).toEqual({ saleCount: 4, quantity: 40, copper: 200 });
    expect(totals.essence).toEqual({ saleCount: 0, quantity: 0, copper: 0 });
    expect(totals.patterns).toEqual({ saleCount: 0, quantity: 0, copper: 0 });
    expect(totals.compost).toEqual({ saleCount: 0, quantity: 0, copper: 0 });
    // Every bucket present, so a page rendering the record never reads undefined.
    expect(Object.keys(totals).sort()).toEqual([...MARKET_METRICS_BUCKETS].sort());
  });

  it('sums several items landing in one bucket', () => {
    // Two crops both fold into produce; a fold that overwrote instead of
    // adding would silently report only the last row.
    const crops = Object.values(FARM_CROPS);
    const totals = foldMarketSoldVolume([
      { itemId: crops[0].produceItemId, saleCount: 1, quantity: 2, copper: 30 },
      { itemId: crops[1].produceItemId, saleCount: 3, quantity: 4, copper: 70 },
    ]);
    expect(totals.produce).toEqual({ saleCount: 4, quantity: 6, copper: 100 });
  });

  it('copies rather than mutating the readout it is given', () => {
    const base = buildAdminMarketMetrics(FIXTURE, 'eastbrook');
    const filled = withMarketSoldVolume(
      base,
      [{ itemId: WYRMFALL_CORE_ITEM_ID, saleCount: 2, quantity: 5, copper: 1500 }],
      true,
    );
    expect(filled).not.toBe(base);
    expect(filled.buckets.find((b) => b.bucket === 'cores')?.sold).toEqual({
      saleCount: 2,
      quantity: 5,
      copper: 1500,
    });
    // The input is untouched, which is what lets the cached read hand the
    // builder's output straight in without a defensive clone of its own.
    expect(base.buckets.find((b) => b.bucket === 'cores')?.sold).toEqual({
      saleCount: 0,
      quantity: 0,
      copper: 0,
    });
    expect(base.soldAvailable).toBe(false);
    expect(filled.soldAvailable).toBe(true);
    // The listing half is carried through verbatim.
    expect(filled.buckets.map((b) => b.listingCount)).toEqual(
      base.buckets.map((b) => b.listingCount),
    );
  });

  it('reports unavailable, never a misleading zero, when told the read failed', () => {
    const filled = withMarketSoldVolume(
      buildAdminMarketMetrics(FIXTURE, 'eastbrook'),
      [{ itemId: WYRMFALL_CORE_ITEM_ID, saleCount: 2, quantity: 5, copper: 1500 }],
      false,
    );
    expect(filled.soldAvailable).toBe(false);
    for (const bucket of filled.buckets) {
      expect(bucket.sold, bucket.bucket).toEqual({ saleCount: 0, quantity: 0, copper: 0 });
    }
  });

  it('serves the store read through the cached read: one query per TTL window', async () => {
    configureAdminMarketMetrics(() => buildAdminMarketMetrics(FIXTURE, 'eastbrook'));
    const read = vi.fn(async () => [
      { itemId: WYRMFALL_CORE_ITEM_ID, saleCount: 2, quantity: 5, copper: 1500 },
    ]);
    configureAdminMarketSoldVolume(read);
    const first = await readAdminMarketMetrics();
    const second = await readAdminMarketMetrics();
    // The whole point of riding the existing cache: a poll storm cannot turn
    // into a query storm.
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.soldAvailable).toBe(true);
    expect(first.buckets.find((b) => b.bucket === 'cores')?.sold.copper).toBe(1500);
  });

  it('deep-freezes the sold figures with the rest of the snapshot', async () => {
    configureAdminMarketMetrics(() => buildAdminMarketMetrics(FIXTURE, 'eastbrook'));
    configureAdminMarketSoldVolume(async () => [
      { itemId: WYRMFALL_CORE_ITEM_ID, saleCount: 2, quantity: 5, copper: 1500 },
    ]);
    const out = await readAdminMarketMetrics();
    for (const bucket of out.buckets) expect(Object.isFrozen(bucket.sold)).toBe(true);
    expect(() => {
      (out.buckets[0].sold as { copper: number }).copper = 1;
    }).toThrow();
  });

  it('still serves the listing half when the store read rejects', async () => {
    // A database blip must not blank the dashboard: the listing half is
    // in-process and always answerable.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    configureAdminMarketMetrics(() => buildAdminMarketMetrics(FIXTURE, 'eastbrook'));
    configureAdminMarketSoldVolume(async () => {
      throw new Error('db down');
    });
    const out = await readAdminMarketMetrics();
    expect(out.soldAvailable).toBe(false);
    expect(out.buckets.find((b) => b.bucket === 'cores')?.listingCount).toBeGreaterThan(0);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it('still serves the listing half when no store is wired at all', async () => {
    configureAdminMarketMetrics(() => buildAdminMarketMetrics(FIXTURE, 'eastbrook'));
    const out = await readAdminMarketMetrics();
    expect(out.soldAvailable).toBe(false);
    expect(out.buckets).toHaveLength(MARKET_METRICS_BUCKETS.length);
  });
});
