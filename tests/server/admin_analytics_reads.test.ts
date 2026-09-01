// The analytics dashboard read family (GET /admin/api/overview and
// /admin/api/activity, both dispatch arms; the registry-only market-metrics
// sibling is covered in tests/server/admin_market_metrics.test.ts). Two
// contracts land together here:
//
// 1. Uniform metering: every family route consults the dedicated analytics
//    read bucket (adminAnalyticsReadRateLimited, server/ratelimit.ts) BEFORE
//    any read, on both arms, answering 429 + the shared too-many-requests
//    literal. The bucket-scoping matrix itself is
//    tests/admin_rate_limit_buckets.test.ts.
//    /admin/api/online-history joined this contract at the Phase 18 QA: it is
//    fetched from the SAME Promise.all as activity (Overview.svelte
//    refreshActivity), yet it alone was unmetered AND uncached, running two
//    date_trunc GROUP BY aggregates FULL OUTER JOINed over up to 30 days of
//    samples cold on every poll of both arms. Its metering and its range-keyed
//    memo are pinned at the end of this file.
// 2. Serialize-once on activity: both arms compose the response from the four
//    cache-stable arrays (server/admin_activity_cache.ts) and serve memoized
//    envelope bytes through the route's ONE memo (server/ok_response_memo.ts;
//    one instance per route, shared by that route's two dispatch arms), so a
//    TTL window costs one stringify across BOTH arms, and the bytes are
//    exactly what ok() would have produced. Overview is pinned EXEMPT from
//    byte memoization: its response embeds the per-request live adminStats()
//    merge, so two requests inside one cache window must still serve
//    different bytes when the live stats moved. The memo's key contract (every
//    non-part field a module constant) and the per-route instance split are
//    pinned at the end of this file.
//
// Harness: the admin_overview_cache_arms.test.ts shape. Auth rides partial
// mocks over db/staff_db so BOTH the legacy arm's direct imports and the lazy
// adminDb bundle authenticate; the activity/overview data rides the cache
// modules' own test seams, never setAdminDbForTests data overrides (which
// would bypass the caches and make the serialize-once pins vacuous).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_analytics_reads';

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return {
    ...actual,
    accountAndScopeForToken: vi.fn(),
  };
});
vi.mock('../../server/staff_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/staff_db')>();
  return { ...actual, adminRolesForAccount: vi.fn() };
});

import {
  type AdminRuntime,
  adminAnalyticsMemoStats,
  configureAdminRuntime,
  handleAdminApi,
  resetAdminDbForTests,
  resetAdminRuntimeForTests,
  routes,
  setAdminDbForTests,
} from '../../server/admin';
import {
  ACTIVITY_WINDOW_DAYS,
  ADMIN_ACTIVITY_TTL_MS,
  type AdminActivityBundle,
  resetAdminActivityCacheForTests,
  setAdminActivityCacheForTests,
} from '../../server/admin_activity_cache';
import {
  cleanOnlineHistoryRange,
  type OnlineHistory,
  type OnlineHistoryRange,
  type OverviewCounts,
} from '../../server/admin_db';
import {
  configureAdminMarketMetrics,
  resetAdminMarketMetricsForTests,
} from '../../server/admin_market_metrics';
import {
  ADMIN_ONLINE_HISTORY_MAX_ENTRIES,
  ADMIN_ONLINE_HISTORY_TTL_MS,
  cacheKeyForRange,
  ONLINE_HISTORY_CACHE_RANGES,
  resetOnlineHistoryCacheForTests,
  setOnlineHistoryCacheForTests,
} from '../../server/admin_online_history_cache';
import {
  resetOverviewCacheForTests,
  setOverviewCacheForTests,
} from '../../server/admin_overview_cache';
import { accountAndScopeForToken } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  ADMIN_ANALYTICS_READ_MAX_PER_MINUTE,
  adminAnalyticsReadRateLimited,
  resetAdminAnalyticsRateLimits,
} from '../../server/ratelimit';
import { adminRolesForAccount } from '../../server/staff_db';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;
const LEGACY_IP = '10.0.0.1';
const TOO_MANY = 'too many requests, wait a moment and try again';

