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
import { verifyPassword } from '../../server/auth';
import type { AccountModerationStatus } from '../../server/db';
import {
  accountById,
  consumeWalletChallenge,
  findAccount,
  linkWalletToAccount,
  unlinkWallet,
  walletForAccount,
} from '../../server/db';
import { desktopWalletHandoffs } from '../../server/desktop_wallet_handoff';
import { emailWalletChanged } from '../../server/email';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Method, Middleware } from '../../server/http/types';
import {
  authThrottled,
  recordAuthFailure,
  resetAuthFailures,
  resetRateLimitClock,
  resetWalletHandoffResultRateLimits,
  resetWalletLinkRateLimits,
  setRateLimitClock,
  WALLET_HANDOFF_RESULT_MAX_PER_MINUTE,
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
import {
  WALLET_REAUTH_NO_PASSWORD_ERROR,
  WALLET_REAUTH_REQUIRED_ERROR,
  WALLET_REAUTH_TWO_FACTOR_ERROR,
} from '../../server/wallet_reauth';
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
    createWalletChallenge: vi.fn(async () => {}),
    pruneWalletChallenges: vi.fn(async () => {}),
    consumeWalletChallenge: vi.fn(async () => null),
    linkWalletToAccount: vi.fn(async () => true),
    walletForAccount: vi.fn(),
    unlinkWallet: vi.fn(async () => {}),
    // The R11 re-auth reads plus the wallet-changed mail target.
    accountById: vi.fn(async () => null),
    findAccount: vi.fn(async () => null),
    accountMailTarget: vi.fn(async () => null),
  };
});

// The R11 password arm rides server/auth's scrypt verify; pin it as a switch.
vi.mock('../../server/auth', async (importActual) => {
  const actual = await importActual<typeof import('../../server/auth')>();
  return { ...actual, verifyPassword: vi.fn(async () => false) };
});

// The wallet-changed alert is fire-and-forget; capture instead of sending.
vi.mock('../../server/email', async (importActual) => {
  const actual = await importActual<typeof import('../../server/email')>();
  return { ...actual, emailWalletChanged: vi.fn() };
});

// The unlink outcome metrics are pinned, so capture instead of counting.
vi.mock('../../server/provider_usage', async (importActual) => {
  const actual = await importActual<typeof import('../../server/provider_usage')>();
  return { ...actual, recordUsageMetric: vi.fn() };
});

// Relink re-auth runs AFTER the incoming wallet's signature verifies; pin the
// crypto as a switch so the route tests stay key-free.
vi.mock('../../server/wallet_link', async (importActual) => {
  const actual = await importActual<typeof import('../../server/wallet_link')>();
  return { ...actual, verifySolanaSignature: vi.fn(() => true) };
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
  // Per-test isolation for the module-factory mocks: restoreAllMocks (below)
  // only touches vi.spyOn spies, so without this reset, call history and
  // per-test mockResolvedValue arms leak between tests (mockReset returns each
  // vi.fn to the implementation its factory declared).
  vi.resetAllMocks();
  installRuntime();
});

afterEach(() => {
  resetAuthFailures();
  resetWalletDbForTests();
  resetWalletRuntimeForTests();
  resetWalletLinkRateLimits();
  resetWalletHandoffResultRateLimits();
  desktopWalletHandoffs.clear();
  resetRateLimitClock();
  vi.restoreAllMocks();
});

