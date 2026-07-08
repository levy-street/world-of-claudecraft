// Unit coverage for the wallet-link route family (server/wallet.ts).
//
// The migrated routes preserve their LEGACY { error } bodies byte-for-byte (RFC 9457
// is the client code-matcher), so every assertion pins the exact legacy status + body. This slice
// exercises the wallet LINK family (POST /api/wallet/link/challenge, POST /api/wallet/link,
// DELETE /api/wallet/link, GET /api/wallet) and its NEW wiring:
//  - the module-private activeGuard (mirrors bearerActiveAccount: full-session, read-only
//    403, moderation 403), driven alone through the real compose() onion so its
//    short-circuit + moderation gate are pinned, plus a db-free no-token 401;
//  - the walletChallengeCore / walletLinkCore split reached through the full route chain
//    (guard -> rateLimit -> handler -> core) on their db-free 400 branches, so the ported
//    core bytes are unchanged;
//  - the rateLimitedBodyToCode known deviation: the wallet-link limiter is now a
//    rateLimit(WALLET_LINK_POLICY) middleware that emits a CODED problem+json 429 (vs the
//    legacy { error: 'rate limited' } prose that stays on the untouched legacy handler);
//  - the composition order: the fused ip+account limiter mounts AFTER activeGuard, so an
//    unauthenticated request 401s at the guard and the limiter (which would 500 on the
//    missing account) never runs.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// wallet.ts imports it, so set a dummy URL. The pool never connects: the guard reads are
// fakes supplied via setWalletDbForTests, the runtime is a fake injected via
// configureWalletRuntime, and every asserted core branch is db-free.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase14_units';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountModerationStatus } from '../../server/db';
import { unlinkWallet, walletForAccount } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Method, Middleware } from '../../server/http/types';
import {
  resetRateLimitClock,
  resetWalletLinkRateLimits,
  setRateLimitClock,
  WALLET_LINK_MAX_PER_MINUTE,
} from '../../server/ratelimit';
import {
  configureWalletRuntime,
  resetWalletDbForTests,
  resetWalletRuntimeForTests,
  routes,
  setWalletDbForTests,
  type WalletGameHooks,
} from '../../server/wallet';
import { type FakeRes, fakeCtx, stableStringify } from './helpers';

// The GET /api/wallet + DELETE /api/wallet/link handlers self-read walletForAccount /
// unlinkWallet off db.ts directly (not through the wallet.ts guard seam), so mock those two
// exports to drive the authed happy paths db-free. The ...actual spread keeps every other db
// export real; the guard's bearer/moderation reads come through the setWalletDbForTests seam,
// so they are unaffected by this mock.
vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return {
    ...actual,
    walletForAccount: vi.fn(),
    unlinkWallet: vi.fn(async () => {}),
  };
});

// A well-formed bearer header (64 lowercase-hex, matching wallet.ts BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// A frozen instant for the pinned limiter clock: every recorded token shares it, so all
// attempts sit inside the one 60s window and the counter is deterministic across calls.
const FIXED_NOW_MS = 1_700_000_000_000;

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

/** Install a fake wallet runtime (the link family never reads it; install for safety). */
function installRuntime(overrides: Partial<WalletGameHooks> = {}): WalletGameHooks {
  const rt: WalletGameHooks = {
    liveLevelForCharacter: () => null,
    ...overrides,
  };
  configureWalletRuntime(rt);
  return rt;
}

