// Unit coverage for the daily-rewards route layer (server/daily_rewards.ts).
//
// The migration lifted BOTH daily-rewards families off their legacy ladders onto RouteDefs
// the shared dispatcher serves (v0.20.0 grew each family by its paginated leaderboard):
//   - the PLAYER family (GET /api/daily-rewards, GET /api/daily-rewards/leaderboard,
//     POST /api/daily-rewards/spin, GET /api/daily-rewards/history), each gated by the
//     shared legacy-body activeGuard (createActiveGuard over the lazy guard db),
//     calling handleDailyRewardApi UNCHANGED;
//   - the OPS family (POST /internal/daily-rewards/{pending-payouts,payout-history,
//     leaderboard,mark-payout}), surface 'internal' + meta.envelope 'admin', each gated
//     by the FAIL-CLOSED requireInternalSecretFailClosed gate (401 on both an unset env
//     secret AND a mismatch, never a feature-off 404, never a fallback secret), calling
//     handleDailyRewardInternalApi UNCHANGED (the core re-checks the same secret).
//
// It is a PARITY-FIRST migration: each thin handler reuses the same sub-dispatcher the
// ladder serves, so every body, the lenient Number(...)||limit decode, and mark-payout's
// validation prose are byte-identical. There is NO withBody anywhere (spin reads no body;
// mark-payout self-reads via the core's un-caught readBody, the
// dailyRewardsOpsBodyValidationRemap deviation) and NO rate limiter on any of the eight
// (legacy has none; the spin throttle decision is the two-tier rate limiter's).
//
// This file pins the ROUTE LAYER. The existing tests/daily_rewards.test.ts covers the
// DailyRewardService internals against a hand-written FakeDailyRewardDb; here the service
// is driven through the real route chain (compose + withErrors + the real guard/gate
// middleware) with the db, wallet, and balance reads mocked so nothing hits Postgres.
//
// server/db builds a pg Pool at module load and throws if DATABASE_URL is unset; a dummy
// URL is set before the module graph evaluates. The pool never connects: the guard reads
// go through setDailyRewardDbForTests, the service db is a mocked PgDailyRewardDb, and
// walletForAccount / cachedWocBalance are mocked.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_daily_routes';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountModerationStatus } from '../../server/db';

// One hoisted bundle: a mutable `state` the fakes read, a mocked PgDailyRewardDb surface
// (vi.fns closing over state, so per-test control is a state write, never a leaky
// once-implementation), and the wallet/balance read fakes. Reset in beforeEach.
const h = vi.hoisted(() => {
  const state = {
    spin: null as { outcomeKey: string; points: number; createdAt: string } | null,
    recentPayouts: [] as unknown[],
    pendingPayouts: [] as unknown[],
    markPayoutOk: true,
    ensureDayThrows: false,
    wallet: null as { account_id: number; pubkey: string; linked_at: string } | null,
    balance: null as number | null,
  };
  const db = {
    ensureDay: vi.fn(async () => {
      if (state.ensureDayThrows) throw new Error('db exploded');
    }),
    seedTasks: vi.fn(async () => {}),
    tasksForAccount: vi.fn(async () => [] as unknown[]),
    tasksForType: vi.fn(async () => [] as unknown[]),
    scoreForAccount: vi.fn(async () => 0),
    onlineMinutesForAccount: vi.fn(async () => 0),
    rankForAccount: vi.fn(async () => null),
    leaderboard: vi.fn(async () => [] as unknown[]),
    leaderboardRowForAccount: vi.fn(async () => null),
    leaderboardTotal: vi.fn(async () => 0),
    leaderboardPage: vi.fn(async (_day: string, page: number, pageSize: number) => ({
      rows: [] as unknown[],
      page,
      pageSize,
      pageCount: 1,
      total: 0,
    })),
    spinForAccount: vi.fn(async () => state.spin),
    recordSpin: vi.fn(async () => true),
    addPoints: vi.fn(async () => true),
    questTaskCompletionCount: vi.fn(async () => 0),
    recentPayouts: vi.fn(async (_limit: number) => state.recentPayouts),
    finalizeDay: vi.fn(async () => {}),
    pendingPayouts: vi.fn(async (_limit: number) => state.pendingPayouts),
    unannouncedWinnerDays: vi.fn(async () => [] as unknown[]),
    markWinnersAnnounced: vi.fn(async () => true),
    markPayout: vi.fn(async () => state.markPayoutOk),
  };
  const wallet = { walletForAccount: vi.fn(async (_accountId: number) => state.wallet) };
  const balance = { cachedWocBalance: vi.fn(async (_pubkey: string) => state.balance) };
  return { state, db, wallet, balance };
});