describe('desktop browser wallet handoff routes', () => {
  const address = 'HCe5EmTL9sq9iAWTx1VfFmthz9gMG9HPs3yNn9MqXSUq';

  it('registers the create, claim, complete, and result operation', () => {
    for (const path of [
      '/api/desktop-wallet/create',
      '/api/desktop-wallet/claim',
      '/api/desktop-wallet/complete',
      '/api/desktop-wallet/result',
    ]) {
      expect(routeFor('POST', path)).toBeDefined();
    }
  });

  it('relays a transaction signature once to the authenticated desktop account', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });
    desktopWalletHandoffs.authorizeTransaction(7, {
      reference: 'CLM_authorized',
      transactionBase64: 'AQID',
      expectedAddress: address,
      rail: 'sol',
      amountBase: '1234',
      destination: 'treasury-wallet',
      expiresAtMs: Date.now() + 60_000,
    });
    const created = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: {
        kind: 'transaction',
        expectedAddress: address,
        reference: 'CLM_authorized',
      },
    });
    expect(created.status).toBe(200);
    const code = String(bodyRecord(created.body).code);

    const claimed = await runRoute('POST', '/api/desktop-wallet/claim', { body: { code } });
    expect(claimed.body).toEqual({
      kind: 'transaction',
      reference: 'CLM_authorized',
      expectedAddress: address,
      transactionBase64: 'AQID',
      rail: 'sol',
      amountBase: '1234',
      destination: 'treasury-wallet',
    });

    const completed = await runRoute('POST', '/api/desktop-wallet/complete', {
      body: { code, kind: 'transaction', address, signature: 'chain-signature' },
    });
    expect(completed.body).toEqual({ completed: true });

    const result = await runRoute('POST', '/api/desktop-wallet/result', {
      headers: { authorization: BEARER },
      body: { code },
    });
    expect(result.body).toEqual({
      status: 'complete',
      result: { kind: 'transaction', address, signature: 'chain-signature' },
    });
    const retried = await runRoute('POST', '/api/desktop-wallet/result', {
      headers: { authorization: BEARER },
      body: { code },
    });
    expect(retried.body).toEqual({
      status: 'complete',
      result: { kind: 'transaction', address, signature: 'chain-signature' },
    });
  });

  it('issues and relays a browser link authorization for the authenticated account', async () => {
    authedDb();
    const created = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: { kind: 'link' },
    });
    expect(created.status).toBe(200);
    const code = String(bodyRecord(created.body).code);

    const address = 'HCe5EmTL9sq9iAWTx1VfFmthz9gMG9HPs3yNn9MqXSUq';
    const claimed = await runRoute('POST', '/api/desktop-wallet/claim', {
      body: { code, address },
    });
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({
      kind: 'link',
      address,
    });
    const challenge = bodyRecord(claimed.body);

    const completed = await runRoute('POST', '/api/desktop-wallet/complete', {
      body: {
        code,
        kind: 'link',
        address,
        nonce: challenge.nonce,
        signature: 'signed-message',
      },
    });
    expect(completed.body).toEqual({ completed: true });

    const result = await runRoute('POST', '/api/desktop-wallet/result', {
      headers: { authorization: BEARER },
      body: { code },
    });
    expect(result.body).toEqual({
      status: 'complete',
      result: {
        kind: 'link',
        address,
        nonce: challenge.nonce,
        signature: 'signed-message',
      },
    });
  });

  it('rejects a transaction handoff for a wallet other than the account link', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });

    const response = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: {
        kind: 'transaction',
        expectedAddress: '11111111111111111111111111111111',
        reference: 'CLM_authorized',
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'wallet does not match the linked account wallet',
      code: 'wallet.handoff_invalid',
    });
  });

  it('rejects renderer-supplied transaction bytes without a server-authorized quote', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });

    const response = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: {
        kind: 'transaction',
        expectedAddress: address,
        transactionBase64: 'AQID',
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'invalid desktop wallet operation',
      code: 'wallet.handoff_invalid',
    });
  });

  it('rejects an unknown completion kind and screens the create shape legs', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });
    // Complete: an unknown kind is refused by the route's own screen, before
    // the store's action-mismatch check can even run.
    const badKind = await runRoute('POST', '/api/desktop-wallet/complete', {
      body: { code: 'x'.repeat(43), kind: 'mystery', address, signature: 'sig' },
    });
    expect(badKind.status).toBe(400);
    expect(badKind.body).toEqual({
      error: 'invalid wallet authorization result',
      code: 'wallet.handoff_invalid',
    });
    // Create: a non-Solana expectedAddress and an over-long reference are
    // each refused at the shape screen (the validShape legs, per dimension).
    const badAddress = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: { kind: 'transaction', expectedAddress: 'not-an-address!', reference: 'CLM_x' },
    });
    expect(badAddress.status).toBe(400);
    expect(badAddress.body).toEqual({
      error: 'invalid desktop wallet operation',
      code: 'wallet.handoff_invalid',
    });
    const longReference = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: { kind: 'transaction', expectedAddress: address, reference: 'r'.repeat(257) },
    });
    expect(longReference.status).toBe(400);
    expect(longReference.body).toEqual({
      error: 'invalid desktop wallet operation',
      code: 'wallet.handoff_invalid',
    });
  });

  it('relays a step-up signature for the authenticated desktop account', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });
    const nonce = 'ab'.repeat(16);
    desktopWalletHandoffs.authorizeStepUp(7, {
      nonce,
      message: 'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
      expectedAddress: address,
      expiresAtMs: Date.now() + 60_000,
    });
    const created = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: { kind: 'stepup', expectedAddress: address, nonce },
    });
    expect(created.status).toBe(200);
    const code = String(bodyRecord(created.body).code);

    // The claim serves the SERVER-stored challenge message, never renderer text.
    const claimed = await runRoute('POST', '/api/desktop-wallet/claim', { body: { code } });
    // The nonce stays server-side: the page signs only the message (which
    // embeds the nonce line), so the claim wire carries nothing else.
    expect(claimed.body).toEqual({
      kind: 'stepup',
      message: 'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
      expectedAddress: address,
    });

    const completed = await runRoute('POST', '/api/desktop-wallet/complete', {
      body: { code, kind: 'stepup', address, signature: 'msg-signature' },
    });
    expect(completed.body).toEqual({ completed: true });

    const result = await runRoute('POST', '/api/desktop-wallet/result', {
      headers: { authorization: BEARER },
      body: { code },
    });
    expect(result.body).toEqual({
      status: 'complete',
      result: { kind: 'stepup', address, signature: 'msg-signature' },
    });
  });

  it('rejects a step-up handoff for a wallet other than the account link', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });
    const response = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: {
        kind: 'stepup',
        expectedAddress: '11111111111111111111111111111111',
        nonce: 'cd'.repeat(16),
      },
    });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'wallet does not match the linked account wallet',
      code: 'wallet.handoff_invalid',
    });
  });

  it('rejects a step-up handoff with a malformed nonce or no issued challenge', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue({
      account_id: 7,
      pubkey: address,
      linked_at: '2026-07-01T00:00:00.000Z',
    });
    // Malformed nonce: refused at shape screening (renderer-supplied message
    // text has no field to ride at all).
    const malformed = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: { kind: 'stepup', expectedAddress: address, nonce: 'nope' },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({
      error: 'invalid desktop wallet operation',
      code: 'wallet.handoff_invalid',
    });
    // Well-formed but never issued: refused by the store.
    const unissued = await runRoute('POST', '/api/desktop-wallet/create', {
      headers: { authorization: BEARER },
      body: { kind: 'stepup', expectedAddress: address, nonce: 'ef'.repeat(16) },
    });
    expect(unissued.status).toBe(400);
    expect(unissued.body).toEqual({
      error: 'step-up is not backed by an issued Exchange challenge',
      code: 'wallet.handoff_invalid',
    });
  });
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

  it('POST /api/desktop-wallet/result limits the (max + 1)th poll', async () => {
    // The 1 Hz handoff poll was the one unmetered arm of the quartet; the cap
    // sits far above two concurrent handoffs so an honest poll never trips.
    authedDb();
    const opts = { headers: { authorization: BEARER }, body: { code: 'x' } };
    for (let i = 0; i < WALLET_HANDOFF_RESULT_MAX_PER_MINUTE; i++) {
      const r = await runRoute('POST', '/api/desktop-wallet/result', opts);
      expect(r.status).toBe(200); // an unknown code still answers { status: 'missing' }
    }
    expectLimited(await runRoute('POST', '/api/desktop-wallet/result', opts));
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

  it('200 no-op when no wallet is linked, never touching unlinkWallet', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(null as never);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unlinked: true });
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  // The R11 arms: with a wallet linked, a bare bearer can no longer remove it.
  const LINKED = {
    account_id: 7,
    pubkey: 'CurrentWallet1111',
    linked_at: '2026-07-01T00:00:00.000Z',
  };
  const ACCT = {
    id: 7,
    username: 'guard',
    password_hash: 'scrypt:x',
    password_set: true,
    email: 'g@x.nz',
    created_at: '2026-01-01',
    deactivated_at: null,
    locale: null,
    marketing_opt_in: false,
  };

  it('401s a bare-bearer unlink with the reauth marker, unlink untouched', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: WALLET_REAUTH_REQUIRED_ERROR, code: 'wallet.reauth_required' });
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
    const { recordUsageMetric } = await import('../../server/provider_usage');
    expect(vi.mocked(recordUsageMetric)).toHaveBeenCalledWith('wallet.unlink.failure');
    expect(vi.mocked(recordUsageMetric)).not.toHaveBeenCalledWith('wallet.unlink.success');
  });

  it('unlinks on the password arm and fires the removed alert', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const target = { id: 7, username: 'guard', email: 'g@x.nz', locale: null };
    const { accountMailTarget } = await import('../../server/db');
    vi.mocked(accountMailTarget).mockResolvedValue(target as never);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'hunter2' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unlinked: true });
    expect(vi.mocked(unlinkWallet)).toHaveBeenCalledWith(7);
    expect(vi.mocked(emailWalletChanged)).toHaveBeenCalledWith(
      target,
      'removed',
      'CurrentWallet1111',
    );
    const { recordUsageMetric } = await import('../../server/provider_usage');
    expect(vi.mocked(recordUsageMetric)).toHaveBeenCalledWith('wallet.unlink.success');
  });

  it('403s the passwordless account at the set-a-password marker', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, password_set: false } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'anything' },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      error: WALLET_REAUTH_NO_PASSWORD_ERROR,
      code: 'wallet.reauth_no_password',
    });
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('a caller-supplied currentSignature can never satisfy unlink (the empty-message bypass)', async () => {
    // Regression pin for the QA-round finding: with no challenge on this path
    // there is nothing sound to verify a signature against, so the route must
    // strip the field entirely; even a verifier armed to accept everything
    // (the module mock returns true) must never be consulted.
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const { verifySolanaSignature } = await import('../../server/wallet_link');
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { currentSignature: 'signature-over-empty-string' },
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: WALLET_REAUTH_REQUIRED_ERROR, code: 'wallet.reauth_required' });
    expect(vi.mocked(verifySolanaSignature)).not.toHaveBeenCalled();
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('the signature+nonce arm is retired on unlink: no challenge is consumed', async () => {
    // A link challenge cannot be action-scoped to a removal, so a re-verify
    // signature must not be spendable here; the arm is password-only now.
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { signature: 'sig58', nonce: 'n1' },
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: WALLET_REAUTH_REQUIRED_ERROR, code: 'wallet.reauth_required' });
    expect(vi.mocked(consumeWalletChallenge)).not.toHaveBeenCalled();
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('an enrolled second factor is demanded at the ROUTE level (no silent downgrade)', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: 'SECRET' } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'hunter2' },
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({
      error: WALLET_REAUTH_TWO_FACTOR_ERROR,
      code: 'wallet.reauth_two_factor',
    });
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('a locked-out account answers 429 before any password check', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'locked1' } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    for (let i = 0; i < 10; i++) recordAuthFailure('locked1');
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'hunter2' },
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      error: 'too many failed attempts, wait a few minutes and try again',
      code: 'auth.too_many_failed_attempts',
    });
    expect(vi.mocked(verifyPassword)).not.toHaveBeenCalled();
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('a wrong password records into the SHARED failed-credential budget', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'budget1' } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const before = authThrottled('budget1').remaining;
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'guess' },
    });
    expect(r.status).toBe(401);
    expect(bodyRecord(r.body).code).toBe('wallet.reauth_bad_password');
    expect(authThrottled('budget1').remaining).toBe(before - 1);
  });

  it('a successful password re-auth clears the failure budget', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'clear1' } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    recordAuthFailure('clear1');
    recordAuthFailure('clear1');
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'hunter2' },
    });
    expect(r.status).toBe(200);
    expect(authThrottled('clear1').remaining).toBe(10);
  });

  it('a findAccount row for a DIFFERENT account id refuses (no silent downgrade)', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 999, totp_secret: null } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'hunter2' },
    });
    expect(r.status).toBe(401);
    expect(vi.mocked(unlinkWallet)).not.toHaveBeenCalled();
  });

  it('the RouteDef arm answers the coded 429 once the wallet-link window drains', async () => {
    authedDb();
    setRateLimitClock(() => FIXED_NOW_MS);
    vi.mocked(walletForAccount).mockResolvedValue(null as never);
    for (let i = 0; i < WALLET_LINK_MAX_PER_MINUTE; i++) {
      const ok = await runRoute('DELETE', '/api/wallet/link', {
        headers: { authorization: BEARER },
        body: {},
      });
      expect(ok.status).toBe(200);
    }
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: {},
    });
    expect(r.status).toBe(429);
    expect(bodyRecord(r.body).code).toBe('rate_limit.exceeded');
  });

  it('both dispatch arms carry the wallet-link rate limit in lockstep', () => {
    // The DELETE route exists twice (the legacy server/main.ts ladder under
    // API_DISPATCH rollback, and the RouteDef). A future edit must not drop
    // the limiter from either arm silently.
    const routeDef = routeFor('DELETE', '/api/wallet/link');
    expect(routeDef.middleware?.length, 'RouteDef arm: guard + rateLimit').toBeGreaterThanOrEqual(
      2,
    );
    // Both anchors must actually be found; the small window between them is
    // then stripped of line AND block comments (whole-file stripping would be
    // confused by comment markers inside unrelated string literals), so a
    // comment mentioning the limiter can never satisfy the pin; and the match
    // requires the GATED form: the outcome must decide the branch, not just a
    // call whose result is dropped.
    const ladder = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
    const anchor = ladder.indexOf("req.method === 'DELETE' && url === '/api/wallet/link'");
    expect(anchor).toBeGreaterThanOrEqual(0);
    const arm = ladder.slice(anchor);
    const handlerAt = arm.indexOf('handleWalletUnlink');
    expect(handlerAt).toBeGreaterThanOrEqual(0);
    const window = arm
      .slice(0, handlerAt)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(
      window,
      'legacy arm: the limiter outcome gates the branch before handleWalletUnlink',
    ).toContain('if (!walletLinkRateLimited(');
  });
});