/** Seed the guard db (bearer + moderation) with a full, non-locked account. */
function authedDb(overrides: DbOverrides = {}): void {
  setWalletDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

/** Read status/body/raw-body/content-type off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
} {
  const fake = res as unknown as FakeRes;
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    raw: fake.body,
    contentType: fake.headers['content-type'] as string | undefined,
  };
}

/** Narrow an unknown captured body to a record for a keyed dereference. */
function bodyRecord(body: unknown): Record<string, unknown> {
  return body as Record<string, unknown>;
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** The composed guard, pulled off its route so it can be driven in isolation. */
const activeGuard = routeFor('GET', '/api/wallet').middleware?.[0] as Middleware;

/** Drive a middleware stack + a terminal that records whether the chain proceeded. */
async function runChain(stack: Middleware[], ctx: Ctx) {
  let reached = false;
  await compose([
    ...stack,
    async () => {
      reached = true;
    },
  ])(ctx);
  return { reached, ctx, ...readRes(ctx.res) };
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

/** Load a characterization golden (status + raw body string) by its main-surface name. */
function fixture(name: string): { status: number; body: string } {
  const url = new URL(`./fixtures/main/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

beforeEach(() => {
  installRuntime();
});

afterEach(() => {
  resetWalletDbForTests();
  resetWalletRuntimeForTests();
  resetWalletLinkRateLimits();
  resetRateLimitClock();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// activeGuard (mirrors bearerActiveAccount), driven alone through the onion.
// ---------------------------------------------------------------------------

describe('activeGuard', () => {
  it('401s a missing Authorization header with NO db read', async () => {
    const accountAndScopeForToken = vi.fn(scopeOf('full'));
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setWalletDbForTests({ accountAndScopeForToken, moderationStatusForAccount });

    const r = await runChain([activeGuard], fakeCtx({}));
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    // A missing/bad-shape bearer 401s before any db call (so the no-auth golden replays
    // DB-free through both dispatch paths).
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('401s an unknown token (accountAndScopeForToken -> null) without a moderation read', async () => {
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setWalletDbForTests({
      accountAndScopeForToken: async () => null,
      moderationStatusForAccount,
    });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('403s a read-only token before the moderation read', async () => {
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setWalletDbForTests({ accountAndScopeForToken: scopeOf('read'), moderationStatusForAccount });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 403 });
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    // The read-only rejection precedes the moderation gate.
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('403s a moderation-locked account with the status message', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'Your account is suspended.' }),
    });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 403 });
    expect(r.body).toEqual({ error: 'Your account is suspended.', code: 'moderation.suspended' });
  });

  it('proceeds and stashes ctx.account for a full, non-locked token', async () => {
    authedDb();
    const ctx = fakeCtx({ headers: { authorization: BEARER } });
    const r = await runChain([activeGuard], ctx);
    expect(r.reached).toBe(true);
    expect(ctx.account).toEqual({ accountId: 7, scope: 'full' });
  });
});

// ---------------------------------------------------------------------------
// A representative full guard-rejection chain, byte-identical to its golden.
// ---------------------------------------------------------------------------

describe('full route chain: no-auth 401 (byte-identical to the golden)', () => {
  it('GET /api/wallet with no bearer is 401 { error: "not authenticated" }', async () => {
    const r = await runRoute('GET', '/api/wallet');
    const fx = fixture('wallet_get_noauth_401');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.contentType).toBe('application/json');
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The *Core split, reached through the full route chain on the db-free 400 branch.
// Only the ported core produces these exact bodies, so a 400 here proves the guard
// passed AND the core ran unchanged, without any db read.
// ---------------------------------------------------------------------------

describe('wallet core reached, unchanged (db-free)', () => {
  it('POST /api/wallet/link/challenge with a junk address 400s (walletChallengeCore ran)', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/wallet/link/challenge', {
      headers: { authorization: BEARER },
      body: { address: 'not-a-real-solana-address' },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'invalid Solana wallet address' });
  });

  it('POST /api/wallet/link with an empty body 400s (walletLinkCore db-free branch)', async () => {
    authedDb();
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'address, signature, and nonce are required' });
  });
});

// ---------------------------------------------------------------------------
// The walletBodyValidationRemap known deviation: walletChallengeCore / walletLinkCore
// self-read the body with readBody (no withBody), so a malformed / over-cap / null body
// throws inside readBody and surfaces as 500 application/problem+json (internal.error)
// through the shared withErrors boundary, vs the legacy handleApi outer-catch 500
// { error: 'internal error' } (same 500 STATUS, different body shape, NO 400/413 remap
// because there is no withBody). Sibling to accountBodyValidationRemap.
// ---------------------------------------------------------------------------

describe('wallet body-read 500 remap (walletBodyValidationRemap deviation)', () => {
  it('POST /api/wallet/link/challenge with a malformed body is 500 problem+json (internal.error)', async () => {
    authedDb();
    // The guard passes and walletChallengeCore self-reads the raw stream; readBody rejects
    // 'bad json', the throw propagates past the limiter to withErrors, which serializes the
    // coded internal.error as application/problem+json (not the handler's plain json()).
    const r = await runRoute('POST', '/api/wallet/link/challenge', {
      headers: { authorization: BEARER },
      body: '{ not valid json',
    });
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });
});

// ---------------------------------------------------------------------------
// The rateLimitedBodyToCode known deviation: on the new path the wallet-link limiter is
// a rateLimit(WALLET_LINK_POLICY) middleware that throws HttpError(429,
// 'rate_limit.exceeded'), serialized as a CODED application/problem+json 429 by the
// withErrors boundary. The legacy arms keep their prose { error: 'rate limited' } body for
// the flag-off rollback. Each drained call returns a db-free 400 while the limiter records
// one token; the (WALLET_LINK_MAX_PER_MINUTE + 1)th call is limited.
// ---------------------------------------------------------------------------

describe('coded 429 (rateLimitedBodyToCode deviation)', () => {
  /** Assert the given (over-cap) result is the limiter's problem+json 429. */
  function expectLimited(r: {
    status: number;
    body: unknown;
    contentType: string | undefined;
  }): void {
    expect(r.status).toBe(429);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('rate_limit.exceeded');
  }

  beforeEach(() => {
    // Pin the clock so every recorded token shares one window; reset the bucket so the
    // count starts at zero regardless of test order.
    setRateLimitClock(() => FIXED_NOW_MS);
    resetWalletLinkRateLimits();
  });

  it('POST /api/wallet/link/challenge limits the (max + 1)th attempt', async () => {
    authedDb();
    const opts = {
      headers: { authorization: BEARER },
      body: { address: 'not-a-real-solana-address' },
    };
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      const r = await runRoute('POST', '/api/wallet/link/challenge', opts);
      expect(r.status).toBe(400); // an allowed attempt still runs the db-free core
    }
    expectLimited(await runRoute('POST', '/api/wallet/link/challenge', opts));
  });

  it('POST /api/wallet/link limits the (max + 1)th attempt', async () => {
    authedDb();
    const opts = { headers: { authorization: BEARER }, body: {} };
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      const r = await runRoute('POST', '/api/wallet/link', opts);
      expect(r.status).toBe(400); // an allowed attempt still runs the db-free core
    }
    expectLimited(await runRoute('POST', '/api/wallet/link', opts));
  });
});

// ---------------------------------------------------------------------------
// Composition order: the fused ip+account limiter mounts AFTER activeGuard. Draining the
// wallet-link bucket to its cap and THEN issuing an UNauthenticated request proves the
// guard short-circuits first: the request 401s (not 429, not 500). If the limiter ran
// before the guard, its policy would evaluate ctxAccountId(ctx) on the missing account and
// throw HttpError(500) (a 500), never reaching a 429 or the 401. The 401 is the proof the
// ip+account limiter never runs on an unauthenticated request.
// ---------------------------------------------------------------------------

describe('limiter order (ip+account limiter mounts after activeGuard)', () => {
  beforeEach(() => {
    setRateLimitClock(() => FIXED_NOW_MS);
    resetWalletLinkRateLimits();
  });

  it('an unauthenticated challenge 401s even with the bucket drained to its cap', async () => {
    authedDb();
    const authed = {
      headers: { authorization: BEARER },
      body: { address: 'not-a-real-solana-address' },
    };
    // Drain the wallet-link bucket to its cap via authed calls (same IP 127.0.0.1).
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      const r = await runRoute('POST', '/api/wallet/link/challenge', authed);
      expect(r.status).toBe(400);
    }
    // No Authorization header: activeGuard rejects before the rateLimit middleware runs.
    const unauth = await runRoute('POST', '/api/wallet/link/challenge');
    expect(unauth).toMatchObject({ reached: false, status: 401 });
    expect(unauth.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(unauth.status).not.toBe(429);
    expect(unauth.status).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// The two [activeGuard]-only routes (DELETE /api/wallet/link, GET /api/wallet), driven
// through the FULL migrated chain (guard -> handler) on their authed happy paths. DELETE
// /api/wallet/link is otherwise only checked for RESOLUTION by completeness.test.ts; these
// pin that the ported thin handlers wire [activeGuard] to the unchanged domain functions
// (handleWalletUnlink / handleWalletGet) and pass the legacy 200 bodies through
// byte-for-byte, with the guard account (7) threaded via ctxAccountId. The db reads are the
// mocked unlinkWallet / walletForAccount; the guard seam supplies the bearer/moderation
// fakes, so the whole chain stays db-free.
// ---------------------------------------------------------------------------

describe('DELETE /api/wallet/link (migrated chain)', () => {
  it('401s a no-bearer request at the shared activeGuard, never reaching the handler', async () => {
    const r = await runRoute('DELETE', '/api/wallet/link');
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(r.contentType).toBe('application/json');
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('200 { unlinked: true } for a full bearer, unlinking the guard account', async () => {
    authedDb();
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unlinked: true });
    expect(r.contentType).toBe('application/json');
    // ctx.account (account 7) threads through walletUnlinkHandler -> handleWalletUnlink.
    expect(vi.mocked(unlinkWallet)).toHaveBeenCalledWith(7);
  });
});

describe('GET /api/wallet authed happy path (migrated chain)', () => {
  it('200 { wallet: { pubkey, linkedAt } } for a linked account', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: 'SoLaNaAddr111',
      linked_at: '2026-07-01T00:00:00.000Z',
    });
    const r = await runRoute('GET', '/api/wallet', { headers: { authorization: BEARER } });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    // handleWalletGet maps the db row's linked_at to the legacy { wallet: { pubkey, linkedAt } }.
    expect(r.body).toEqual({
      wallet: { pubkey: 'SoLaNaAddr111', linkedAt: '2026-07-01T00:00:00.000Z' },
    });
    expect(r.contentType).toBe('application/json');
    expect(vi.mocked(walletForAccount)).toHaveBeenCalledWith(7);
  });

  it('200 { wallet: null } for an account with no linked wallet', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(null);
    const r = await runRoute('GET', '/api/wallet', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ wallet: null });
  });
});