// The service singleton constructs new PgDailyRewardDb() at module load; swap it for a
// fake whose methods are the shared vi.fns. importOriginal + spread keeps the interface
// types and any other export intact (partial-safe).
vi.mock('../../server/daily_rewards_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/daily_rewards_db')>();
  class FakePgDailyRewardDb {
    ensureDay = h.db.ensureDay;
    seedTasks = h.db.seedTasks;
    tasksForAccount = h.db.tasksForAccount;
    tasksForType = h.db.tasksForType;
    scoreForAccount = h.db.scoreForAccount;
    onlineMinutesForAccount = h.db.onlineMinutesForAccount;
    rankForAccount = h.db.rankForAccount;
    leaderboard = h.db.leaderboard;
    leaderboardRowForAccount = h.db.leaderboardRowForAccount;
    leaderboardTotal = h.db.leaderboardTotal;
    leaderboardPage = h.db.leaderboardPage;
    spinForAccount = h.db.spinForAccount;
    recordSpin = h.db.recordSpin;
    addPoints = h.db.addPoints;
    questTaskCompletionCount = h.db.questTaskCompletionCount;
    recentPayouts = h.db.recentPayouts;
    finalizeDay = h.db.finalizeDay;
    pendingPayouts = h.db.pendingPayouts;
    unannouncedWinnerDays = h.db.unannouncedWinnerDays;
    markWinnersAnnounced = h.db.markWinnersAnnounced;
    markPayout = h.db.markPayout;
  }
  return { ...actual, PgDailyRewardDb: FakePgDailyRewardDb };
});

// Partial-mock server/db: keep scopeAllowsMutation, accountAndScopeForToken,
// moderationStatusForAccount, pool, and the rest REAL (the lazy guard bundle reads them,
// and the guard is overridden per test via setDailyRewardDbForTests), overriding only the
// service's walletForAccount read.
vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return { ...actual, walletForAccount: h.wallet.walletForAccount };
});

// Partial-mock woc_balance: override only the RPC-backed balance read (the sole export
// the daily-rewards graph dereferences).
vi.mock('../../server/woc_balance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/woc_balance')>();
  return { ...actual, cachedWocBalance: h.balance.cachedWocBalance };
});

import {
  DailyRewardService,
  dailyRewardService,
  resetDailyRewardDbForTests,
  resetDailyRewardPriceCacheForTests,
  routes,
  setDailyRewardDbForTests,
} from '../../server/daily_rewards';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the guard BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// The ops gate's (header, env) pair; the gate reads the env var PER REQUEST.
const OPS_HEADER = 'x-woc-daily-reward-secret';
const OPS_SECRET_ENV = 'WOC_DAILY_REWARD_SERVICE_SECRET';
const OPS_SECRET = 'ops-secret';
const OPS_HEADERS = { [OPS_HEADER]: OPS_SECRET };

