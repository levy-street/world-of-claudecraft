// Unit coverage for the WOC balance proxy + referrals route layer
// (server/wallet.ts).
//
// The wallet migration ported the public $WOC balance proxy and the referrals route
// onto RouteDefs and gave four previously-raw { error: 'rate limited' } 429s a stable
// machine code. This file exercises that NEW wiring on the two routes this slice
// owns, preserving the LEGACY bodies byte-for-byte (RFC 9457 is the client code-matcher):
//  - GET /api/woc/balance is PUBLIC (on-chain balances are public), so it carries
//    NO activeGuard, only rateLimit(WOC_BALANCE_POLICY): an unauthenticated request
//    reaches the handler (200), never a 401, and the 21st request in a window is a
//    coded 429 application/problem+json (the rateLimitedBodyToCode deviation);
//  - GET /api/referrals is guarded by the shared activeGuard + referralsHandler,
//    which Promise.all([referralCountForAccount, primarySlugForAccount]) into a
//    { count, slug } 200 (byte-identical to the legacy inline arm), and 401s a
//    no-bearer request byte-identical to its characterization golden;
//  - 'rate_limit.exceeded' is ALREADY a registered ErrorCode (this migration reused it
//    and appended nothing to the catalog).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// wallet.ts imports it, so set a dummy URL. The pool never connects: the referrals
// db reads are mocked, the guard reads come through the setWalletDbForTests seam, and
// the woc handler is stubbed so the happy path never touches the Solana RPC.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase14_units';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountModerationStatus } from '../../server/db';
import { compose } from '../../server/http/compose';
import { ERROR_CODES } from '../../server/http/error_codes';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  resetRateLimitClock,
  resetWocBalanceRateLimits,
  setRateLimitClock,
  WOC_BALANCE_MAX_PER_MINUTE,
} from '../../server/ratelimit';
import { resetWalletDbForTests, routes, setWalletDbForTests } from '../../server/wallet';
import { type FakeRes, fakeCtx, stableStringify } from './helpers';

// Keep the woc happy path db-free: stub handleWocBalance so it writes a 200 without
// the Solana RPC (parseWocBalanceQuery stays real via the ...actual spread, so the
// handler's query parse is unchanged). wallet.ts imports handleWocBalance from
// './woc_balance', so the mock takes effect. The mock is per-file (Vitest isolates
// modules per file), so no other suite is affected.
vi.mock('../../server/woc_balance', async (importActual) => {
  const actual = await importActual<typeof import('../../server/woc_balance')>();
  return {
    ...actual,
    handleWocBalance: async (res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stub: true }));
    },
  };
});

// The referralsHandler self-reads referralCountForAccount + primarySlugForAccount off
// db.ts directly (not through the wallet.ts guard seam), so mock those two exports.
// The ...actual spread keeps every other db export real; the guard's bearer/moderation
// reads come through the setWalletDbForTests seam, so they are unaffected by this mock.
vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return {
    ...actual,
    referralCountForAccount: vi.fn(async () => 3),
    primarySlugForAccount: vi.fn(async () => 'abc'),
  };
});

// A well-formed bearer header (64 lowercase-hex, matching wallet.ts BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;

type DbOverrides = Parameters<typeof setWalletDbForTests>[0];

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/account.test.ts).
// ---------------------------------------------------------------------------

/** A not-locked moderation status (the AccountModerationStatus happy-path shape). */
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

/** A fake accountAndScopeForToken resolving to account 7 with the given scope. */
function scopeOf(scope: 'read' | 'full') {
  return async () => ({ accountId: 7, scope });
}

/** Read status/body/raw-body/content-type/retry-after off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
  retryAfter: string | number | string[] | undefined;
} {
  const fake = res as unknown as FakeRes;
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    raw: fake.body,
    contentType: fake.headers['content-type'] as string | undefined,
    retryAfter: fake.headers['retry-after'],
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** The shared active guard, pulled off a guarded route so its identity can be compared. */
const activeGuard = routeFor('GET', '/api/wallet').middleware?.[0] as Middleware;

