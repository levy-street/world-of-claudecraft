// Unit coverage for the World Market tracker admin routes (server/admin.ts):
// /admin/api/market/overview, /market/item, /market/flips, /market/movers.
// The tests/server/admin.test.ts idiom: the pool never connects (fake db via
// setAdminDbForTests), routes are driven through their real middleware chain
// under withErrors, and the assertions pin the frozen admin envelope plus the
// market-specific contracts (the cut percent from the sim constant, param
// clamping, the two stats windows, and that no payload carries a buyer or
// seller id).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_admin_market';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAdminDbForTests, routes, setAdminDbForTests } from '../../server/admin';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { resetMarketAnalyticsCachesForTests } from '../../server/market_analytics';
import type { MarketLatestSnapshotRow, MarketSaleStatsRow } from '../../server/market_tracker_db';
import { MARKET_CUT } from '../../src/sim/market';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;

type DbOverrides = Record<string, unknown>;
function authedAdminDb(overrides: DbOverrides = {}): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' as const }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles: ['superadmin'] } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  } as Parameters<typeof setAdminDbForTests>[0]);
}

function readRes(res: http.ServerResponse): { status: number; body: any; raw: string } {
  const fake = res as unknown as FakeRes;
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    raw: fake.body,
  };
}

async function runRoute(
  method: Method,
  path: string,
  url: string,
  headers?: Record<string, string>,
  body?: unknown,
) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  const terminal: Middleware = async (c) => {
    await route.handler(c);
  };
  const ctx = fakeCtx({ method, url, headers, body });
  await compose([
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ])(ctx);
  return readRes(ctx.res);
}

function stats(itemId: string, over: Partial<MarketSaleStatsRow> = {}): MarketSaleStatsRow {
  return {
    itemId,
    sales: 10,
    quantity: 40,
    medianUnitPriceCopper: 200,
    avgUnitPriceCopper: 210,
    minUnitPriceCopper: 150,
    maxUnitPriceCopper: 260,
    ...over,
  };
}

function snapshot(itemId: string): MarketLatestSnapshotRow {
  return {
    itemId,
    capturedAt: new Date('2026-08-02T00:00:00Z'),
    listingCount: 2,
    totalQuantity: 7,
    lowestAskTotalCopper: 500,
    lowestAskQuantity: 5,
  };
}

beforeEach(() => resetAdminDbForTests());
afterEach(() => {
  resetAdminDbForTests();
  resetMarketAnalyticsCachesForTests();
  vi.clearAllMocks();
});

describe('market admin routes: auth gate', () => {
  it('401s db-free without a bearer on every market route', async () => {
    for (const path of [
      '/admin/api/market/overview',
      '/admin/api/market/item',
      '/admin/api/market/flips',
      '/admin/api/market/movers',
    ]) {
      const r = await runRoute('GET', path, path);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({
        success: false,
        data: null,
        error: 'admin authentication required',
      });
    }
  });
});

describe('GET /admin/api/market/overview', () => {
  it('serves the merged catalog with the sim cut percent and both windows', async () => {
    const saleStats = vi.fn(async (windowHours: number, offsetHours = 0) => {
      if (offsetHours !== 0) return [];
      return windowHours === 24
        ? [stats('wolf_fang', { sales: 3 })]
        : [stats('wolf_fang', { sales: 12 })];
    });
    authedAdminDb({
      marketLatestSnapshots: async () => [snapshot('wolf_fang')],
      marketSaleStats: saleStats,
    });
    const r = await runRoute('GET', '/admin/api/market/overview', '/admin/api/market/overview', {
      authorization: BEARER,
    });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.cutPct).toBe(Math.round(MARKET_CUT * 100));
    expect(r.body.data.capturedAt).toBe('2026-08-02T00:00:00.000Z');
    // The two standard windows, in hours.
    expect(saleStats.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([24, 168]);
    const fang = r.body.data.items.find((row: any) => row.itemId === 'wolf_fang');
    expect(fang).toMatchObject({
      lowestAskUnitCopper: 100,
      listingCount: 2,
      houseUnitAskCopper: null,
    });
    expect(fang.sales24h.sales).toBe(3);
    expect(fang.sales7d.sales).toBe(12);
    // The payload contract: no internal identity fields anywhere.
    expect(r.raw).not.toContain('buyer');
    expect(r.raw).not.toContain('seller');
  });
});