describe('POST /api/wallet/link relink re-auth (R11)', () => {
  // Real 32-byte base58 keys: the link route runs the REAL isSolanaAddress
  // (base58-decode, exactly 32 bytes), so placeholder strings 400 before the
  // re-auth logic is ever reached.
  const CURRENT_ADDR = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';
  const NEW_ADDR = 'cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN';
  const CURRENT = {
    account_id: 7,
    pubkey: CURRENT_ADDR,
    linked_at: '2026-07-01T00:00:00.000Z',
  };
  const ACCT = {
    id: 7,
    username: 'guard',
    password_hash: 'scrypt:x',
    password_set: true,
    email: 'g@x.nz',
    created_at: '2026-01-01',
    deactivated_at: null,
    locale: null,
    marketing_opt_in: false,
  };
  const LINK_BODY = { address: NEW_ADDR, signature: 'sig58', nonce: 'n1' };
  const LINKED_FOR_BUDGET = {
    account_id: 7,
    pubkey: CURRENT_ADDR,
    linked_at: '2026-07-01T00:00:00.000Z',
  };

  function armChallenge(): void {
    vi.mocked(consumeWalletChallenge).mockResolvedValue({
      address: NEW_ADDR,
      message: 'LINK MSG',
    } as never);
  }

  it('a first link needs no re-auth and fires the linked alert', async () => {
    authedDb();
    armChallenge();
    vi.mocked(walletForAccount).mockResolvedValue(null as never);
    const target = { id: 7, username: 'guard', email: 'g@x.nz', locale: null };
    const { accountMailTarget } = await import('../../server/db');
    vi.mocked(accountMailTarget).mockResolvedValue(target as never);
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: LINK_BODY,
    });
    expect(r.status).toBe(200);
    expect(vi.mocked(linkWalletToAccount)).toHaveBeenCalledWith(7, NEW_ADDR);
    expect(vi.mocked(emailWalletChanged)).toHaveBeenCalledWith(target, 'linked', NEW_ADDR);
  });

  it('relinking to a DIFFERENT wallet without proof 401s at the reauth marker', async () => {
    authedDb();
    armChallenge();
    vi.mocked(walletForAccount).mockResolvedValue(CURRENT as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: LINK_BODY,
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: WALLET_REAUTH_REQUIRED_ERROR, code: 'wallet.reauth_required' });
    expect(vi.mocked(linkWalletToAccount)).not.toHaveBeenCalled();
  });

  it('relinking with the password arm links and fires the changed alert', async () => {
    authedDb();
    armChallenge();
    vi.mocked(walletForAccount).mockResolvedValue(CURRENT as never);
    vi.mocked(accountById).mockResolvedValue(ACCT as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const target = { id: 7, username: 'guard', email: 'g@x.nz', locale: null };
    const { accountMailTarget } = await import('../../server/db');
    vi.mocked(accountMailTarget).mockResolvedValue(target as never);
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { ...LINK_BODY, password: 'hunter2' },
    });
    expect(r.status).toBe(200);
    expect(vi.mocked(linkWalletToAccount)).toHaveBeenCalledWith(7, NEW_ADDR);
    expect(vi.mocked(emailWalletChanged)).toHaveBeenCalledWith(target, 'changed', NEW_ADDR);
  });

  it('a bad co-signature does NOT record into the failed-credential budget', async () => {
    // The budget records CREDENTIAL failures only; widening the record
    // condition to any refusal would let a bearer holder lock the account
    // out of LOGIN with free non-credential refusals.
    authedDb();
    armChallenge();
    vi.mocked(walletForAccount).mockResolvedValue(CURRENT as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'sigbudget' } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    const { verifySolanaSignature } = await import('../../server/wallet_link');
    vi.mocked(verifySolanaSignature).mockReturnValueOnce(true).mockReturnValueOnce(false);
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { ...LINK_BODY, currentSignature: 'forged' },
    });
    expect(r.status).toBe(401);
    expect(bodyRecord(r.body).code).toBe('wallet.reauth_bad_signature');
    expect(authThrottled('sigbudget').remaining).toBe(10);
  });

  it('a wrong second factor DOES record into the failed-credential budget', async () => {
    authedDb();
    vi.mocked(walletForAccount).mockResolvedValue(LINKED_FOR_BUDGET as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'totpbudget' } as never);
    vi.mocked(findAccount).mockResolvedValue({
      id: 7,
      totp_secret: 'JBSWY3DPEHPK3PXP',
      totp_last_window: null,
    } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    const r = await runRoute('DELETE', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { password: 'hunter2', totp: '000000' },
    });
    expect(r.status).toBe(401);
    expect(bodyRecord(r.body).code).toBe('wallet.reauth_bad_two_factor');
    expect(authThrottled('totpbudget').remaining).toBe(9);
  });

  it("a co-signature success does NOT clear another proof arm's guess budget", async () => {
    authedDb();
    armChallenge();
    vi.mocked(walletForAccount).mockResolvedValue(CURRENT as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'sigclear' } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    recordAuthFailure('sigclear');
    recordAuthFailure('sigclear');
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { ...LINK_BODY, currentSignature: 'goodsig' },
    });
    expect(r.status).toBe(200);
    expect(authThrottled('sigclear').remaining).toBe(8);
  });

  it('a locked-out account answers 429 on the RELINK path too (the shared wrap)', async () => {
    authedDb();
    armChallenge();
    vi.mocked(walletForAccount).mockResolvedValue(CURRENT as never);
    vi.mocked(accountById).mockResolvedValue({ ...ACCT, username: 'locked2' } as never);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, totp_secret: null } as never);
    for (let i = 0; i < 10; i++) recordAuthFailure('locked2');
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { ...LINK_BODY, password: 'hunter2' },
    });
    expect(r.status).toBe(429);
    expect(bodyRecord(r.body).code).toBe('auth.too_many_failed_attempts');
    expect(vi.mocked(linkWalletToAccount)).not.toHaveBeenCalled();
  });

  it('relinking the SAME wallet needs no re-auth (no custody change)', async () => {
    authedDb();
    vi.mocked(consumeWalletChallenge).mockResolvedValue({
      address: CURRENT_ADDR,
      message: 'LINK MSG',
    } as never);
    vi.mocked(walletForAccount).mockResolvedValue(CURRENT as never);
    const r = await runRoute('POST', '/api/wallet/link', {
      headers: { authorization: BEARER },
      body: { ...LINK_BODY, address: CURRENT_ADDR },
    });
    expect(r.status).toBe(200);
    expect(vi.mocked(linkWalletToAccount)).toHaveBeenCalledWith(7, CURRENT_ADDR);
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