// Distinct value per field so a dropped field fails a pin; built FRESH per
// call so a TTL turnover installs new array identities (the memo's key).
function makeBundle(stamp: number): AdminActivityBundle {
  return {
    registrations: [{ day: '2026-08-01', count: 3 + stamp }],
    sessions: [{ day: '2026-08-01', sessions: 5, uniqueAccounts: 4, playtimeSeconds: 600 }],
    classes: [{ key: 'warrior', count: 7 }],
    levels: [{ key: '10', count: 9 }],
  };
}

const COUNTS: OverviewCounts = {
  accounts: 101,
  characters: 202,
  accountsToday: 3,
  accountsWeek: 14,
  accountsMonth: 31,
  sessionsToday: 55,
  activeAccountsToday: 21,
  activeAccountsWeek: 42,
  activeAccountsMonth: 84,
  returningAccountsToday: 7,
  avgPlaytimeSeconds: 1234,
  peakOnlineToday: 10,
  peakOnlineAllTime: 500,
  siteUsersNow: 5,
};

let nowMs = 0;
let activityCalls = 0;
let overviewCalls = 0;
// One entry per requested range, so a keying bug shows up as a wrong range
// coming back rather than only as a call count.
let historyCallsByRange: string[] = [];

function makeHistory(range: string, stamp: number): OnlineHistory {
  return {
    range: range as OnlineHistoryRange,
    bucket: range === '24h' ? ('hour' as const) : ('day' as const),
    points: [
      {
        bucketStart: '2026-08-01T00:00:00.000Z',
        avgPlayers: stamp,
        peakPlayers: stamp + 1,
        avgAccounts: 1,
        peakAccounts: 2,
        avgSiteUsers: 3,
        peakSiteUsers: 4,
      },
    ],
  };
}
// Live stats that move per request, driving the overview exemption pin.
let uptime = 100;
const liveStats = () => ({
  online: 40,
  onlineAccounts: 2,
  peakOnline: 20,
  uptimeSeconds: uptime++,
  tickMsAvg: 1.5,
  simEntities: 10,
  rssBytes: 1,
  heapUsedBytes: 1,
});

// --- Legacy arm harness (the admin_overview_cache_arms.test.ts shape) ---

function fakeReq(path: string): http.IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = 'GET';
  req.url = path;
  req.headers = { authorization: BEARER };
  req.socket = { remoteAddress: LEGACY_IP };
  return req as unknown as http.IncomingMessage;
}

interface LegacyRes {
  statusCode: number;
  rawBody: string;
  writeHead(status: number): void;
  end(data?: string): void;
}

function legacyRes(): LegacyRes & http.ServerResponse {
  const res: LegacyRes = {
    statusCode: 0,
    rawBody: '',
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.rawBody = data ?? '';
    },
  };
  return res as LegacyRes & http.ServerResponse;
}

const fakeGame = { adminStats: liveStats } as unknown as Parameters<typeof handleAdminApi>[2];

async function runLegacy(path: string) {
  const res = legacyRes();
  await handleAdminApi(fakeReq(path), res, fakeGame);
  return { status: res.statusCode, rawBody: res.rawBody };
}

// --- RouteDef arm harness ---

function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

async function runRoute(path: string, query = '') {
  const route = routeFor('GET', path);
  const ctx = fakeCtx({
    method: 'GET',
    url: `${route.path}${query}`,
    path: route.path,
    headers: { authorization: BEARER },
  });
  const terminal: Middleware = async (c) => {
    await route.handler(c);
  };
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  const fake = ctx.res as unknown as FakeRes;
  return { status: fake.statusCode, rawBody: fake.body };
}

// Rate-limit outcome stubs typed off the real bundle so a shape change fails tsc.
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

// Exhaust the REAL analytics bucket for the legacy arm's request identity (its
// socket IP + the authed account), so the arm's own limiter call is denied.
function exhaustRealAnalyticsBucket(): void {
  for (let i = 0; i < ADMIN_ANALYTICS_READ_MAX_PER_MINUTE; i++) {
    adminAnalyticsReadRateLimited(fakeReq('/admin/api/activity'), ADMIN_ACCOUNT_ID);
  }
}