// The eight routes, in declared order, as `${method} ${path}` (v0.20.0 added
// the paginated leaderboard read to each family).
const PLAYER_PATHS: ReadonlyArray<readonly [Method, string]> = [
  ['GET', '/api/daily-rewards'],
  ['GET', '/api/daily-rewards/leaderboard'],
  ['POST', '/api/daily-rewards/spin'],
  ['GET', '/api/daily-rewards/history'],
];
const OPS_PATHS: ReadonlyArray<readonly [Method, string]> = [
  ['POST', '/internal/daily-rewards/pending-payouts'],
  ['POST', '/internal/daily-rewards/payout-history'],
  ['POST', '/internal/daily-rewards/leaderboard'],
  ['POST', '/internal/daily-rewards/mark-payout'],
];

/** A full DailyRewardPayoutRow, so history/payout-history map to a known shape. */
function payoutRow(rank: number) {
  return {
    day: '2026-07-01',
    rank,
    accountId: 7,
    username: 'alice',
    walletPubkey: 'Wallet',
    points: 100,
    prizePercent: 0.2,
    prizeUsd: 30,
    status: 'pending',
    txSignature: null,
    paidAt: null,
  };
}

/** A not-locked AccountModerationStatus (the guard bundle's real return shape). */
function modStatus(overrides: Partial<AccountModerationStatus> = {}): AccountModerationStatus {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
    ...overrides,
  };
}

/** Authorize the shared guard db with a full, non-locked account (overridable). */
function authedDb(overrides: Partial<Parameters<typeof setDailyRewardDbForTests>[0]> = {}): void {
  setDailyRewardDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 7, scope: 'full' }),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

/**
 * Make dailyRewardRuntimeConfig resolve a config carrying a live WOC price (so an
 * eligibility check can pass): set the payout-service URL and stub fetch to return it.
 * The eligible path also needs a linked wallet and a balance, set on state by the caller.
 */
function stubPriceConfig(): void {
  process.env.WOC_DAILY_REWARD_SERVICE_URL = 'https://payout.test';
  resetDailyRewardPriceCacheForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            minUsd: 20,
            prizePoolUsd: 150,
            wocUsdPrice: 0.5,
            solUsdPrice: 200,
            activeSeconds: 120,
            dayStartUtcMinutes: 21 * 60,
            tasks: [],
          }),
          { status: 200 },
        ),
    ),
  );
}