describe('GET /admin/api/market/item', () => {
  it('404s an unknown item id before any db read', async () => {
    const priceHistory = vi.fn(async () => []);
    authedAdminDb({ marketPriceHistory: priceHistory });
    const r = await runRoute(
      'GET',
      '/admin/api/market/item',
      '/admin/api/market/item?item=not_a_real_item',
      { authorization: BEARER },
    );
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown item' });
    expect(priceHistory).not.toHaveBeenCalled();
  });

  it('serves detail with clamped bucket and days, passing them to the reads', async () => {
    const priceHistory = vi.fn(async () => []);
    const askHistory = vi.fn(async () => []);
    const recent = vi.fn(async () => []);
    authedAdminDb({
      marketPriceHistory: priceHistory,
      marketAskHistory: askHistory,
      marketRecentSales: recent,
    });
    // Garbage bucket falls back to 'day'; days 9999 clamps to 365.
    const r = await runRoute(
      'GET',
      '/admin/api/market/item',
      '/admin/api/market/item?item=wolf_fang&bucket=fortnight&days=9999',
      { authorization: BEARER },
    );
    expect(r.status).toBe(200);
    expect(r.body.data.item.itemId).toBe('wolf_fang');
    expect(r.body.data.bucket).toBe('day');
    expect(r.body.data.days).toBe(365);
    expect(priceHistory).toHaveBeenCalledWith('wolf_fang', 'day', 365);
    expect(askHistory).toHaveBeenCalledWith('wolf_fang', 'day', 365);
    expect(recent).toHaveBeenCalledWith('wolf_fang', 50);
  });
});

describe('GET /admin/api/market/flips', () => {
  it('ranks flips off the live ask against the 7d median net of the cut', async () => {
    authedAdminDb({
      marketLatestSnapshots: async () => [snapshot('wolf_fang')],
      marketSaleStats: vi.fn(async (windowHours: number) =>
        windowHours === 168 ? [stats('wolf_fang', { medianUnitPriceCopper: 200 })] : [],
      ),
    });
    const r = await runRoute(
      'GET',
      '/admin/api/market/flips',
      '/admin/api/market/flips?minSales=5',
      { authorization: BEARER },
    );
    expect(r.status).toBe(200);
    expect(r.body.data.minSales).toBe(5);
    const [flip] = r.body.data.rows;
    expect(flip.itemId).toBe('wolf_fang');
    const net = 200 * (1 - MARKET_CUT);
    expect(flip.netUnitCopper).toBe(net);
    expect(flip.marginUnitCopper).toBe(net - 100);
  });

  it('minSales filters thin markets out of the board', async () => {
    authedAdminDb({
      marketLatestSnapshots: async () => [snapshot('wolf_fang')],
      marketSaleStats: vi.fn(async (windowHours: number) =>
        windowHours === 168 ? [stats('wolf_fang', { sales: 2 })] : [],
      ),
    });
    const r = await runRoute(
      'GET',
      '/admin/api/market/flips',
      '/admin/api/market/flips?minSales=3',
      { authorization: BEARER },
    );
    expect(r.body.data.rows).toEqual([]);
  });
});

describe('GET /admin/api/market/movers', () => {
  it('compares the window against the one before it', async () => {
    const saleStats = vi.fn(async (windowHours: number, offsetHours = 0) =>
      offsetHours === 0
        ? [stats('wolf_fang', { medianUnitPriceCopper: 300 })]
        : [stats('wolf_fang', { medianUnitPriceCopper: 200 })],
    );
    authedAdminDb({ marketSaleStats: saleStats });
    const r = await runRoute(
      'GET',
      '/admin/api/market/movers',
      '/admin/api/market/movers?windowHours=168',
      { authorization: BEARER },
    );
    expect(r.status).toBe(200);
    expect(r.body.data.windowHours).toBe(168);
    expect(saleStats).toHaveBeenCalledWith(168);
    expect(saleStats).toHaveBeenCalledWith(168, 168);
    expect(r.body.data.risers[0]).toMatchObject({ itemId: 'wolf_fang' });
    expect(r.body.data.risers[0].changePct).toBeCloseTo(0.5);
    expect(r.body.data.fallers).toEqual([]);
  });

  it('an unsupported window falls back to the 24h view', async () => {
    const saleStats = vi.fn(async () => []);
    authedAdminDb({ marketSaleStats: saleStats });
    const r = await runRoute(
      'GET',
      '/admin/api/market/movers',
      '/admin/api/market/movers?windowHours=999',
      { authorization: BEARER },
    );
    expect(r.body.data.windowHours).toBe(24);
  });
});