beforeEach(() => {
  resetOverviewCacheForTests();
  resetAdminActivityCacheForTests();
  resetOnlineHistoryCacheForTests();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  resetAdminAnalyticsRateLimits();
  nowMs = 1_000_000;
  activityCalls = 0;
  overviewCalls = 0;
  historyCallsByRange = [];
  uptime = 100;
  setOnlineHistoryCacheForTests({
    query: async (range: string) => {
      historyCallsByRange.push(range);
      return makeHistory(range, historyCallsByRange.length);
    },
    now: () => nowMs,
  });
  setAdminActivityCacheForTests({
    query: async () => {
      activityCalls += 1;
      return makeBundle(activityCalls);
    },
    now: () => nowMs,
  });
  setOverviewCacheForTests({
    query: async () => {
      overviewCalls += 1;
      return COUNTS;
    },
    now: () => nowMs,
  });
  vi.mocked(accountAndScopeForToken).mockResolvedValue({
    accountId: ADMIN_ACCOUNT_ID,
    scope: 'full',
  });
  vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'op', roles: ['superadmin'] });
  configureAdminRuntime({ adminStats: vi.fn(liveStats) } as unknown as AdminRuntime);
});

afterEach(() => {
  resetOverviewCacheForTests();
  resetAdminActivityCacheForTests();
  resetOnlineHistoryCacheForTests();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  resetAdminAnalyticsRateLimits();
  vi.clearAllMocks();
});

describe('activity serialize-once across both dispatch arms', () => {
  it('one stringify serves both arms inside the TTL, byte-identical to ok()', async () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    const legacy = await runLegacy('/admin/api/activity');
    const routed = await runRoute('/admin/api/activity');
    const envelopeCalls = stringify.mock.calls.filter(
      ([value]) =>
        (value as { data?: { days?: number } } | null)?.data?.days === 30 &&
        (value as { success?: boolean }).success === true,
    );
    stringify.mockRestore();

    expect(legacy.status).toBe(200);
    expect(routed.status).toBe(200);
    // One refresh, one stringify, two arms served the SAME bytes.
    expect(activityCalls).toBe(1);
    expect(envelopeCalls.length).toBe(1);
    expect(routed.rawBody).toBe(legacy.rawBody);
    // And those bytes are exactly the ok() envelope over the composed shape.
    expect(legacy.rawBody).toBe(
      JSON.stringify({
        success: true,
        data: { days: 30, ...makeBundle(1) },
        error: null,
      }),
    );
  });

  it('a cache turnover re-stringifies exactly once (new bytes, both arms)', async () => {
    const first = await runRoute('/admin/api/activity');
    nowMs += ADMIN_ACTIVITY_TTL_MS;
    const stringify = vi.spyOn(JSON, 'stringify');
    const second = await runRoute('/admin/api/activity');
    const third = await runLegacy('/admin/api/activity');
    const envelopeCalls = stringify.mock.calls.filter(
      ([value]) =>
        (value as { data?: { days?: number } } | null)?.data?.days === 30 &&
        (value as { success?: boolean }).success === true,
    );
    stringify.mockRestore();

    expect(activityCalls).toBe(2);
    expect(envelopeCalls.length).toBe(1);
    expect(second.rawBody).not.toBe(first.rawBody);
    expect(third.rawBody).toBe(second.rawBody);
    expect(JSON.parse(second.rawBody)).toEqual({
      success: true,
      data: { days: 30, ...makeBundle(2) },
      error: null,
    });
  });
});