/** Seed the guard db bundle (bearer + moderation) for a full route chain. */
function authedDb(overrides: DbOverrides = {}): void {
  setWalletDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

/** Load a characterization golden (status + raw body string) by its main-surface name. */
function fixture(name: string): { status: number; body: string } {
  const url = new URL(`./fixtures/main/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

/** Drive a full route chain (its real middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({ method, url: path, headers: opts.headers, body: opts.body });
  const stack: Middleware[] = [
    withErrors({ surface: 'problem+json' }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

beforeEach(() => {
  // Pin the limiter clock so every attempt lands in one window (no real timers), and
  // start each test with an empty woc bucket.
  setRateLimitClock(() => 1_000_000);
  resetWocBalanceRateLimits();
});

afterEach(() => {
  resetWalletDbForTests();
  resetWocBalanceRateLimits();
  resetRateLimitClock();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Route table wiring: the public woc route vs the guarded referrals route.
// ---------------------------------------------------------------------------

describe('woc + referrals route table', () => {
  it('registers GET /api/woc/balance and GET /api/referrals on the api surface', () => {
    for (const path of ['/api/woc/balance', '/api/referrals']) {
      const route = routeFor('GET', path);
      expect(route.surface).toBe('api');
      expect(typeof route.handler).toBe('function');
    }
  });

  it('leaves /api/woc/balance PUBLIC: one middleware, NOT the shared activeGuard', () => {
    const woc = routeFor('GET', '/api/woc/balance');
    expect(woc.middleware).toHaveLength(1);
    // The sole middleware is the IP rate-limit gate, never the bearer guard, so the
    // route stays reachable without authentication.
    expect(woc.middleware?.[0]).not.toBe(activeGuard);
  });

  it('gates /api/referrals with the shared activeGuard', () => {
    const referrals = routeFor('GET', '/api/referrals');
    expect(referrals.middleware).toHaveLength(1);
    expect(referrals.middleware?.[0]).toBe(activeGuard);
  });
});

// ---------------------------------------------------------------------------
// GET /api/woc/balance: public (no auth) + IP rate-limited (coded 429).
// ---------------------------------------------------------------------------

describe('GET /api/woc/balance (public, IP rate-limited)', () => {
  it('serves an unauthenticated request 200 via the handler (no activeGuard, so no 401)', async () => {
    // No Authorization header: were an activeGuard mounted, this would 401 before the
    // handler. Instead the handler runs and the stub answers 200 (proving PUBLIC).
    const r = await runRoute('GET', '/api/woc/balance');
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ stub: true });
  });

  it('codes the 21st request 429 application/problem+json rate_limit.exceeded (with Retry-After)', async () => {
    // Drain the whole per-minute allowance: each unauthenticated GET hits the stub 200
    // while the limiter records the attempt (all within the pinned window).
    for (let i = 0; i < WOC_BALANCE_MAX_PER_MINUTE; i++) {
      const r = await runRoute('GET', '/api/woc/balance');
      expect(r.status).toBe(200);
    }
    // The next attempt tips over the cap: rateLimit(WOC_BALANCE_POLICY) throws
    // HttpError(429, 'rate_limit.exceeded', { retryAfterSeconds: 60 }), serialized as
    // RFC 9457 problem+json by the withErrors boundary (the rateLimitedBodyToCode
    // deviation vs the legacy prose { error: 'rate limited' }).
    const limited = await runRoute('GET', '/api/woc/balance');
    expect(limited.reached).toBe(false);
    expect(limited.status).toBe(429);
    expect(limited.contentType).toBe('application/problem+json');
    const body = limited.body as Record<string, unknown>;
    expect(body.code).toBe('rate_limit.exceeded');
    // The coded 429's retryAfterSeconds is the limiter outcome's resetSeconds (the two-tier
    // limiter made it the accurate per-request value); at a freshly-drained window that is the
    // full 60s (the shared sliding-window size), and the Retry-After header mirrors it,
    // so the client can honor it.
    expect(body.retryAfterSeconds).toBe(60);
    expect(limited.retryAfter).toBe('60');
  });
});

// ---------------------------------------------------------------------------
// GET /api/referrals: the shared activeGuard + referralsHandler.
// ---------------------------------------------------------------------------

describe('GET /api/referrals (activeGuard)', () => {
  it('401s a request with no bearer, byte-identical to the golden fixture', async () => {
    const r = await runRoute('GET', '/api/referrals');
    const fx = fixture('referrals_get_noauth_401');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.contentType).toBe('application/json');
    // A missing bearer short-circuits at the guard: the handler never runs.
    expect(r.reached).toBe(false);
  });

  it('200s { count, slug } for a full bearer + passing guard seam', async () => {
    // The guard seam resolves the bearer to a full, non-locked account; the referrals
    // db reads are the mocked referralCountForAccount -> 3 and primarySlugForAccount ->
    // 'abc', so referralsHandler serializes the exact legacy { count, slug } shape.
    authedDb();
    const r = await runRoute('GET', '/api/referrals', { headers: { authorization: BEARER } });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.contentType).toBe('application/json');
    expect(r.body).toEqual({ count: 3, slug: 'abc' });
  });
});

// ---------------------------------------------------------------------------
// The stable code this migration reused (no catalog append).
// ---------------------------------------------------------------------------

describe('rate_limit.exceeded stable code (no catalog append)', () => {
  it('is already a registered ErrorCode with a retryAfterSeconds param', () => {
    // The coded 429 the woc/wallet/card limiters throw reuses this existing code; the
    // migration appended nothing to the catalog. Its single param is the Retry-After source.
    expect('rate_limit.exceeded' in ERROR_CODES).toBe(true);
    expect(ERROR_CODES['rate_limit.exceeded'].params).toEqual(['retryAfterSeconds']);
  });
});