describe('market alerts routes', () => {
  it('lists alerts with the item name resolved from the catalog', async () => {
    authedAdminDb({
      listMarketAlerts: async () => [
        {
          id: 7,
          itemId: 'wolf_fang',
          metric: 'lowest_ask',
          direction: 'below',
          thresholdCopper: 150,
          active: true,
          createdAt: new Date('2026-08-01T00:00:00Z'),
          lastTriggeredAt: null,
          lastValueCopper: null,
        },
      ],
    });
    const r = await runRoute('GET', '/admin/api/market/alerts', '/admin/api/market/alerts', {
      authorization: BEARER,
    });
    expect(r.status).toBe(200);
    // The name comes from the real ITEMS registry, so a wrong join reddens here.
    expect(r.body.data.rows[0]).toMatchObject({
      id: 7,
      itemId: 'wolf_fang',
      name: 'Cracked Wolf Fang',
    });
  });

  it('creates an alert stamped with the caller and echoes the id', async () => {
    const insert = vi.fn(async () => 42);
    authedAdminDb({ insertMarketAlert: insert });
    const r = await runRoute(
      'POST',
      '/admin/api/market/alerts',
      '/admin/api/market/alerts',
      { authorization: BEARER },
      { item: 'wolf_fang', direction: 'below', thresholdCopper: 150 },
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: 42 });
    expect(insert).toHaveBeenCalledWith({
      itemId: 'wolf_fang',
      direction: 'below',
      thresholdCopper: 150,
      createdByAccountId: ADMIN_ACCOUNT_ID,
    });
  });

  it('refuses an unknown item, a bad direction, and a bad threshold', async () => {
    const insert = vi.fn(async () => 42);
    authedAdminDb({ insertMarketAlert: insert });
    const unknown = await runRoute(
      'POST',
      '/admin/api/market/alerts',
      '/admin/api/market/alerts',
      { authorization: BEARER },
      { item: 'nope', direction: 'below', thresholdCopper: 150 },
    );
    expect(unknown.status).toBe(404);
    const direction = await runRoute(
      'POST',
      '/admin/api/market/alerts',
      '/admin/api/market/alerts',
      { authorization: BEARER },
      { item: 'wolf_fang', direction: 'sideways', thresholdCopper: 150 },
    );
    expect(direction.status).toBe(400);
    for (const bad of [0, -5, 1.5, 5_000_001, 'x']) {
      const r = await runRoute(
        'POST',
        '/admin/api/market/alerts',
        '/admin/api/market/alerts',
        { authorization: BEARER },
        { item: 'wolf_fang', direction: 'below', thresholdCopper: bad },
      );
      expect(r.status).toBe(400);
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it('deletes by id and 404s a missing alert', async () => {
    const del = vi.fn(async (id: number) => id === 7);
    authedAdminDb({ deleteMarketAlert: del });
    const gone = await runRoute(
      'POST',
      '/admin/api/market/alerts/delete',
      '/admin/api/market/alerts/delete',
      { authorization: BEARER },
      { id: 7 },
    );
    expect(gone.status).toBe(200);
    const missing = await runRoute(
      'POST',
      '/admin/api/market/alerts/delete',
      '/admin/api/market/alerts/delete',
      { authorization: BEARER },
      { id: 8 },
    );
    expect(missing.status).toBe(404);
    const invalid = await runRoute(
      'POST',
      '/admin/api/market/alerts/delete',
      '/admin/api/market/alerts/delete',
      { authorization: BEARER },
      { id: 'x' },
    );
    expect(invalid.status).toBe(400);
  });
});