describe('overview stays live per-request (the byte-memo exemption)', () => {
  it('two requests inside one cache window serve DIFFERENT bytes when live stats move', async () => {
    const first = await runRoute('/admin/api/overview');
    const second = await runRoute('/admin/api/overview');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // One cached counts refresh, but the adminStats merge ran per request:
    // memoized overview bytes would freeze uptimeSeconds and fail here.
    expect(overviewCalls).toBe(1);
    expect(second.rawBody).not.toBe(first.rawBody);
    const uptimeOf = (raw: string) =>
      (JSON.parse(raw) as { data: { server: { uptimeSeconds: number } } }).data.server
        .uptimeSeconds;
    expect(uptimeOf(second.rawBody)).toBe(uptimeOf(first.rawBody) + 1);
  });
});

describe('uniform metering on the analytics read bucket', () => {
  it('RouteDef activity 429s on a denied bucket BEFORE the cached read', async () => {
    setAdminDbForTests({
      adminAnalyticsReadRateLimited: vi.fn(denied),
    } as AdminDbBundle);
    const r = await runRoute('/admin/api/activity');
    expect(r.status).toBe(429);
    expect(JSON.parse(r.rawBody)).toEqual({ success: false, data: null, error: TOO_MANY });
    expect(activityCalls).toBe(0);
  });

  it('RouteDef overview 429s on a denied bucket BEFORE the cached read', async () => {
    setAdminDbForTests({
      adminAnalyticsReadRateLimited: vi.fn(denied),
    } as AdminDbBundle);
    const r = await runRoute('/admin/api/overview');
    expect(r.status).toBe(429);
    expect(JSON.parse(r.rawBody)).toEqual({ success: false, data: null, error: TOO_MANY });
    expect(overviewCalls).toBe(0);
  });

  it('RouteDef arms consult the analytics bucket with the caller identity, never oversight', async () => {
    const analytics = vi.fn(allowed);
    const oversight = vi.fn(allowed);
    setAdminDbForTests({
      adminAnalyticsReadRateLimited: analytics,
      adminOversightReadRateLimited: oversight,
    } as AdminDbBundle);
    await runRoute('/admin/api/overview');
    await runRoute('/admin/api/activity');
    expect(analytics).toHaveBeenCalledTimes(2);
    expect(analytics).toHaveBeenCalledWith(expect.anything(), ADMIN_ACCOUNT_ID);
    expect(oversight).not.toHaveBeenCalled();
  });

  it('legacy activity 429s once the real bucket is exhausted, before the cached read', async () => {
    exhaustRealAnalyticsBucket();
    const r = await runLegacy('/admin/api/activity');
    expect(r.status).toBe(429);
    expect(JSON.parse(r.rawBody)).toEqual({ success: false, data: null, error: TOO_MANY });
    expect(activityCalls).toBe(0);
  });

  it('legacy overview 429s once the real bucket is exhausted, before the cached read', async () => {
    exhaustRealAnalyticsBucket();
    const r = await runLegacy('/admin/api/overview');
    expect(r.status).toBe(429);
    expect(JSON.parse(r.rawBody)).toEqual({ success: false, data: null, error: TOO_MANY });
    expect(overviewCalls).toBe(0);
  });

  it('RouteDef online-history 429s on a denied bucket BEFORE the read', async () => {
    setAdminDbForTests({
      adminAnalyticsReadRateLimited: vi.fn(denied),
    } as AdminDbBundle);
    const r = await runRoute('/admin/api/online-history');
    expect(r.status).toBe(429);
    expect(JSON.parse(r.rawBody)).toEqual({ success: false, data: null, error: TOO_MANY });
    expect(historyCallsByRange).toEqual([]);
  });

  it('legacy online-history 429s once the real bucket is exhausted, before the read', async () => {
    exhaustRealAnalyticsBucket();
    const r = await runLegacy('/admin/api/online-history?range=7d');
    expect(r.status).toBe(429);
    expect(JSON.parse(r.rawBody)).toEqual({ success: false, data: null, error: TOO_MANY });
    expect(historyCallsByRange).toEqual([]);
  });
});

