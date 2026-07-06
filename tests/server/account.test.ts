// Unit coverage for the account-portal route layer (server/account.ts).
//
// The migrated routes preserve their LEGACY { error } / success bodies byte-for-byte
// (RFC 9457 is the client code-matcher), so every assertion pins the exact legacy status +
// body. The account handlers self-read their body and delegate to the existing handleAccount*
// domain functions (already covered end-to-end by tests/account_server.test.ts via a
// pg-mock), so this file exercises the NEW wiring:
//  - the two per-route auth guards (activeGuard / logoutGuard), driven through the real
//    compose() onion so their short-circuit + moderation gate are pinned, incl. the
//    logout property that a moderation-locked account can still sign out;
//  - the companion-token create/list/revoke handlers (they DO use the account.ts db
//    seam), driven directly with a fakeCtx + a fake db bundle;
//  - the two token-in-query link handlers (email/verify + email/unsubscribe) on their
//    db-free no-token path, asserted byte-identical to their characterization goldens;
//  - the companion-token method-fan: an unsupported method now resolves 405 + Allow via
//    the registry (the companionTokenMethodFan known deviation).
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// account.ts imports it, so set a dummy URL. The pool never connects: every db read
// under test is a fake supplied via setAccountDbForTests, and the deactivate runtime is
// a fake injected via configureAccountRuntime.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase13_units';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AccountGameHooks,
  configureAccountRuntime,
  resetAccountDbForTests,
  resetAccountRuntimeForTests,
  routes,
  setAccountDbForTests,
} from '../../server/account';
import { verifyPassword } from '../../server/auth';
import {
  type AccountModerationStatus,
  accountById,
  type CompanionTokenRow,
  listCharacters,
  revokeTokensExcept,
  setAccountDeactivated,
} from '../../server/db';
import { emailAccountDeleted } from '../../server/email';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Ctx, Method, Middleware } from '../../server/http/types';
import { type FakeRes, fakeCtx, stableStringify } from './helpers';

// The deactivate handler self-drives db/auth/email reads (accountById, verifyPassword,
// listCharacters, setAccountDeactivated, revokeTokensExcept, emailAccountDeleted) that
// are NOT part of the account.ts guard/companion seam, so mock those specific exports to
// reach the injected AccountGameHooks without Postgres. The `...actual` spread keeps every
// other export real, so the seam tests (setAccountDbForTests) and the companion tests
// (which use the real newToken) are unaffected; the mock is per-file (never leaks to the
// auth/character suites).
vi.mock('../../server/db', async (importActual) => {
  const actual = await importActual<typeof import('../../server/db')>();
  return {
    ...actual,
    accountById: vi.fn(actual.accountById),
    listCharacters: vi.fn(actual.listCharacters),
    setAccountDeactivated: vi.fn(actual.setAccountDeactivated),
    revokeTokensExcept: vi.fn(actual.revokeTokensExcept),
  };
});
vi.mock('../../server/auth', async (importActual) => {
  const actual = await importActual<typeof import('../../server/auth')>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});
vi.mock('../../server/email', async (importActual) => {
  const actual = await importActual<typeof import('../../server/email')>();
  return { ...actual, emailAccountDeleted: vi.fn() };
});

// A well-formed bearer header (64 lowercase-hex, matching account.ts BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
const COMPANION_PATH = '/api/account/companion-token';
// The companion TTL the create handler passes through (mirrors account.ts: 90 days).
const COMPANION_TTL_HOURS = 24 * 90;

type DbOverrides = Parameters<typeof setAccountDbForTests>[0];

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/characters.test.ts).
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