/** Read status/body/content-type/headers off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
  headers: Record<string, string | number | string[]>;
} {
  const fake = res as unknown as FakeRes;
  const raw = fake.body;
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: fake.statusCode,
    body,
    raw,
    contentType: fake.headers['content-type'] as string | undefined,
    headers: fake.headers,
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a full route chain (its real gate/guard middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: {
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
    req?: http.IncomingMessage;
  } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    headers: opts.headers,
    body: opts.body,
    req: opts.req,
  });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

const ORIGINAL_OPS_SECRET = process.env[OPS_SECRET_ENV];
const ORIGINAL_SERVICE_URL = process.env.WOC_DAILY_REWARD_SERVICE_URL;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the mutable fake state to its defaults.
  h.state.spin = null;
  h.state.recentPayouts = [];
  h.state.pendingPayouts = [];
  h.state.markPayoutOk = true;
  h.state.ensureDayThrows = false;
  h.state.wallet = null;
  h.state.balance = null;
  resetDailyRewardDbForTests();
  resetDailyRewardPriceCacheForTests();
  // Default: the gate secret and the config URL are unset, so the config falls back
  // (no fetch) and the ops gate fails closed unless a test opts in.
  delete process.env[OPS_SECRET_ENV];
  delete process.env.WOC_DAILY_REWARD_SERVICE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetDailyRewardDbForTests();
  resetDailyRewardPriceCacheForTests();
  restoreEnv(OPS_SECRET_ENV, ORIGINAL_OPS_SECRET);
  restoreEnv('WOC_DAILY_REWARD_SERVICE_URL', ORIGINAL_SERVICE_URL);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The route table shape.
// ---------------------------------------------------------------------------

describe('daily-rewards route table', () => {
  it('registers exactly the eight routes in the declared order', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/daily-rewards',
      'GET /api/daily-rewards/leaderboard',
      'POST /api/daily-rewards/spin',
      'GET /api/daily-rewards/history',
      'POST /internal/daily-rewards/pending-payouts',
      'POST /internal/daily-rewards/payout-history',
      'POST /internal/daily-rewards/leaderboard',
      'POST /internal/daily-rewards/mark-payout',
    ]);
  });

  it('marks the player family surface api with NO meta.envelope', () => {
    for (const [method, path] of PLAYER_PATHS) {
      const r = routeFor(method, path);
      expect(r.surface, path).toBe('api');
      expect(r.meta?.envelope, path).toBeUndefined();
    }
  });

  it('marks the ops family surface internal with meta.envelope admin', () => {
    for (const [method, path] of OPS_PATHS) {
      const r = routeFor(method, path);
      expect(r.surface, path).toBe('internal');
      expect(r.meta?.envelope, path).toBe('admin');
    }
  });

  it('mounts exactly one middleware on every route, with no body schema (no withBody)', () => {
    for (const r of routes) {
      expect(Array.isArray(r.middleware) && r.middleware.length === 1, r.path).toBe(true);
      expect(r.schema, r.path).toBeUndefined();
    }
  });

  it('shares one activeGuard across the player family and one gate across the ops family, distinct from each other', () => {
    const playerGuards = new Set(PLAYER_PATHS.map(([m, p]) => routeFor(m, p).middleware?.[0]));
    const opsGates = new Set(OPS_PATHS.map(([m, p]) => routeFor(m, p).middleware?.[0]));
    // All three player routes carry the SAME guard instance; all three ops routes the SAME
    // gate instance; the guard is not the gate.
    expect(playerGuards.size).toBe(1);
    expect(opsGates.size).toBe(1);
    expect([...playerGuards][0]).not.toBe([...opsGates][0]);
  });
});

// ---------------------------------------------------------------------------
// 2. The player routes authenticate through the REAL shared activeGuard chain.
// ---------------------------------------------------------------------------

describe('player routes: activeGuard chain', () => {
  for (const [method, path] of PLAYER_PATHS) {
    it(`${method} ${path} 401s a missing bearer db-free, handler never called`, async () => {
      authedDb();
      const r = await runRoute(method, path);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
      expect(r.contentType).toBe('application/json');
      expect(r.reached).toBe(false);
      // A missing bearer 401s before any service read.
      expect(h.db.ensureDay).not.toHaveBeenCalled();
      expect(h.wallet.walletForAccount).not.toHaveBeenCalled();
    });
  }

  it('403s a read-only token { error: "this token is read-only" }', async () => {
    authedDb({ accountAndScopeForToken: async () => ({ accountId: 7, scope: 'read' }) });
    const r = await runRoute('GET', '/api/daily-rewards', { headers: { authorization: BEARER } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(r.reached).toBe(false);
  });

  it('403s a moderation-locked account with the status message', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({
          locked: true,
          message: 'this account is suspended.',
        }),
    });
    const r = await runRoute('POST', '/api/daily-rewards/spin', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The player thin handlers dispatch to the shared core (parity by construction).
// ---------------------------------------------------------------------------

describe('player routes: thin-handler dispatch', () => {
  beforeEach(() => {
    authedDb();
  });

  it('GET /api/daily-rewards answers 200 with the status payload', async () => {
    const r = await runRoute('GET', '/api/daily-rewards', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    // The status payload the shared core builds (no wallet -> a locked, not-eligible view).
    expect(body).toMatchObject({
      prizePoolUsd: 150,
      eligibility: { eligible: false, reason: 'no_wallet' },
      spin: { claimed: false },
    });
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['day', 'resetAt', 'eligibility', 'score', 'leaderboard']),
    );
    // The handler dispatched into the service (which touched the mocked db).
    expect(h.db.ensureDay).toHaveBeenCalled();
    expect(r.reached).toBe(true);
  });

  it('GET leaderboard answers 200 with the page payload and decodes page/pageSize leniently', async () => {
    // ?page=abc&pageSize=xyz coerce to NaN then fall back to 0 / 20 (never a 422).
    const bad = await runRoute('GET', '/api/daily-rewards/leaderboard', {
      url: '/api/daily-rewards/leaderboard?page=abc&pageSize=xyz',
      headers: { authorization: BEARER },
    });
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({
      day: expect.any(String),
      leaders: [],
      page: 0,
      pageSize: 20,
      pageCount: 1,
      total: 0,
    });
    expect(h.db.leaderboardPage).toHaveBeenLastCalledWith(expect.any(String), 0, 20);
    expect(bad.reached).toBe(true);

    // Finite ?page=2&pageSize=50 flow through verbatim.
    await runRoute('GET', '/api/daily-rewards/leaderboard', {
      url: '/api/daily-rewards/leaderboard?page=2&pageSize=50',
      headers: { authorization: BEARER },
    });
    expect(h.db.leaderboardPage).toHaveBeenLastCalledWith(expect.any(String), 2, 50);
  });

  it('POST spin 403s an ineligible wallet with the legacy lock prose', async () => {
    // No linked wallet -> reason no_wallet -> not eligible -> the 403 lock body.
    const r = await runRoute('POST', '/api/daily-rewards/spin', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: 'daily rewards are locked for this wallet' });
    expect(r.reached).toBe(true);
    // Ineligible on no_wallet: the balance read is never reached.
    expect(h.balance.cachedWocBalance).not.toHaveBeenCalled();
  });

  it('POST spin 409s an already-claimed day for an eligible wallet', async () => {
    // Eligible: a live price from the stubbed config, a linked wallet, and a balance over
    // the minimum. Then an existing spin row makes the second spin a 409.
    stubPriceConfig();
    h.state.wallet = { account_id: 7, pubkey: 'Wallet', linked_at: 'now' };
    h.state.balance = 1000; // 1000 * 0.5 = 500 USD >= 20 minimum.
    h.state.spin = { outcomeKey: 's20', points: 20, createdAt: '2026-07-01T00:00:00.000Z' };

    const r = await runRoute('POST', '/api/daily-rewards/spin', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'daily spin already claimed' });
    expect(r.reached).toBe(true);
    // recordSpin is never reached once an existing spin short-circuits.
    expect(h.db.recordSpin).not.toHaveBeenCalled();
  });

  it('GET history answers 200 { payouts: [...] } and decodes the limit leniently', async () => {
    h.state.recentPayouts = [payoutRow(1)];

    // ?limit=abc coerces to NaN then falls back to 30 (never a 422).
    const bad = await runRoute('GET', '/api/daily-rewards/history', {
      url: '/api/daily-rewards/history?limit=abc',
      headers: { authorization: BEARER },
    });
    expect(bad.status).toBe(200);
    expect(bad.body).toEqual({
      payouts: [
        {
          day: '2026-07-01',
          rank: 1,
          name: 'alice',
          points: 100,
          prizePercent: 0.2,
          prizeUsd: 30,
          status: 'pending',
          txSignature: null,
          paidAt: null,
        },
      ],
    });
    expect(h.db.recentPayouts).toHaveBeenLastCalledWith(30);

    // A finite ?limit=5 flows through verbatim.
    await runRoute('GET', '/api/daily-rewards/history', {
      url: '/api/daily-rewards/history?limit=5',
      headers: { authorization: BEARER },
    });
    expect(h.db.recentPayouts).toHaveBeenLastCalledWith(5);

    // No limit param also defaults to 30 (Number(null) -> 0 -> || 30).
    await runRoute('GET', '/api/daily-rewards/history', { headers: { authorization: BEARER } });
    expect(h.db.recentPayouts).toHaveBeenLastCalledWith(30);
  });

  it('POST spin reads NO request body (never attaches a data listener)', async () => {
    // Build a body-less req and spy on its listener registration: a spin that self-read a
    // body would attach a 'data' listener (readBody), inventing 400/413 behavior the
    // legacy arm never had. The ineligible 403 proves the chain still resolves.
    const req = makeReq({
      method: 'POST',
      url: '/api/daily-rewards/spin',
      headers: { authorization: BEARER },
    });
    const onSpy = vi.spyOn(req, 'on');
    const r = await runRoute('POST', '/api/daily-rewards/spin', { req });
    expect(r.status).toBe(403);
    expect(onSpy.mock.calls.some(([event]) => event === 'data')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. The ops routes gate through the REAL fail-closed secret gate.
// ---------------------------------------------------------------------------

describe('ops routes: fail-closed secret gate', () => {
  for (const [method, path] of OPS_PATHS) {
    it(`${method} ${path} 401s when the env secret is UNSET (fail closed), handler never called`, async () => {
      // beforeEach deleted WOC_DAILY_REWARD_SERVICE_SECRET: the gate fails closed with 401,
      // never the other internal gates' feature-off 404.
      const r = await runRoute(method, path, { headers: OPS_HEADERS });
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ success: false, data: null, error: 'not authenticated' });
      expect(r.reached).toBe(false);
    });

    it(`${method} ${path} 401s when the presented secret is WRONG`, async () => {
      process.env[OPS_SECRET_ENV] = OPS_SECRET;
      const r = await runRoute(method, path, { headers: { [OPS_HEADER]: 'wrong' } });
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ success: false, data: null, error: 'not authenticated' });
      expect(r.reached).toBe(false);
    });
  }

  it('runs pending-payouts to a 200 admin envelope on the correct secret', async () => {
    process.env[OPS_SECRET_ENV] = OPS_SECRET;
    h.state.pendingPayouts = [payoutRow(1)];
    const r = await runRoute('POST', '/internal/daily-rewards/pending-payouts', {
      headers: OPS_HEADERS,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { payouts: [payoutRow(1)] },
      error: null,
    });
    expect(r.reached).toBe(true);
    expect(h.db.pendingPayouts).toHaveBeenCalledWith(20);
  });

  it('runs payout-history to a 200 admin envelope on the correct secret', async () => {
    process.env[OPS_SECRET_ENV] = OPS_SECRET;
    h.state.recentPayouts = [payoutRow(2)];
    const r = await runRoute('POST', '/internal/daily-rewards/payout-history', {
      headers: OPS_HEADERS,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { payouts: [payoutRow(2)] },
      error: null,
    });
    expect(r.reached).toBe(true);
    expect(h.db.recentPayouts).toHaveBeenCalledWith(100);
  });

  it('runs leaderboard to a 200 admin envelope, passing an explicit ?day verbatim', async () => {
    process.env[OPS_SECRET_ENV] = OPS_SECRET;
    const r = await runRoute('POST', '/internal/daily-rewards/leaderboard', {
      url: '/internal/daily-rewards/leaderboard?day=2026-07-01&page=1&pageSize=25',
      headers: OPS_HEADERS,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { day: '2026-07-01', leaders: [], page: 1, pageSize: 25, pageCount: 1, total: 0 },
      error: null,
    });
    expect(r.reached).toBe(true);
    // The requested day flows through verbatim (no clock read for an explicit day).
    expect(h.db.leaderboardPage).toHaveBeenLastCalledWith('2026-07-01', 1, 25);
  });
});

// ---------------------------------------------------------------------------
// 5. mark-payout validation, through the real gate + handler chain.
// ---------------------------------------------------------------------------

describe('ops mark-payout validation', () => {
  beforeEach(() => {
    process.env[OPS_SECRET_ENV] = OPS_SECRET;
  });

  it('400s an empty body { } -> invalid payout target', async () => {
    const r = await runRoute('POST', '/internal/daily-rewards/mark-payout', {
      headers: OPS_HEADERS,
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid payout target' });
    expect(h.db.markPayout).not.toHaveBeenCalled();
  });

  it('400s an unknown status -> invalid payout status', async () => {
    const r = await runRoute('POST', '/internal/daily-rewards/mark-payout', {
      headers: OPS_HEADERS,
      body: { day: '2026-07-01', rank: 1, status: 'nope' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid payout status' });
    expect(h.db.markPayout).not.toHaveBeenCalled();
  });

  it('404s when markPayout finds no matching row', async () => {
    h.state.markPayoutOk = false;
    const r = await runRoute('POST', '/internal/daily-rewards/mark-payout', {
      headers: OPS_HEADERS,
      body: { day: '2026-07-01', rank: 1, status: 'paid' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'payout not found' });
    expect(h.db.markPayout).toHaveBeenCalledWith('2026-07-01', 1, 'paid', null, null);
  });

  it('200s { ok: true } when markPayout succeeds', async () => {
    h.state.markPayoutOk = true;
    const r = await runRoute('POST', '/internal/daily-rewards/mark-payout', {
      headers: OPS_HEADERS,
      body: { day: '2026-07-01', rank: 1, status: 'paid', txSignature: 'sig' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(h.db.markPayout).toHaveBeenCalledWith('2026-07-01', 1, 'paid', 'sig', null);
  });
});

// ---------------------------------------------------------------------------
// 6. The body-validation remap deviations (an escaping throw serializes per surface).
// ---------------------------------------------------------------------------

describe('body-validation remap deviations', () => {
  it('ops: a mark-payout body of INVALID JSON 500s the admin envelope (dailyRewardsOpsBodyValidationRemap)', async () => {
    // mark-payout self-reads the body via the core's un-caught readBody. A malformed body
    // rejects there and escapes to withErrors, which serializes the admin 500 envelope.
    // The legacy ladder counterfactual was a HANG (no outer catch).
    process.env[OPS_SECRET_ENV] = OPS_SECRET;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = makeReq({
      method: 'POST',
      url: '/internal/daily-rewards/mark-payout',
      headers: OPS_HEADERS,
      body: '{ not valid json',
    });

    const r = await runRoute('POST', '/internal/daily-rewards/mark-payout', {
      headers: OPS_HEADERS,
      req,
    });

    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, data: null, error: 'internal.error' });
    expect(r.contentType).toBe('application/json');
    expect(r.headers['x-request-id']).toBeDefined();
    expect(h.db.markPayout).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('player: a service throw behind a passing guard 500s problem+json (dailyRewardsBodyValidationRemap)', async () => {
    // The player family carries no envelope override, so an escaping throw defaults to the
    // RFC 9457 problem+json 500. The guard passes; the service read throws.
    authedDb();
    h.state.ensureDayThrows = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await runRoute('GET', '/api/daily-rewards', { headers: { authorization: BEARER } });

    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect((r.body as Record<string, unknown>).code).toBe('internal.error');
    expect(r.headers['x-request-id']).toBeDefined();
    errSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 7. The dailyRewardService singleton (the game.ts contract) is importable and callable
// independent of the route table.
// ---------------------------------------------------------------------------

describe('dailyRewardService singleton', () => {
  it('exports a live DailyRewardService with the game-loop hooks callable', () => {
    expect(dailyRewardService).toBeInstanceOf(DailyRewardService);
    expect(typeof dailyRewardService.recordOnlineMinute).toBe('function');
    expect(typeof dailyRewardService.recordQuestCompletion).toBe('function');
    expect(typeof dailyRewardService.recordArenaResult).toBe('function');
    expect(typeof dailyRewardService.recordDelveClear).toBe('function');
    expect(typeof dailyRewardService.recordDelveChestOpen).toBe('function');
  });
});