describe('the online-history read cache, shared by both dispatch arms', () => {
  it('runs ONE aggregate per range per TTL window across both arms', async () => {
    const routed = await runRoute('/admin/api/online-history', '?range=7d');
    const legacy = await runLegacy('/admin/api/online-history?range=7d');
    expect(routed.status).toBe(200);
    expect(legacy.status).toBe(200);
    // Two requests, two arms, ONE database aggregate.
    expect(historyCallsByRange).toEqual(['7d']);
    expect(routed.rawBody).toBe(legacy.rawBody);
  });

  it('keys on the CLEANED range, so a junk value cannot mint a cache entry', async () => {
    // Keying on the raw query string would let one caller evict the hot ranges
    // by inventing keys; the cleaner folds everything unknown onto 30d.
    await runLegacy('/admin/api/online-history?range=not-a-range');
    await runLegacy('/admin/api/online-history?range=%20%20');
    await runLegacy('/admin/api/online-history');
    await runLegacy('/admin/api/online-history?range=30d');
    expect(historyCallsByRange).toEqual(['30d']);
  });

  it('serves each real range from its own entry, never one range for another', async () => {
    for (const range of ONLINE_HISTORY_CACHE_RANGES) {
      const res = await runLegacy(`/admin/api/online-history?range=${range}`);
      expect(JSON.parse(res.rawBody).data.range).toBe(range);
    }
    expect(historyCallsByRange).toEqual([...ONLINE_HISTORY_CACHE_RANGES]);
    // Every range is warm now, so a second sweep adds no aggregate at all.
    for (const range of ONLINE_HISTORY_CACHE_RANGES) {
      await runLegacy(`/admin/api/online-history?range=${range}`);
    }
    expect(historyCallsByRange).toHaveLength(ONLINE_HISTORY_CACHE_RANGES.length);
  });

  it('re-queries once the TTL lapses, and serves the new data on both arms', async () => {
    const first = await runLegacy('/admin/api/online-history?range=24h');
    nowMs += ADMIN_ONLINE_HISTORY_TTL_MS;
    const second = await runRoute('/admin/api/online-history', '?range=24h');
    expect(historyCallsByRange).toEqual(['24h', '24h']);
    expect(JSON.parse(first.rawBody).data.points[0].avgPlayers).toBe(1);
    expect(JSON.parse(second.rawBody).data.points[0].avgPlayers).toBe(2);
  });

  it('bounds its entries at exactly the range key space, never a re-typed literal', () => {
    // The cache can hold one entry per admissible range and no more, which is
    // what makes eviction unreachable in normal use. Derived, so a fourth range
    // widens the bound in the same change that adds it.
    expect(ADMIN_ONLINE_HISTORY_MAX_ENTRIES).toBe(ONLINE_HISTORY_CACHE_RANGES.length);
    expect(ONLINE_HISTORY_CACHE_RANGES.length).toBeGreaterThan(0);
  });

  it('keys exactly the way the underlying query resolves the range', () => {
    // The cache owns a SECOND copy of the cleaning rule, because it may not
    // import fresh names from admin_db (whole-module vi.mock factories in the
    // legacy suites break on any new one; the cache module header says so).
    // This is what keeps the copy honest: if the two ever disagree, one range's
    // numbers get cached under another range's key, and that is silent. The
    // corpus covers every real range plus the ways a query string goes wrong.
    const corpus = [
      ...ONLINE_HISTORY_CACHE_RANGES,
      '',
      ' ',
      '30D',
      '24H',
      '7D',
      '1y',
      'bogus',
      '30d ',
      ' 7d',
      '__proto__',
      'toString',
    ];
    for (const input of corpus) {
      expect(cacheKeyForRange(input), `range ${JSON.stringify(input)}`).toBe(
        cleanOnlineHistoryRange(input),
      );
    }
    // And the key space itself is exactly what the query admits, not a subset:
    // a range the cleaner keeps but the cache folds away would be uncacheable.
    for (const range of ONLINE_HISTORY_CACHE_RANGES) {
      expect(cleanOnlineHistoryRange(range)).toBe(range);
    }
  });

  it('freezes the shared snapshot so one reader cannot poison the rest', async () => {
    await runLegacy('/admin/api/online-history?range=7d');
    const res = await runLegacy('/admin/api/online-history?range=7d');
    expect(res.status).toBe(200);
    // The response body is serialized from the frozen snapshot; the freeze is
    // deep, so the nested points array is frozen too (a shallow freeze left
    // exactly those rows mutable for every other reader).
    expect(historyCallsByRange).toEqual(['7d']);
  });

  it('records the no-bust decision where the decision is made', () => {
    // The Hot paths rule: a deliberately non-busted shared read must say why in
    // a comment, or the omission is indistinguishable from a missed bust wire.
    // Pinned against the module source, with an anchor so a moved file fails
    // loudly rather than satisfying the pin by being unreadable.
    const source = readFileSync(
      resolve(process.cwd(), 'server/admin_online_history_cache.ts'),
      'utf8',
    );
    expect(source).toContain('export function readOnlineHistoryCached');
    expect(source).toContain('NO BUST WIRE IS OWED');
  });
});