/** A companion-token row stand-in (the list handler just echoes the array). */
function tokenRow(overrides: Partial<CompanionTokenRow> = {}): CompanionTokenRow {
  return {
    prefix: 'abcd1234',
    label: 'phone',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A no-op injected runtime; the deactivate hooks are stubbed. */
function installRuntime(overrides: Partial<AccountGameHooks> = {}): AccountGameHooks {
  const rt: AccountGameHooks = {
    anyCharacterOnline: () => false,
    disconnectAccount: () => {},
    ...overrides,
  };
  configureAccountRuntime(rt);
  return rt;
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

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** The composed guards, pulled off their routes so they can be driven in isolation. */
const activeGuard = routeFor('GET', '/api/account').middleware?.[0] as Middleware;
const logoutGuard = routeFor('POST', '/api/account/logout').middleware?.[0] as Middleware;

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

/** Call a route handler directly with a preset ctx (account/body/url). */
async function callHandler(method: Method, path: string, overrides: Parameters<typeof fakeCtx>[0]) {
  const ctx = fakeCtx(overrides);
  await routeFor(method, path).handler(ctx);
  return { ctx, ...readRes(ctx.res) };
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

/** Seed the guard db (bearer + moderation) plus any per-route reads for a full chain. */
function authedDb(overrides: DbOverrides = {}): void {
  setAccountDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

beforeEach(() => {
  installRuntime();
});

afterEach(() => {
  resetAccountDbForTests();
  resetAccountRuntimeForTests();
  vi.restoreAllMocks();
  // Clear the factory vi.fn call history (restoreAllMocks only resets vi.spyOn), so a
  // db call recorded by one deactivate test never bleeds into the next test's assertion.
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Route table wiring.
// ---------------------------------------------------------------------------

describe('account route table', () => {
  it('registers exactly the 17 account-portal routes (method + path)', () => {
    const pairs = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(pairs).toEqual(
      [
        'GET /api/account',
        'POST /api/account/password',
        'POST /api/account/logout',
        'POST /api/account/email',
        'POST /api/account/email/set-initial',
        'POST /api/account/deactivate',
        'POST /api/account/companion-token',
        'GET /api/account/companion-token',
        'DELETE /api/account/companion-token',
        'POST /api/account/email/change',
        'GET /api/account/email/verify',
        'POST /api/account/export',
        'POST /api/account/marketing',
        'POST /api/account/2fa/setup',
        'POST /api/account/2fa/enable',
        'POST /api/account/2fa/disable',
        'GET /api/email/unsubscribe',
      ].sort(),
    );
  });

  it('gates the two token-in-query link routes with NO middleware (unauthenticated)', () => {
    expect(routeFor('GET', '/api/account/email/verify').middleware).toBeUndefined();
    expect(routeFor('GET', '/api/email/unsubscribe').middleware).toBeUndefined();
  });

  it('gates logout with its OWN guard, distinct from the shared active guard', () => {
    expect(logoutGuard).not.toBe(activeGuard);
    // Every other authenticated account route shares the one active guard instance.
    for (const r of routes) {
      if (r.path === '/api/account/logout') continue;
      if (r.path === '/api/account/email/verify' || r.path === '/api/email/unsubscribe') continue;
      expect(r.middleware?.[0], `${r.method} ${r.path}`).toBe(activeGuard);
    }
  });
});

// ---------------------------------------------------------------------------
// activeGuard (mirrors bearerActiveAccount), driven alone through the onion.
// ---------------------------------------------------------------------------

describe('activeGuard', () => {
  it('401s a missing Authorization header with NO db read', async () => {
    const accountAndScopeForToken = vi.fn(scopeOf('full'));
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setAccountDbForTests({ accountAndScopeForToken, moderationStatusForAccount });

    const r = await runChain([activeGuard], fakeCtx({}));
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    // A missing bearer 401s before any db call (so the no-auth golden replays DB-free).
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('401s an unknown token (accountAndScopeForToken -> null) without a moderation read', async () => {
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setAccountDbForTests({
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
    setAccountDbForTests({ accountAndScopeForToken: scopeOf('read'), moderationStatusForAccount });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 403 });
    expect(r.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('403s a moderation-locked account with the status message', async () => {
    authedDb({
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, message: 'you are banned' }),
    });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 403 });
    expect(r.body).toEqual({ error: 'you are banned', code: 'moderation.suspended' });
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
// logoutGuard (mirrors the legacy logout arm: any token that maps to an account,
// NO scope or moderation gate, so a banned account can still sign out).
// ---------------------------------------------------------------------------

describe('logoutGuard', () => {
  it('401s a missing Authorization header with NO db read', async () => {
    const accountForToken = vi.fn(async () => 7);
    setAccountDbForTests({ accountForToken });
    const r = await runChain([logoutGuard], fakeCtx({}));
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(accountForToken).not.toHaveBeenCalled();
  });

  it('401s a present-but-unknown token (accountForToken -> null)', async () => {
    setAccountDbForTests({ accountForToken: async () => null });
    const r = await runChain([logoutGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
  });

  it('proceeds for a valid token WITHOUT a scope or moderation gate (banned can sign out)', async () => {
    // A read-only OR locked account still logs out: the guard never reads the scope
    // or the moderation status, unlike activeGuard.
    const moderationStatusForAccount = vi.fn(async () => modStatus({ locked: true }));
    setAccountDbForTests({ accountForToken: async () => 7, moderationStatusForAccount });
    const r = await runChain([logoutGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r.reached).toBe(true);
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Companion-token handlers (they use the account.ts db seam directly).
// ---------------------------------------------------------------------------

describe('companion-token handlers', () => {
  const account = { accountId: 7, scope: 'full' as const };

  it('POST mints a 90-day read token and returns the secret once', async () => {
    const createCompanionToken = vi.fn(async () => {});
    setAccountDbForTests({ createCompanionToken });
    const r = await callHandler('POST', COMPANION_PATH, { account, body: { label: 'phone' } });
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(body).toMatchObject({ label: 'phone', scope: 'read', expiresInDays: 90 });
    expect(createCompanionToken).toHaveBeenCalledWith(body.token, 7, 'phone', COMPANION_TTL_HOURS);
  });

  it('POST trims + caps the label at 64 chars, and an empty label becomes null', async () => {
    const createCompanionToken = vi.fn(async () => {});
    setAccountDbForTests({ createCompanionToken });

    const long = await callHandler('POST', COMPANION_PATH, {
      account,
      body: { label: `   ${'x'.repeat(100)}   ` },
    });
    expect((long.body as Record<string, unknown>).label).toBe('x'.repeat(64));

    const empty = await callHandler('POST', COMPANION_PATH, { account, body: {} });
    expect((empty.body as Record<string, unknown>).label).toBeNull();
    expect(createCompanionToken).toHaveBeenLastCalledWith(
      expect.any(String),
      7,
      null,
      COMPANION_TTL_HOURS,
    );
  });

  it('GET lists the account tokens (no secrets)', async () => {
    const rows = [tokenRow(), tokenRow({ prefix: 'ffff0000', label: null })];
    setAccountDbForTests({ listCompanionTokens: async () => rows });
    const r = await callHandler('GET', COMPANION_PATH, { account });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ tokens: rows });
  });

  it('DELETE revokes by prefix (trimmed + lower-cased): 200 on a hit', async () => {
    const revokeCompanionToken = vi.fn(async () => true);
    setAccountDbForTests({ revokeCompanionToken });
    const r = await callHandler('DELETE', COMPANION_PATH, {
      account,
      body: { prefix: '  ABCD1234  ' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(revokeCompanionToken).toHaveBeenCalledWith(7, 'abcd1234');
  });

  it('DELETE answers 404 { error: "token not found" } on a miss', async () => {
    setAccountDbForTests({ revokeCompanionToken: async () => false });
    const r = await callHandler('DELETE', COMPANION_PATH, {
      account,
      body: { prefix: 'deadbeef' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'token not found' });
  });

  it('serves a full POST chain (activeGuard -> handler) for a full-scope token', async () => {
    const createCompanionToken = vi.fn(async () => {});
    authedDb({ createCompanionToken });
    const r = await runRoute('POST', COMPANION_PATH, {
      headers: { authorization: BEARER },
      body: { label: 'laptop' },
    });
    expect(r.reached).toBe(true);
    expect(r.status).toBe(200);
    expect((r.body as Record<string, unknown>).scope).toBe('read');
  });
});

// ---------------------------------------------------------------------------
// The companion-token method fan: an unsupported method now resolves 405 + Allow
// via the registry (the companionTokenMethodFan known deviation).
// ---------------------------------------------------------------------------

describe('companion-token method fan (405 deviation)', () => {
  it('resolves POST / GET / DELETE to a matched route', () => {
    for (const method of ['POST', 'GET', 'DELETE'] as const) {
      expect(apiRegistry.resolve(method, COMPANION_PATH).kind).toBe('matched');
    }
  });

  it('resolves an UNSUPPORTED method to 405 methodNotAllowed with an Allow set', () => {
    const result = apiRegistry.resolve('PUT', COMPANION_PATH);
    expect(result.kind).toBe('methodNotAllowed');
    if (result.kind === 'methodNotAllowed') {
      expect(result.allow).toEqual(expect.arrayContaining(['GET', 'POST', 'DELETE']));
    }
  });
});

// ---------------------------------------------------------------------------
// The accountBodyValidationRemap known deviation: the account write handlers self-read
// their body (no withBody), so a malformed / over-cap body throws inside readBody and
// surfaces as 500 application/problem+json through the shared withErrors boundary, where
// the legacy outer-catch answered 500 { error: 'internal error' }. Same 500 STATUS, only
// the body SHAPE diverges (no withBody, so NO 400/413 remap either). Pinned here on the
// companion-create route (a self-reading route handler the deviation lists), mirroring how
// the companion-token method fan is pinned above.
// ---------------------------------------------------------------------------

describe('accountBodyValidationRemap deviation (self-read body throw -> 500 problem+json)', () => {
  it('POST /api/account/companion-token with a malformed body is 500 application/problem+json (internal.error)', async () => {
    authedDb();
    const r = await runRoute('POST', COMPANION_PATH, {
      headers: { authorization: BEARER },
      body: '{ not valid json',
    });
    // The throw propagates past activeGuard to the withErrors boundary: 500 STATUS (as
    // legacy) but the problem+json body shape (internal.error), not legacy { error }.
    expect(r.status).toBe(500);
    expect(r.contentType).toBe('application/problem+json');
    expect((r.body as Record<string, unknown>).code).toBe('internal.error');
  });
});

// ---------------------------------------------------------------------------
// The two token-in-query link handlers (db-free no-token path), byte-identical to
// their characterization goldens.
// ---------------------------------------------------------------------------

describe('email link routes (no token, db-free)', () => {
  it('GET /api/email/unsubscribe with no token is 200 { ok: true } (matches its fixture)', async () => {
    const r = await callHandler('GET', '/api/email/unsubscribe', {
      url: '/api/email/unsubscribe',
    });
    const fx = fixture('email_unsubscribe_no_token');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.contentType).toBe('application/json');
  });

  it('GET /api/account/email/verify with no token is 400 (matches its fixture)', async () => {
    const r = await callHandler('GET', '/api/account/email/verify', {
      url: '/api/account/email/verify',
    });
    const fx = fixture('email_verify_no_token_400');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.contentType).toBe('application/json');
  });

  it('reads the token off the query string (a blank token stays the empty-token path)', async () => {
    // A whitespace-only token trims to '' inside the domain fn, so email/verify still
    // 400s: this pins that the handler forwards ctx.url.searchParams.get(token), and a
    // present-but-empty token is db-free (never reaching consumeEmailChangeRequest).
    const r = await callHandler('GET', '/api/account/email/verify', {
      url: '/api/account/email/verify?token=%20%20',
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'invalid or expired link' });
  });
});

// ---------------------------------------------------------------------------
// A representative full guard-rejection chain, byte-identical to its golden.
// ---------------------------------------------------------------------------

describe('full route chain: no-auth 401 (byte-identical to the golden)', () => {
  it('GET /api/account with no bearer is 401 { error: "not authenticated" }', async () => {
    const r = await runRoute('GET', '/api/account');
    const fx = fixture('account_get_noauth_401');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.reached).toBe(false);
  });

  it('POST /api/account/logout with no bearer is 401 { error: "not authenticated" }', async () => {
    const r = await runRoute('POST', '/api/account/logout', { body: {} });
    const fx = fixture('account_logout_post_noauth_401');
    expect(r.status).toBe(fx.status);
    // The golden body canonicalizes key order (code before error); the raw emit is
    // insertion order, so canonicalize the raw the same way before the byte-compare.
    expect(stableStringify(JSON.parse(r.raw))).toBe(fx.body);
    expect(r.reached).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The deactivate route threads the injected AccountGameHooks (the highest-
// consequence route: account lock + live-session teardown). The db/auth/email
// reads it self-drives are mocked (see the top-of-file vi.mock spreads).
// ---------------------------------------------------------------------------

describe('deactivate route: injected hooks + runtime wiring', () => {
  const account = { accountId: 7, scope: 'full' as const };
  const acctRow = { id: 7, username: 'hero', password_hash: 'HASH' } as unknown as Awaited<
    ReturnType<typeof accountById>
  >;
  const charRows = [{ id: 1 }, { id: 2 }] as unknown as Awaited<ReturnType<typeof listCharacters>>;
  const goodBody = { username: 'hero', password: 'pw' };

  it('consults anyCharacterOnline and fires disconnectAccount on a successful deactivate', async () => {
    vi.mocked(accountById).mockResolvedValue(acctRow);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(listCharacters).mockResolvedValue(charRows);
    vi.mocked(setAccountDeactivated).mockResolvedValue(undefined);
    vi.mocked(revokeTokensExcept).mockResolvedValue(undefined);
    const anyCharacterOnline = vi.fn(() => false);
    const disconnectAccount = vi.fn();
    installRuntime({ anyCharacterOnline, disconnectAccount });

    const r = await callHandler('POST', '/api/account/deactivate', { account, body: goodBody });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    // The injected hooks fired THROUGH the handler: the online-check saw the account's
    // character ids, and the post-lock teardown disconnected the account.
    expect(anyCharacterOnline).toHaveBeenCalledWith([1, 2]);
    expect(disconnectAccount).toHaveBeenCalledWith(7, expect.any(String));
    // The self-service delete also emails the account (the side effect the legacy arm
    // fired too), so the deactivate flow is confirmed end to end, not just the hooks.
    expect(vi.mocked(emailAccountDeleted)).toHaveBeenCalledWith(acctRow);
  });

  it('409s and does NOT disconnect when anyCharacterOnline reports a live session', async () => {
    vi.mocked(accountById).mockResolvedValue(acctRow);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(listCharacters).mockResolvedValue([{ id: 1 }] as unknown as typeof charRows);
    const disconnectAccount = vi.fn();
    installRuntime({ anyCharacterOnline: () => true, disconnectAccount });

    const r = await callHandler('POST', '/api/account/deactivate', { account, body: goodBody });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      error: 'log out all characters before deactivating',
      code: 'account.characters_online',
    });
    expect(disconnectAccount).not.toHaveBeenCalled();
    expect(setAccountDeactivated).not.toHaveBeenCalled();
  });

  it('throws a loud error when the account runtime is not configured (useRuntime guard)', async () => {
    resetAccountRuntimeForTests();
    const ctx = fakeCtx({ account, body: {} });
    // useRuntime() is evaluated as the hooks argument BEFORE handleAccountDeactivate runs,
    // so a request that beat boot wiring fails loudly rather than silently degrading.
    await expect(routeFor('POST', '/api/account/deactivate').handler(ctx)).rejects.toThrow(
      /account runtime is not configured/,
    );
  });
});

// ---------------------------------------------------------------------------
// The password/logout handlers re-derive the caller token defensively. The guard
// guarantees a non-null token, but the handler re-guards (tsc-satisfying + mirrors
// the legacy arm's explicit 401 fallback), so a direct call with no bearer 401s.
// ---------------------------------------------------------------------------

describe('handler defensive callerToken re-guard', () => {
  const account = { accountId: 7, scope: 'full' as const };

  it('passwordHandler 401s a ctx with no bearer header (unreachable-after-guard branch)', async () => {
    const r = await callHandler('POST', '/api/account/password', { account, body: {} });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
  });

  it('logoutHandler 401s a ctx with no bearer header (unreachable-after-guard branch)', async () => {
    const r = await callHandler('POST', '/api/account/logout', { account, body: {} });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
  });
});