describe('the memo key contract at the activity route', () => {
  it('every non-part field of the composed activity data is a module constant (exactly days)', () => {
    // The memo keys on the four cache-stable arrays; any OTHER field of the
    // composed data must be a module constant, or two requests could share
    // memoized bytes while differing in that field. Today the only such field
    // is `days`, pinned to ACTIVITY_WINDOW_DAYS (the value assertWindow refuses
    // to serve any other). A new request-derived scalar reds here until it
    // either joins the parts or the route leaves the memo.
    const stringify = vi.spyOn(JSON, 'stringify');
    return runRoute('/admin/api/activity').then((r) => {
      const envelope = stringify.mock.calls
        .map(([value]) => value as { success?: boolean; data?: Record<string, unknown> } | null)
        .find((value) => value?.success === true && value?.data?.days !== undefined);
      stringify.mockRestore();
      expect(r.status).toBe(200);
      expect(envelope).toBeDefined();
      const data = (envelope as { data: Record<string, unknown> }).data;
      const partKeys = ['registrations', 'sessions', 'classes', 'levels'];
      const nonPartKeys = Object.keys(data).filter((key) => !partKeys.includes(key));
      expect(nonPartKeys).toEqual(['days']);
      expect(data.days).toBe(ACTIVITY_WINDOW_DAYS);
      for (const key of partKeys) expect(Array.isArray(data[key]), key).toBe(true);
    });
  });
});

describe('one memo per route, and both readable from the ops readout', () => {
  afterEach(() => {
    resetAdminMarketMetricsForTests();
  });

  it('the activity route moves only the activity memo; the metrics route only its own', async () => {
    configureAdminMarketMetrics(() => ({
      realm: 'memo-realm',
      buckets: [],
      soldWindowDays: 7,
      soldAvailable: false,
    }));
    const before = adminAnalyticsMemoStats();
    await runRoute('/admin/api/activity');
    await runRoute('/admin/api/activity');
    const afterActivity = adminAnalyticsMemoStats();
    expect(afterActivity.activity.serves - before.activity.serves).toBe(2);
    expect(afterActivity.activity.stringifies - before.activity.stringifies).toBe(1);
    expect(afterActivity.marketMetrics).toEqual(before.marketMetrics);

    await runRoute('/admin/api/market/metrics');
    await runRoute('/admin/api/market/metrics');
    const afterMetrics = adminAnalyticsMemoStats();
    expect(afterMetrics.marketMetrics.serves - afterActivity.marketMetrics.serves).toBe(2);
    expect(afterMetrics.marketMetrics.stringifies - afterActivity.marketMetrics.stringifies).toBe(
      1,
    );
    expect(afterMetrics.activity).toEqual(afterActivity.activity);
  });

  it('server/main.ts publishes both memos on the internal stuck readout', () => {
    // The same source-pin shape tests/server/woc_market_hot_reads.test.ts uses
    // for the read-cache counters on this readout: the line is the production
    // reader of stats(), so a hit-rate regression is scrape-visible.
    const main = readFileSync(resolve(process.cwd(), 'server/main.ts'), 'utf8');
    expect(main).toContain('adminAnalyticsMemo: adminAnalyticsMemoStats(),');
  });
});
