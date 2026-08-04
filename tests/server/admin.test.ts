// Unit coverage for the admin route layer (server/admin.ts).
//
// The ~30 handleAdminApi branches moved off the inline if-ladder onto RouteDefs the
// shared dispatcher serves under API_DISPATCH 'new' (main.ts routes /admin/api
// through its own flag-gated dispatcher whose delegate is the legacy handleAdminApi).
// It is a PARITY-FIRST migration: every handler reproduces its legacy branch and
// writes the SAME { success, data, error } admin envelope byte-for-byte. This slice
// pins:
//  - the FROZEN envelope contract (a success body, an error body, a data:{ ok:true }
//    body) and that surface 'admin' + meta.envelope 'admin' select serializeAdmin;
//  - the requireAdmin gate: db-free 401 on a missing bearer, 401 on a read token or
//    non-admin, and a valid full-scope admin reaches the handler;
//  - the admin.login limiter: its own in-handler rateLimited (429), the 401 bad-cred
//    and 403 no-admin-access shapes, all anonymous (no requireAdmin);
//  - the operator :id loader: a valid id reaches the handler, a NaN id 422s;
//  - the page/limit pagination contract (page/limit, NOT page/pageSize), lenient
//    coerce-and-clamp (a bad page defaults, never 422), the rows/total/page/limit shape;
//  - the enum :action restructure: the four actions decode, a fifth 422s;
//  - every game.* side effect (disconnect, chat-mute-live, filter/IP reload, kick);
//  - every guard (admin-target 400s, invalid-ip 400s, bad-tier 400) and 404
//    (report/word/ip/account not found);
//  - the best-effort emailSecurityIncident isolation (a mail failure never fails the
//    moderation), and the adminBodyValidationRemap 500 (internal.error) on a throw.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// admin.ts imports it, so set a dummy URL. The pool never connects: every db read is
// a fake via setAdminDbForTests, the game hooks are a fake via configureAdminRuntime,
// and every asserted path returns before any real query.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase17_admin';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminRuntime,
  configureAdminGuildBoardCacheBust,
  configureAdminPlayersCap,
  configureAdminRuntime,
  resetAdminDbForTests,
  resetAdminGuildBoardCacheBustForTests,
  resetAdminPlayersCapForTests,
  resetAdminRuntimeForTests,
  routes,
  setAdminDbForTests,
} from '../../server/admin';
import { resetAdminGuildListReadsForTests } from '../../server/admin_guilds_read';
import { characterProfessionsSheet } from '../../server/character_professions';
import { pool } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import {
  authFailureCount,
  rateLimited,
  resetAuthFailures,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type AccountFlair, wireStreamerLinks } from '../../src/sim/account_flair';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the gate BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// The admin caller the gate resolves the bearer to; isAdminAccount(id) returns true
// ONLY for this id, so a moderation target (a different id) reads as a non-admin.
const ADMIN_ACCOUNT_ID = 7;
const fullToken = (accountId = ADMIN_ACCOUNT_ID) => ({ accountId, scope: 'full' as const });
// The admin-login per-minute ceiling (server/admin.ts ADMIN_LOGIN_MAX_PER_MINUTE).
const ADMIN_LOGIN_MAX = 10;
// The per-account failed-login ceiling within the window (server/ratelimit.ts
// MAX_AUTH_FAILURES, which is not exported; mirrors tests/server/auth.login.test.ts).
const MAX_AUTH_FAILURES = 10;
// A frozen instant so a limiter drain sits inside one 60s window.
const FIXED_NOW_MS = 1_700_000_000_000;

// Loose fake-db overrides: the admin bundle's real return types are strict db-row
// shapes, so tests supply minimal fakes and this single cast point loosens them. The
// handler serializes whatever the fake returns; the assertions pin the exact shape.
type DbOverrides = Record<string, unknown>;
function setDb(overrides: DbOverrides): void {
  setAdminDbForTests(overrides as Parameters<typeof setAdminDbForTests>[0]);
}

// The one seam the loose bag must NOT blind: the limiter stub. Its return type
// derives from the REAL bundle, so a RateLimitOutcome shape change fails here at
// tsc time instead of surfacing as runtime-only spurious 429s (the two-tier-limiter
// gotcha: the loose Record cast hid the boolean-to-outcome flip from tsc).
type AdminDbBundle = Parameters<typeof setAdminDbForTests>[0];
const allowedRateLimit = (): ReturnType<NonNullable<AdminDbBundle['rateLimited']>> => ({
  allowed: true,
  remaining: 1,
  resetSeconds: 0,
});

// Install the admin db seam so requireAdmin resolves the bearer to the admin caller.
// The caller gate reads adminRolesForAccount (staff roles, superadmin here so every
// route's declared permission is held); isAdminAccount stays caller-aware for the
// TARGET checks (true for the caller, false for any other id, so a moderation
// target reads as a normal account). Extra reads are layered per test.
function authedAdminDb(overrides: DbOverrides = {}): void {
  setDb({
    accountAndScopeForToken: async () => fullToken(),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles: ['superadmin'] } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  });
}

// A default game-session runtime with sensible live reads; overrides carry the vi.fn
// spies a side-effect test asserts on. Returned so a test can read the spy calls.
function installAdminRuntime(overrides: Partial<Record<keyof AdminRuntime, unknown>> = {}) {
  const rt = {
    adminStats: vi.fn(() => ({
      online: 3,
      onlineAccounts: 2,
      peakOnline: 5,
      uptimeSeconds: 100,
      tickMsAvg: 1,
      simEntities: 10,
      rssBytes: 1,
      heapUsedBytes: 1,
    })),
    liveSessions: vi.fn(() => []),
    suspiciousPlayers: vi.fn(() => []),
    isIpBlocked: vi.fn(() => false),
    liveSharedIps: vi.fn(() => []),
    liveAccountIds: vi.fn(() => new Set<number>()),
    liveCharacterIds: vi.fn(() => new Set<number>()),
    disconnectAccount: vi.fn(),
    muteAccountChat: vi.fn(),
    liftChatMuteLive: vi.fn(),
    resetChatStrikesLive: vi.fn(),
    reloadChatFilter: vi.fn(async () => {}),
    reloadBlockedIps: vi.fn(async () => {}),
    disconnectByIp: vi.fn(),
    applyAccountFlairLive: vi.fn(),
    // The guild bank operator read defaults to "no loaded book" so a test that
    // does not care about banks cannot accidentally assert against a fixture.
    adminGuildBankState: vi.fn(() => null),
    social: {
      guildRenamed: vi.fn(),
    },
    ...overrides,
  };
  configureAdminRuntime(rt as unknown as AdminRuntime);
  return rt;
}

/** Read status/body/content-type off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
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
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/**
 * The concrete request path for a route template: every :param segment replaced by
 * its supplied value. Production ctx.url.pathname is always concrete (the router
 * matched a real URL), and the requireAdmin central permission gate resolves the
 * route's permission from that concrete path, so the harness must hand it one too.
 */
function concretePath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z_]+)/g, (whole, name) => params[name] ?? whole);
}

/** Drive a full route chain (its real middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: {
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
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
    url: opts.url ?? concretePath(path, opts.params),
    headers: opts.headers,
    body: opts.body,
    params: opts.params,
  });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

beforeEach(() => {
  setRateLimitClock(() => FIXED_NOW_MS);
  resetRateLimits();
  resetAuthFailures();
  resetAdminDbForTests();
});

afterEach(() => {
  resetRateLimits();
  resetAuthFailures();
  resetRateLimitClock();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  resetAdminGuildBoardCacheBustForTests();
  resetAdminPlayersCapForTests();
  resetAdminGuildListReadsForTests();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The { success, data, error } envelope contract (FROZEN).
// ---------------------------------------------------------------------------

describe('admin envelope contract (frozen)', () => {
  it('a SUCCESS body is { success: true, data: <payload>, error: null }', async () => {
    authedAdminDb({ listBlockedIps: async () => [{ id: 1, ip: '1.2.3.4' }] });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 1, ip: '1.2.3.4' }] },
      error: null,
    });
    expect(r.contentType).toBe('application/json');
  });

  it('an ERROR body is { success: false, data: null, error: <string> }', async () => {
    authedAdminDb({ cleanIp: () => '' });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/ip-associations', {
      url: '/admin/api/ip-associations?ip=nonsense',
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'a valid IP address is required' });
  });

  it('a data:{ ok:true } body rides inside the same envelope', async () => {
    authedAdminDb({ reactivateAccountAudited: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
  });

  it('every admin RouteDef declares surface admin + meta.envelope admin', () => {
    for (const r of routes) {
      expect(r.surface, r.path).toBe('admin');
      expect(r.meta?.envelope, r.path).toBe('admin');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The requireAdmin gate (mirrors the legacy adminAccountId(req) resolver).
// ---------------------------------------------------------------------------

describe('requireAdmin gate', () => {
  it('401s a missing bearer DB-free with the legacy admin body', async () => {
    const accountAndScopeForToken = vi.fn(async () => fullToken());
    const adminRolesForAccount = vi.fn(async () => ({ username: 'op', roles: ['superadmin'] }));
    setDb({ accountAndScopeForToken, adminRolesForAccount });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
    // A missing bearer never reaches the token lookup.
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
  });

  it('401s a valid bearer whose account is NOT staff (no roles)', async () => {
    setDb({
      accountAndScopeForToken: async () => fullToken(42),
      adminRolesForAccount: async () => null,
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
  });

  it('401s a bearer that resolves to no account', async () => {
    setDb({
      accountAndScopeForToken: async () => null,
      adminRolesForAccount: async () => ({ username: 'op', roles: ['superadmin'] }),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
  });

  it('401s a staff read token before role resolution or the handler', async () => {
    const adminRolesForAccount = vi.fn(async () => ({ username: 'op', roles: ['superadmin'] }));
    setDb({
      accountAndScopeForToken: async () => ({
        accountId: ADMIN_ACCOUNT_ID,
        scope: 'read' as const,
      }),
      adminRolesForAccount,
    });
    installAdminRuntime();

    const r = await runRoute('GET', '/admin/api/overview', {
      headers: { authorization: BEARER },
    });

    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
    expect(r.reached).toBe(false);
    expect(adminRolesForAccount).not.toHaveBeenCalled();
  });

  it('lets a valid admin through to the handler', async () => {
    authedAdminDb({
      overviewCounts: async () => ({ peakOnlineToday: 0, peakOnlineAllTime: 0 }),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect((r.body as { success: boolean }).success).toBe(true);
  });

  it('403s a staff account whose roles lack the route permission (central gate)', async () => {
    // viewer deliberately excludes botdetector.read (admin_permissions.ts), so the
    // suspicious-players read is denied by the PERMISSION gate, not the auth gate.
    authedAdminDb({
      adminRolesForAccount: async () => ({ username: 'op', roles: ['viewer'] }),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/suspicious-players', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'you do not have permission to do this',
    });
  });

  it('the permission gate consults the CONCRETE path for a :id route', async () => {
    // A moderator holds moderation.act, so the enum action route passes the gate for
    // the synthesized concrete path /moderation/accounts/42/suspend; a viewer is 403d.
    authedAdminDb({
      adminRolesForAccount: async () => ({ username: 'op', roles: ['viewer'] }),
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '42', action: 'suspend' },
      body: {},
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'you do not have permission to do this',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. POST /admin/api/login (anonymous; its own in-handler rateLimited limiter).
// ---------------------------------------------------------------------------

describe('POST /admin/api/login', () => {
  it('is registered anonymous (NO requireAdmin middleware)', () => {
    const login = routeFor('POST', '/admin/api/login');
    expect(login.middleware ?? []).toEqual([]);
  });

  it('429s when its OWN rateLimited bucket is exhausted (legacy prose)', async () => {
    // Its limiter is the legacy rateLimited (ADMIN_LOGIN_MAX per IP), isolated from the
    // new POLICIES table: drain the shared IP window to the cap and the 11th trips.
    for (let i = 0; i < ADMIN_LOGIN_MAX; i++) rateLimited(makeReq(), ADMIN_LOGIN_MAX);
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'a', password: 'b' },
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'too many attempts, wait a minute and try again',
    });
  });

  // Regression coverage for the missing per-account brute-force lockout: unlike
  // POST /api/login (server/auth_routes.ts), admin login had no authThrottled /
  // recordAuthFailure / clearAuthFailures gate, so a distributed attacker who never
  // repeats a source IP could guess a known admin username's password forever,
  // capped only by ADMIN_LOGIN_MAX per IP (never per account).
  describe('per-account failed-login throttle (distributed brute force)', () => {
    it('429s the (MAX_AUTH_FAILURES + 1)th bad-password attempt against ONE account even though every attempt uses a DIFFERENT source IP', async () => {
      const verifyPassword = vi.fn(async () => false);
      setDb({
        findAccount: async () => ({ id: 9, username: 'victim', password_hash: 'h' }) as never,
        verifyPassword,
      });
      let last: Awaited<ReturnType<typeof runRoute>> | undefined;
      for (let i = 0; i < MAX_AUTH_FAILURES + 1; i++) {
        // A fresh, never-repeated source IP per attempt: the per-IP limiter (10/min,
        // ADMIN_LOGIN_MAX) never sees more than one request from any of these, so if
        // it were the only guard this loop would never 429.
        last = await runRoute('POST', '/admin/api/login', {
          body: { username: 'victim', password: 'wrong' },
          headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
        });
      }
      expect(last?.status).toBe(429);
      expect(last?.body).toEqual({
        success: false,
        data: null,
        error: 'too many failed attempts, wait a few minutes and try again',
      });
      // Locked out BEFORE any credential check on the final attempt: verifyPassword
      // was reached exactly MAX_AUTH_FAILURES times (once per prior failure), never
      // on the attempt that trips the lockout.
      expect(verifyPassword).toHaveBeenCalledTimes(MAX_AUTH_FAILURES);
    });

    it('never locks out a DIFFERENT account sharing no username with the attacked one', async () => {
      const verifyPassword = vi.fn(async () => false);
      setDb({
        findAccount: async () => ({ id: 9, username: 'victim', password_hash: 'h' }) as never,
        verifyPassword,
      });
      for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
        await runRoute('POST', '/admin/api/login', {
          body: { username: 'victim', password: 'wrong' },
          headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
        });
      }
      // 'bystander' has never failed a login, so it is unaffected by victim's lockout.
      setDb({
        findAccount: async () => ({ id: 10, username: 'bystander', password_hash: 'h2' }) as never,
        verifyPassword: async () => true,
        adminRolesForAccount: async () => ({ username: 'bystander', roles: ['viewer'] }),
        touchLogin: async () => {},
        newToken: () => 'tokBystander',
        saveToken: async () => {},
      });
      const r = await runRoute('POST', '/admin/api/login', {
        body: { username: 'bystander', password: 'right' },
        headers: { 'x-forwarded-for': '198.51.100.1' },
      });
      expect(r.status).toBe(200);
    });

    it('a successful login clears the account throttle so a later lockout needs a fresh MAX_AUTH_FAILURES run', async () => {
      const verifyPassword = vi.fn(async () => false);
      setDb({
        findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
        verifyPassword,
      });
      for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) {
        await runRoute('POST', '/admin/api/login', {
          body: { username: 'bob', password: 'wrong' },
          headers: { 'x-forwarded-for': `203.0.113.${i + 1}` },
        });
      }
      // One under the ceiling; a correct password now succeeds and forgives the typos.
      setDb({
        findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
        verifyPassword: async () => true,
        adminRolesForAccount: async () => ({ username: 'bob', roles: ['viewer'] }),
        touchLogin: async () => {},
        newToken: () => 'tok456',
        saveToken: async () => {},
      });
      const ok1 = await runRoute('POST', '/admin/api/login', {
        body: { username: 'bob', password: 'correct' },
        headers: { 'x-forwarded-for': '198.51.100.9' },
      });
      expect(ok1.status).toBe(200);

      // Failures started fresh: MAX_AUTH_FAILURES - 1 more bad attempts still don't
      // lock the account out.
      setDb({
        findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
        verifyPassword: async () => false,
      });
      let last: Awaited<ReturnType<typeof runRoute>> | undefined;
      for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) {
        last = await runRoute('POST', '/admin/api/login', {
          body: { username: 'bob', password: 'wrong-again' },
          headers: { 'x-forwarded-for': `192.0.2.${i + 1}` },
        });
      }
      expect(last?.status).toBe(401);
    });
  });

  it('401s bad credentials db-free when the username is absent (anti-enumeration)', async () => {
    const findAccount = vi.fn(async () => null);
    setDb({ findAccount, rateLimited: allowedRateLimit });
    const r = await runRoute('POST', '/admin/api/login', { body: {} });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid username or password' });
    // No username string -> findAccount is never called (matches the golden).
    expect(findAccount).not.toHaveBeenCalled();
  });

  it('403s a valid non-staff account (no admin access)', async () => {
    setDb({
      rateLimited: allowedRateLimit,
      findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
      verifyPassword: async () => true,
      adminRolesForAccount: async () => null,
    });
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'bob', password: 'pw' },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'this account does not have admin access',
    });
  });

  it('200s a valid staff login with the token + username + roles + expanded permissions', async () => {
    setDb({
      rateLimited: allowedRateLimit,
      findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
      verifyPassword: async () => true,
      adminRolesForAccount: async () => ({ username: 'bob', roles: ['viewer'] }),
      touchLogin: async () => {},
      newToken: () => 'tok123',
      saveToken: async () => {},
    });
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'bob', password: 'pw' },
    });
    expect(r.status).toBe(200);
    // The viewer role's literal permission bundle (admin_permissions.ts), pinned so a
    // silent widening of the read-only brick reddens here.
    expect(r.body).toEqual({
      success: true,
      data: {
        token: 'tok123',
        username: 'bob',
        roles: ['viewer'],
        permissions: ['analytics.read', 'accounts.read', 'support.read', 'moderation.read'],
      },
      error: null,
    });
  });

  // Regression coverage for BUG #15: admin login checked only password + staff
  // role and never the account's TOTP second factor (unlike POST /api/login,
  // server/auth_routes.ts loginHandler), so an operator with 2FA enabled could
  // sign into the highest-privilege surface in the app with a bare password.
  describe('two-factor', () => {
    it('returns twoFactorRequired without a token when 2FA is on and no code is supplied', async () => {
      const saveToken = vi.fn(async () => {});
      const verifyLoginTwoFactor = vi.fn(async () => true);
      setDb({
        rateLimited: allowedRateLimit,
        findAccount: async () =>
          ({
            id: 9,
            username: 'bob',
            password_hash: 'h',
            totp_enabled_at: '2020-01-01T00:00:00.000Z',
          }) as never,
        verifyPassword: async () => true,
        adminRolesForAccount: async () => ({ username: 'bob', roles: ['viewer'] }),
        verifyLoginTwoFactor,
        saveToken,
      });
      const r = await runRoute('POST', '/admin/api/login', {
        body: { username: 'bob', password: 'pw' },
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, data: { twoFactorRequired: true }, error: null });
      // No code + no recovery code: the verifier is never consulted and no token issues.
      expect(verifyLoginTwoFactor).not.toHaveBeenCalled();
      expect(saveToken).not.toHaveBeenCalled();
    });

    it('401s an invalid 2FA code and records a failure', async () => {
      const verifyLoginTwoFactor = vi.fn(async () => false);
      setDb({
        rateLimited: allowedRateLimit,
        findAccount: async () =>
          ({
            id: 9,
            username: 'bob',
            password_hash: 'h',
            totp_enabled_at: '2020-01-01T00:00:00.000Z',
          }) as never,
        verifyPassword: async () => true,
        adminRolesForAccount: async () => ({ username: 'bob', roles: ['viewer'] }),
        verifyLoginTwoFactor,
      });
      const r = await runRoute('POST', '/admin/api/login', {
        body: { username: 'bob', password: 'pw', code: '000000' },
      });
      expect(r.status).toBe(401);
      expect(r.body).toEqual({
        success: false,
        data: null,
        error: 'invalid authentication code',
      });
      expect(verifyLoginTwoFactor).toHaveBeenCalledTimes(1);
      expect(authFailureCount()).toBe(1);
    });

    it('200s and issues a token for a good 2FA code', async () => {
      setDb({
        rateLimited: allowedRateLimit,
        findAccount: async () =>
          ({
            id: 9,
            username: 'bob',
            password_hash: 'h',
            totp_enabled_at: '2020-01-01T00:00:00.000Z',
          }) as never,
        verifyPassword: async () => true,
        adminRolesForAccount: async () => ({ username: 'bob', roles: ['viewer'] }),
        verifyLoginTwoFactor: async () => true,
        touchLogin: async () => {},
        newToken: () => 'tok789',
        saveToken: async () => {},
      });
      const r = await runRoute('POST', '/admin/api/login', {
        body: { username: 'bob', password: 'pw', code: '123456' },
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        success: true,
        data: {
          token: 'tok789',
          username: 'bob',
          roles: ['viewer'],
          permissions: ['analytics.read', 'accounts.read', 'support.read', 'moderation.read'],
        },
        error: null,
      });
    });

    it('accepts a recovery code in place of a live TOTP code', async () => {
      const verifyLoginTwoFactor = vi.fn(async () => true);
      setDb({
        rateLimited: allowedRateLimit,
        findAccount: async () =>
          ({
            id: 9,
            username: 'bob',
            password_hash: 'h',
            totp_enabled_at: '2020-01-01T00:00:00.000Z',
          }) as never,
        verifyPassword: async () => true,
        adminRolesForAccount: async () => ({ username: 'bob', roles: ['viewer'] }),
        verifyLoginTwoFactor,
        touchLogin: async () => {},
        newToken: () => 'tokRecovery',
        saveToken: async () => {},
      });
      const r = await runRoute('POST', '/admin/api/login', {
        body: { username: 'bob', password: 'pw', recoveryCode: 'ABCD-EFGH' },
      });
      expect(r.status).toBe(200);
      expect((r.body as { data: { token: string } }).data.token).toBe('tokRecovery');
      expect(verifyLoginTwoFactor).toHaveBeenCalledWith(
        expect.objectContaining({ id: 9 }),
        '',
        'ABCD-EFGH',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 4. The operator :id loader (requireAdminTarget) + enum :action decode.
// ---------------------------------------------------------------------------

describe('operator :id loader + enum :action', () => {
  it('reaches the handler with a valid numeric :id', async () => {
    authedAdminDb({ reactivateAccountAudited: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(200);
    expect(r.reached).toBe(true);
  });

  it('404s a non-numeric :id fail-closed before any handler runs (central permission gate)', async () => {
    // The permission table keys :id routes on (\d+), so a non-numeric id resolves no
    // permission and the central gate 404s it, byte-identical to the legacy arm's
    // fail-closed preamble. This supersedes the old adminIdParamDecode 422 for the
    // non-NUMERIC case; a numeric-but-invalid id (0, below) still reaches the decode.
    const reactivateAccountAudited = vi.fn(async () => {});
    authedAdminDb({ reactivateAccountAudited });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown admin endpoint' });
    expect(r.reached).toBe(false);
    expect(reactivateAccountAudited).not.toHaveBeenCalled();
  });

  it('422s a non-positive :id (0)', async () => {
    authedAdminDb({ reactivateAccountAudited: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '0' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ success: false, data: null, error: 'validation.failed' });
  });

  for (const action of ['suspend', 'unsuspend', 'ban', 'unban'] as const) {
    it(`decodes the valid action "${action}" and reaches moderateAccount`, async () => {
      const moderateAccount = vi.fn(async () => {});
      const revokeTokensExcept = vi.fn(async () => {});
      authedAdminDb({ moderateAccount, accountMailTarget: async () => null, revokeTokensExcept });
      installAdminRuntime();
      const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
        headers: { authorization: BEARER },
        params: { id: '5', action },
        body: {},
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
      expect(moderateAccount).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 5, adminAccountId: ADMIN_ACCOUNT_ID, action }),
      );
      // suspend/ban sign the target out of every device (mirrors reset-password);
      // unsuspend/unban are non-punitive reversals and must never touch tokens.
      if (action === 'suspend' || action === 'ban') {
        expect(revokeTokensExcept).toHaveBeenCalledWith(5, null);
      } else {
        expect(revokeTokensExcept).not.toHaveBeenCalled();
      }
    });
  }

  it('404s a fifth action outside the enum fail-closed (never calls moderateAccount)', async () => {
    // The permission table's alternation covers exactly the four actions, so a fifth
    // resolves no permission and the central gate 404s it, byte-identical to the
    // legacy arm's fail-closed preamble (superseding the adminEnumInvalid422 deviation).
    const moderateAccount = vi.fn(async () => {});
    authedAdminDb({ moderateAccount });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'frobnicate' },
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown admin endpoint' });
    expect(moderateAccount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. The page/limit pagination contract (page/limit, NOT page/pageSize).
// ---------------------------------------------------------------------------

describe('page/limit pagination contract', () => {
  it('passes page + limit through to the db read and preserves the rows/total/page/limit shape', async () => {
    const listAccounts = vi.fn(async (search: string, page: number, limit: number) => ({
      rows: [{ id: 1 }],
      total: 1,
      page,
      limit,
      search,
    }));
    authedAdminDb({ listAccounts });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/accounts', {
      url: '/admin/api/accounts?page=2&limit=10&search=bob',
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(listAccounts).toHaveBeenCalledWith('bob', 2, 10);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 1 }], total: 1, page: 2, limit: 10, search: 'bob' },
      error: null,
    });
  });

  it('clamps limit to MAX_PAGE_LIMIT (200) and floors page at 1', async () => {
    const listAccounts = vi.fn(async (_s: string, page: number, limit: number) => ({
      page,
      limit,
    }));
    authedAdminDb({ listAccounts });
    installAdminRuntime();
    await runRoute('GET', '/admin/api/accounts', {
      url: '/admin/api/accounts?page=-5&limit=9999',
      headers: { authorization: BEARER },
    });
    expect(listAccounts).toHaveBeenCalledWith('', 1, 200);
  });

  it('is LENIENT: a non-numeric page/limit DEFAULTS (never 422)', async () => {
    const listAccounts = vi.fn(async (_s: string, page: number, limit: number) => ({
      page,
      limit,
    }));
    authedAdminDb({ listAccounts });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/accounts', {
      url: '/admin/api/accounts?page=abc&limit=xyz',
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    // page defaults to 1, limit to DEFAULT_PAGE_LIMIT (25); NOT a validation 422.
    expect(listAccounts).toHaveBeenCalledWith('', 1, 25);
  });

  it('bug-reports uses page/limit and the { rows, total, page, limit } shape', async () => {
    const listBugReports = vi.fn(async (limit: number, offset: number) => ({
      rows: [{ id: 1 }],
      total: 1,
      _limit: limit,
      _offset: offset,
    }));
    authedAdminDb({ listBugReports });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/bug-reports', {
      url: '/admin/api/bug-reports?page=3&limit=20',
      headers: { authorization: BEARER },
    });
    expect(listBugReports).toHaveBeenCalledWith(20, 40);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 1 }], total: 1, page: 3, limit: 20 },
      error: null,
    });
  });

  it('unstuck-reports returns bounded cursor rows and content-local hotspots', async () => {
    const listUnstuckReports = vi.fn(async () => ({
      rows: [
        {
          id: 9,
          realm: 'test',
          accountId: 4,
          characterId: 5,
          characterName: 'Aleph',
          areaKind: 'rift',
          areaId: 'seed:42:floor:1',
          instanceId: '7',
          instanceSlot: 2,
          originRawX: 100,
          originRawY: 3,
          originRawZ: 200,
          originLocalX: 4,
          originLocalY: 3,
          originLocalZ: 8,
          destinationRawX: 101,
          destinationRawY: 3,
          destinationRawZ: 200,
          destinationLocalX: 5,
          destinationLocalY: 3,
          destinationLocalZ: 8,
          outcome: 'completed',
          reason: 'nearest_safe_position',
          invokedAt: '2026-01-01T00:00:00.000Z',
          resolvedAt: '2026-01-01T00:00:10.000Z',
          createdAt: '2026-01-01T00:00:10.000Z',
        },
      ],
      hasMore: true,
      nextBeforeId: 9,
    }));
    const listUnstuckHotspots = vi.fn(async () => [
      {
        areaKind: 'rift',
        areaId: 'seed:42:floor:1',
        instanceId: null,
        bucketLocalX: 0,
        bucketLocalY: 0,
        bucketLocalZ: 5,
        reportCount: 3,
        completedCount: 1,
        cancelledCount: 1,
        failedCount: 1,
        firstInvokedAt: '2026-01-01T00:00:00.000Z',
        lastResolvedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    authedAdminDb({ listUnstuckReports, listUnstuckHotspots });
    installAdminRuntime();

    const r = await runRoute('GET', '/admin/api/unstuck-reports', {
      url: '/admin/api/unstuck-reports?days=999&limit=999',
      headers: { authorization: BEARER },
    });

    expect(listUnstuckReports).toHaveBeenCalledWith(
      expect.objectContaining({ days: 90, limit: 200 }),
    );
    expect(listUnstuckHotspots).toHaveBeenCalledWith(
      expect.objectContaining({ days: 90, limit: 50 }),
    );
    expect(r.body).toMatchObject({
      success: true,
      data: {
        reports: [
          {
            id: 9,
            characterName: 'Aleph',
            area: { kind: 'rift', id: 'seed:42:floor:1', instanceId: '7', slot: 2 },
            origin: { x: 100, y: 3, z: 200, localX: 4, localY: 3, localZ: 8 },
            destination: { x: 101, y: 3, z: 200, localX: 5, localY: 3, localZ: 8 },
            outcome: 'completed',
          },
        ],
        hotspots: [
          {
            bucket: { x: 0, y: 0, z: 5 },
            count: 3,
            completed: 1,
            cancelled: 1,
            failed: 1,
          },
        ],
        days: 90,
        limit: 200,
        hasMore: true,
        nextBeforeId: 9,
      },
      error: null,
    });
  });

  it('unstuck-reports skips the hotspot aggregate on cursor pages', async () => {
    const listUnstuckReports = vi.fn(async () => ({
      rows: [],
      hasMore: false,
      nextBeforeId: null,
    }));
    const listUnstuckHotspots = vi.fn(async () => []);
    authedAdminDb({ listUnstuckReports, listUnstuckHotspots });
    installAdminRuntime();

    const r = await runRoute('GET', '/admin/api/unstuck-reports', {
      url: '/admin/api/unstuck-reports?days=14&limit=25&beforeId=9',
      headers: { authorization: BEARER },
    });

    expect(listUnstuckReports).toHaveBeenCalledWith(
      expect.objectContaining({ days: 14, limit: 25, beforeId: 9 }),
    );
    expect(listUnstuckHotspots).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({
      success: true,
      data: { reports: [], hotspots: [], hasMore: false, nextBeforeId: null },
      error: null,
    });
  });
});

describe('guild administration', () => {
  it('denies guild reads and writes before their database functions when permissions are absent', async () => {
    const listAdminGuilds = vi.fn();
    const adminGuildDetail = vi.fn();
    const listAdminGuildHistory = vi.fn();
    const renameAdminGuild = vi.fn();
    authedAdminDb({
      adminRolesForAccount: async () => ({ username: 'op', roles: ['unknown-role'] }),
      listAdminGuilds,
      adminGuildDetail,
      listAdminGuildHistory,
      renameAdminGuild,
    });
    installAdminRuntime();

    const read = await runRoute('GET', '/admin/api/guilds', {
      headers: { authorization: BEARER },
    });
    expect(read.status).toBe(403);
    expect(listAdminGuilds).not.toHaveBeenCalled();

    const detail = await runRoute('GET', '/admin/api/guilds/:id', {
      headers: { authorization: BEARER },
      params: { id: '4' },
    });
    expect(detail.status).toBe(403);
    expect(adminGuildDetail).not.toHaveBeenCalled();

    const history = await runRoute('GET', '/admin/api/guilds/:id/history', {
      headers: { authorization: BEARER },
      params: { id: '4' },
    });
    expect(history.status).toBe(403);
    expect(listAdminGuildHistory).not.toHaveBeenCalled();

    // The guild bank read is a live-sim read rather than a db one, so its
    // "never reached" proof is the runtime spy.
    const rtDenied = installAdminRuntime();
    const bank = await runRoute('GET', '/admin/api/guilds/:id/bank', {
      headers: { authorization: BEARER },
      params: { id: '4' },
    });
    expect(bank.status).toBe(403);
    expect(rtDenied.adminGuildBankState).not.toHaveBeenCalled();

    authedAdminDb({
      adminRolesForAccount: async () => ({ username: 'op', roles: ['viewer'] }),
      renameAdminGuild,
    });
    const write = await runRoute('POST', '/admin/api/guilds/:id/rename', {
      headers: { authorization: BEARER },
      params: { id: '4' },
      body: { name: 'New Name', reason: 'reason' },
    });
    expect(write.status).toBe(403);
    expect(renameAdminGuild).not.toHaveBeenCalled();
  });

  it('lists current-realm guilds through bounded page parameters', async () => {
    const listAdminGuilds = vi.fn(
      async (_search: string, page: number, limit: number, _sort: string, _dir: string) => ({
        rows: [{ id: 4, name: 'Keepers' }],
        total: 1,
        page,
        limit,
      }),
    );
    authedAdminDb({ listAdminGuilds });
    installAdminRuntime();

    const response = await runRoute('GET', '/admin/api/guilds', {
      url: '/admin/api/guilds?search=Keep&page=2&limit=10&sort=member_count&dir=asc',
      headers: { authorization: BEARER },
    });

    expect(listAdminGuilds).toHaveBeenCalledWith('Keep', 2, 10, 'member_count', 'asc');
    expect(response.body).toEqual({
      success: true,
      data: {
        rows: [{ id: 4, name: 'Keepers' }],
        total: 1,
        page: 2,
        limit: 10,
      },
      error: null,
    });
  });

  it('returns 503 before a third distinct member-count read can occupy the pool', async () => {
    const resolvers: Array<
      (value: { rows: never[]; total: number; page: number; limit: number }) => void
    > = [];
    const listAdminGuilds = vi.fn(
      async (_search: string, _page: number, _limit: number) =>
        new Promise<{ rows: never[]; total: number; page: number; limit: number }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    authedAdminDb({ listAdminGuilds });
    installAdminRuntime();

    const first = runRoute('GET', '/admin/api/guilds', {
      url: '/admin/api/guilds?sort=member_count&page=1',
      headers: { authorization: BEARER },
    });
    const second = runRoute('GET', '/admin/api/guilds', {
      url: '/admin/api/guilds?sort=member_count&page=2',
      headers: { authorization: BEARER },
    });
    await vi.waitFor(() => expect(listAdminGuilds).toHaveBeenCalledTimes(2));

    const rejected = await runRoute('GET', '/admin/api/guilds', {
      url: '/admin/api/guilds?sort=member_count&page=3',
      headers: { authorization: BEARER },
    });
    expect(rejected.status).toBe(503);
    expect(rejected.body).toEqual({
      success: false,
      data: null,
      error: 'guild list busy, try again',
    });
    expect(listAdminGuilds).toHaveBeenCalledTimes(2);

    // The admission control exists for the aggregating sort, so the default
    // name-sorted directory must still load while that class is saturated.
    const directory = runRoute('GET', '/admin/api/guilds', {
      url: '/admin/api/guilds?page=1',
      headers: { authorization: BEARER },
    });
    await vi.waitFor(() => expect(listAdminGuilds).toHaveBeenCalledTimes(3));

    resolvers.forEach((resolve, index) => {
      resolve({ rows: [], total: 0, page: index + 1, limit: 25 });
    });
    const settled = await directory;
    expect(settled.status).not.toBe(503);
    await Promise.all([first, second]);
  });

  it('merges online character ids into the minimal guild roster', async () => {
    authedAdminDb({
      adminGuildDetail: async () => ({
        guild: { id: 4, name: 'Keepers', realm: 'test', createdAt: 'now', memberCount: 2 },
        members: [
          { characterId: 8, characterName: 'Alice' },
          { characterId: 9, characterName: 'Bob' },
        ],
      }),
    });
    installAdminRuntime({ liveCharacterIds: vi.fn(() => new Set([9])) });

    const response = await runRoute('GET', '/admin/api/guilds/:id', {
      headers: { authorization: BEARER },
      params: { id: '4' },
    });

    expect(response.body).toEqual({
      success: true,
      data: {
        guild: { id: 4, name: 'Keepers', realm: 'test', createdAt: 'now', memberCount: 2 },
        members: [
          { characterId: 8, characterName: 'Alice', online: false },
          { characterId: 9, characterName: 'Bob', online: true },
        ],
      },
      error: null,
    });
  });

  it('returns the retained rename history independently from roster reads', async () => {
    const listAdminGuildHistory = vi.fn(async () => [
      { id: 1, oldName: 'Old Name', newName: 'Keepers' },
    ]);
    authedAdminDb({ listAdminGuildHistory });
    installAdminRuntime();

    const response = await runRoute('GET', '/admin/api/guilds/:id/history', {
      headers: { authorization: BEARER },
      params: { id: '4' },
    });

    expect(listAdminGuildHistory).toHaveBeenCalledWith(4);
    expect(response.body).toEqual({
      success: true,
      data: { rows: [{ id: 1, oldName: 'Old Name', newName: 'Keepers' }] },
      error: null,
    });
  });

  it('pushes and invalidates only after the committed rename succeeds', async () => {
    const renameAdminGuild = vi.fn(async () => ({
      result: {
        guildId: 4,
        oldName: 'Old Name',
        newName: 'Keepers',
        memberCharacterIds: [8, 9],
      },
    }));
    authedAdminDb({ renameAdminGuild });
    const guildRenamed = vi.fn();
    installAdminRuntime({ social: { guildRenamed } });
    const bustCaches = vi.fn();
    configureAdminGuildBoardCacheBust(bustCaches);

    const response = await runRoute('POST', '/admin/api/guilds/:id/rename', {
      headers: { authorization: BEARER },
      params: { id: '4' },
      body: { name: 'Keepers', reason: 'offensive name' },
    });

    expect(renameAdminGuild).toHaveBeenCalledWith(4, 'Keepers', 'offensive name', ADMIN_ACCOUNT_ID);
    expect(guildRenamed).toHaveBeenCalledWith(4, 'Old Name', 'Keepers', [8, 9]);
    expect(bustCaches).toHaveBeenCalledOnce();
    expect(response.body).toEqual({
      success: true,
      data: { id: 4, name: 'Keepers' },
      error: null,
    });
  });

  it('does not emit a live event or invalidate caches when rename validation fails', async () => {
    authedAdminDb({ renameAdminGuild: async () => ({ error: 'invalid_reason' }) });
    const guildRenamed = vi.fn();
    installAdminRuntime({ social: { guildRenamed } });
    const bustCaches = vi.fn();
    configureAdminGuildBoardCacheBust(bustCaches);

    const response = await runRoute('POST', '/admin/api/guilds/:id/rename', {
      headers: { authorization: BEARER },
      params: { id: '4' },
      body: { name: 'Keepers', reason: '' },
    });

    expect(response.status).toBe(400);
    expect(guildRenamed).not.toHaveBeenCalled();
    expect(bustCaches).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_name', 400, 'guild name must be 3-24 letters with single spaces'],
    ['invalid_reason', 400, 'a moderation reason is required (500 chars max)'],
    ['not_found', 404, 'guild not found'],
    ['same_name', 400, 'guild name must change'],
    ['name_taken', 409, 'guild name is already taken'],
    ['member_limit_exceeded', 409, 'guild member limit exceeded'],
  ] as const)('maps %s rename failures to the admin envelope', async (error, status, message) => {
    authedAdminDb({ renameAdminGuild: async () => ({ error }) });
    const guildRenamed = vi.fn();
    installAdminRuntime({ social: { guildRenamed } });
    const bustCaches = vi.fn();
    configureAdminGuildBoardCacheBust(bustCaches);

    const response = await runRoute('POST', '/admin/api/guilds/:id/rename', {
      headers: { authorization: BEARER },
      params: { id: '4' },
      body: { name: 'New Name', reason: 'reason' },
    });

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ success: false, data: null, error: message });
    expect(guildRenamed).not.toHaveBeenCalled();
    expect(bustCaches).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Game-session side effects preserved.
// ---------------------------------------------------------------------------

describe('game.* side effects preserved', () => {
  it('blocked-ips POST reloads the live list and kicks the IP', async () => {
    authedAdminDb({ addBlockedIp: async () => '9.9.9.9' });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
      body: { ip: '9.9.9.9', reason: 'spam' },
    });
    expect(r.status).toBe(200);
    expect(rt.reloadBlockedIps).toHaveBeenCalledTimes(1);
    expect(rt.disconnectByIp).toHaveBeenCalledWith('9.9.9.9', 'Connection to the server was lost.');
  });

  it('a suspend disconnects the target account and fires the best-effort mail', async () => {
    const emailSecurityIncident = vi.fn();
    const revokeTokensExcept = vi.fn(async () => {});
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () =>
        ({ id: 5, username: 'x', email: 'x@y.z', locale: 'en', marketing_opt_in: false }) as never,
      emailSecurityIncident,
      revokeTokensExcept,
    });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'suspend' },
      body: { reason: 'griefing' },
    });
    expect(r.status).toBe(200);
    expect(revokeTokensExcept).toHaveBeenCalledWith(5, null);
    expect(rt.disconnectAccount).toHaveBeenCalledWith(5, 'This account is suspended.');
  });

  it('chat-mute mutes the live sessions', async () => {
    authedAdminDb({ muteAccountChat: async () => {} });
    const rt = installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/accounts/:id/chat-mute', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { expiresAt: '2030-01-01', reason: 'spam' },
    });
    expect(rt.muteAccountChat).toHaveBeenCalledWith(5, '2030-01-01', 'spam');
  });

  it('bans an account from Daily Rewards with the moderator reason', async () => {
    const setDailyRewardsBan = vi.fn(async () => {});
    authedAdminDb({ setDailyRewardsBan });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/daily-rewards-ban', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'automated play', durationHours: 12 },
    });
    expect(r.status).toBe(200);
    expect(setDailyRewardsBan).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      banned: true,
      reason: 'automated play',
      durationHours: 12,
    });
  });

  it('bans an account IP from Daily Rewards with the moderator reason', async () => {
    const setDailyRewardsIpBan = vi.fn(async () => {});
    authedAdminDb({ setDailyRewardsIpBan });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/daily-rewards-ip-ban', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { ip: '203.0.113.4', reason: 'multi-account abuse' },
    });
    expect(r.status).toBe(200);
    expect(setDailyRewardsIpBan).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      ip: '203.0.113.4',
      banned: true,
      reason: 'multi-account abuse',
    });
  });

  it('returns a bounded Daily Rewards point event log for a validated date', async () => {
    const dailyRewardPointEvents = vi.fn(async () => ({
      day: '2026-07-16',
      rows: [],
      total: 0,
      truncated: false,
    }));
    authedAdminDb({ dailyRewardPointEvents });
    installAdminRuntime();

    const response = await runRoute('GET', '/admin/api/accounts/:id/daily-rewards-events', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/admin/api/accounts/5/daily-rewards-events?day=2026-07-16&limit=100',
    });

    expect(response.status).toBe(200);
    expect(dailyRewardPointEvents).toHaveBeenCalledWith(5, '2026-07-16', 100);
  });

  it('defaults the Daily Rewards point event log to the server reward day', async () => {
    const dailyRewardPointEvents = vi.fn(async (_accountId: number, day: string) => ({
      day,
      rows: [],
      total: 0,
      truncated: false,
    }));
    authedAdminDb({ dailyRewardPointEvents });
    installAdminRuntime();

    const response = await runRoute('GET', '/admin/api/accounts/:id/daily-rewards-events', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/admin/api/accounts/5/daily-rewards-events?limit=100',
    });

    expect(response.status).toBe(200);
    expect(dailyRewardPointEvents).toHaveBeenCalledWith(
      5,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      100,
    );
  });

  it('rejects an invalid Daily Rewards point event date', async () => {
    const dailyRewardPointEvents = vi.fn();
    authedAdminDb({ dailyRewardPointEvents });
    installAdminRuntime();

    const response = await runRoute('GET', '/admin/api/accounts/:id/daily-rewards-events', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      url: '/admin/api/accounts/5/daily-rewards-events?day=2026-02-30',
    });

    expect(response.status).toBe(400);
    expect(dailyRewardPointEvents).not.toHaveBeenCalled();
  });

  it('force-rename disconnects the character owner', async () => {
    authedAdminDb({ forceCharacterRename: async () => ({ accountId: 88 }) });
    const rt = installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/characters/:id/force-rename', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'bad name' },
    });
    expect(rt.disconnectAccount).toHaveBeenCalledWith(
      88,
      'A moderator requires one of your characters to be renamed.',
    );
  });

  it('reset-strikes pushes the live reset when a row was updated', async () => {
    authedAdminDb({ resetChatStrikesAudited: async () => true });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reset-strikes', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(200);
    expect(rt.resetChatStrikesLive).toHaveBeenCalledWith(5);
  });

  it('a chat-filter word add reloads the live filter', async () => {
    authedAdminDb({ addFilterWord: async () => true });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words', {
      headers: { authorization: BEARER },
      body: { word: 'bad', tier: 'soft' },
    });
    expect(r.status).toBe(200);
    expect(rt.reloadChatFilter).toHaveBeenCalledTimes(1);
  });

  it('the best-effort mail is ISOLATED: a moderateAccount success still 200s even if a target lookup rejects', async () => {
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () => {
        throw new Error('mail db down');
      },
      revokeTokensExcept: vi.fn(async () => {}),
    });
    const rt = installAdminRuntime();
    // The email is fired as a void .then().catch(), so the 200 is written synchronously
    // after moderateAccount + disconnect; a later mail rejection cannot fail the action.
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'ban' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(rt.disconnectAccount).toHaveBeenCalledWith(5, 'This account has been banned.');
  });
});

// ---------------------------------------------------------------------------
// 7. Guards + 404s preserved.
// ---------------------------------------------------------------------------

describe('guards + not-found bodies preserved', () => {
  it('400s a suspend on an ADMIN target (admin accounts cannot be suspended or banned)', async () => {
    const moderateAccount = vi.fn(async () => {});
    authedAdminDb({ moderateAccount });
    installAdminRuntime();
    // Target the admin id: isAdminAccount(ADMIN_ACCOUNT_ID) is true.
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: String(ADMIN_ACCOUNT_ID), action: 'ban' },
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'admin accounts cannot be suspended or banned',
    });
    expect(moderateAccount).not.toHaveBeenCalled();
  });

  it('400s a chat-mute on an ADMIN target (admin accounts cannot be chat muted)', async () => {
    authedAdminDb({ muteAccountChat: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/chat-mute', {
      headers: { authorization: BEARER },
      params: { id: String(ADMIN_ACCOUNT_ID) },
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'admin accounts cannot be chat muted',
    });
  });

  it('400s a chat-filter word with an invalid tier', async () => {
    authedAdminDb();
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words', {
      headers: { authorization: BEARER },
      body: { word: 'x', tier: 'medium' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'tier must be "soft" or "hard"' });
  });

  it('404s an ignore on a report that is not open', async () => {
    authedAdminDb({ ignoreReport: async () => false });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/reports/:id/ignore', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'open report not found' });
  });

  it('404s a word delete that removed nothing', async () => {
    authedAdminDb({ removeFilterWord: async () => false });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words/:id/delete', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'word not found' });
    // A miss does NOT reload the live filter.
    expect(rt.reloadChatFilter).not.toHaveBeenCalled();
  });

  it('404s a blocked-ips/delete that removed nothing (after a valid ip)', async () => {
    authedAdminDb({ cleanIp: () => '9.9.9.9', removeBlockedIp: async () => false });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips/delete', {
      headers: { authorization: BEARER },
      body: { ip: '9.9.9.9' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'IP not found' });
  });

  it('404s an accounts/:id detail for an absent account (handler-owned, NOT the loader)', async () => {
    authedAdminDb({ accountDetail: async () => null });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/accounts/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'account not found' });
  });
});

// ---------------------------------------------------------------------------
// 8. adminBodyValidationRemap: an unexpected throw becomes a 500 admin envelope.
// ---------------------------------------------------------------------------

describe('adminBodyValidationRemap (unexpected 500)', () => {
  it('serializes an unexpected throw as a 500 { success:false, data:null, error:"internal.error" }', async () => {
    authedAdminDb({
      overviewCounts: async () => {
        throw new Error('db exploded');
      },
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, data: null, error: 'internal.error' });
    expect(r.contentType).toBe('application/json');
    // The admin envelope, NOT problem+json.
    expect(r.contentType).not.toBe('application/problem+json');
  });
});

// ---------------------------------------------------------------------------
// 9. Route wiring sanity via apiRegistry (the registry the dispatcher queries).
// ---------------------------------------------------------------------------

describe('admin route wiring (apiRegistry.resolve)', () => {
  it('resolves the login route to a matched RouteDef', () => {
    expect(apiRegistry.resolve('POST', '/admin/api/login').kind).toBe('matched');
  });

  it('resolves a wrong method on a migrated read to methodNotAllowed (delegated to legacy)', () => {
    const result = apiRegistry.resolve('PUT', '/admin/api/overview');
    expect(result.kind).toBe('methodNotAllowed');
    if (result.kind === 'methodNotAllowed') {
      expect(result.allow).toContain('GET');
    }
  });

  it('resolves an unknown admin path to notFound (delegated to legacy handleAdminApi)', () => {
    expect(apiRegistry.resolve('GET', '/admin/api/does-not-exist').kind).toBe('notFound');
  });
});

// ---------------------------------------------------------------------------
// 10. Migrated read handlers: response bodies + query semantics (QA gate).
// The authed parity harness defers every admin read (pool-less), so these tests
// are what pins each migrated read's byte-parity with its frozen legacy branch.
// ---------------------------------------------------------------------------

describe('migrated read handlers (QA gate parity coverage)', () => {
  it('online returns the live sessions as { players }', async () => {
    authedAdminDb();
    installAdminRuntime({ liveSessions: vi.fn(() => [{ name: 'Indexa', level: 13 }]) });
    const r = await runRoute('GET', '/admin/api/online', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { players: [{ name: 'Indexa', level: 13 }] },
      error: null,
    });
  });

  it('suspicious-players returns the bot-detector flags as { players }', async () => {
    authedAdminDb();
    installAdminRuntime({ suspiciousPlayers: vi.fn(() => [{ name: 'Botly', score: 0.9 }]) });
    const r = await runRoute('GET', '/admin/api/suspicious-players', {
      headers: { authorization: BEARER },
    });
    expect(r.body).toEqual({
      success: true,
      data: { players: [{ name: 'Botly', score: 0.9 }] },
      error: null,
    });
  });

  it('online-history passes the range query through (default 30d)', async () => {
    const onlineHistory = vi.fn(async (range: string) => ({ range, buckets: [] }));
    authedAdminDb({ onlineHistory });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/online-history', {
      url: '/admin/api/online-history?range=7d',
      headers: { authorization: BEARER },
    });
    expect(onlineHistory).toHaveBeenCalledWith('7d');
    expect(r.body).toEqual({ success: true, data: { range: '7d', buckets: [] }, error: null });
    await runRoute('GET', '/admin/api/online-history', { headers: { authorization: BEARER } });
    expect(onlineHistory).toHaveBeenLastCalledWith('30d');
  });

  it('activity reads the 30-day window and keeps the days/registrations/sessions/classes/levels shape', async () => {
    const registrationsByDay = vi.fn(async () => [{ day: 'd', count: 1 }]);
    const sessionsByDay = vi.fn(async () => [{ day: 'd', count: 2 }]);
    authedAdminDb({
      registrationsByDay,
      sessionsByDay,
      classDistribution: async () => [{ class: 'warrior', count: 3 }],
      levelDistribution: async () => [{ level: 1, count: 4 }],
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/activity', { headers: { authorization: BEARER } });
    expect(registrationsByDay).toHaveBeenCalledWith(30);
    expect(sessionsByDay).toHaveBeenCalledWith(30);
    expect(r.body).toEqual({
      success: true,
      data: {
        days: 30,
        registrations: [{ day: 'd', count: 1 }],
        sessions: [{ day: 'd', count: 2 }],
        classes: [{ class: 'warrior', count: 3 }],
        levels: [{ level: 1, count: 4 }],
      },
      error: null,
    });
  });

  it('perf/summary passes the hours query through (default 24) and the body is the bare passthrough', async () => {
    const clientPerfSummary = vi.fn(async (hours: number) => ({ hours, avgFps: 58 }));
    authedAdminDb({ clientPerfSummary });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/perf/summary', {
      url: '/admin/api/perf/summary?hours=12',
      headers: { authorization: BEARER },
    });
    expect(clientPerfSummary).toHaveBeenCalledWith(12);
    // The summary rides UNWRAPPED as data (legacy ok(res, await clientPerfSummary(...))):
    // a reshape (e.g. { summary: ... }) would break the dashboard at the flag flip.
    expect(r.body).toEqual({ success: true, data: { hours: 12, avgFps: 58 }, error: null });
    await runRoute('GET', '/admin/api/perf/summary', { headers: { authorization: BEARER } });
    expect(clientPerfSummary).toHaveBeenLastCalledWith(24);
  });

  it('perf/raw preserves the keyset math: a full page reports hasMore with the last-row cursor', async () => {
    const clientPerfRaw = vi.fn(async () => [{ id: 9 }, { id: 7 }]);
    authedAdminDb({ clientPerfRaw });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/perf/raw', {
      url: '/admin/api/perf/raw?hours=48&limit=2&beforeId=50',
      headers: { authorization: BEARER },
    });
    expect(clientPerfRaw).toHaveBeenCalledWith(48, 2, 50);
    // Two rows on a limit of 2: the page is full, so hasMore is true and the cursor
    // is the LAST row's id (keyset pagination), exactly the legacy math.
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 9 }, { id: 7 }], nextBeforeId: 7, hasMore: true },
      error: null,
    });
  });

  it('perf/raw reports hasMore false on a short page and a null cursor on an empty one', async () => {
    authedAdminDb({ clientPerfRaw: async () => [{ id: 9 }] });
    installAdminRuntime();
    const short = await runRoute('GET', '/admin/api/perf/raw', {
      url: '/admin/api/perf/raw?limit=2',
      headers: { authorization: BEARER },
    });
    expect(short.body).toEqual({
      success: true,
      data: { rows: [{ id: 9 }], nextBeforeId: 9, hasMore: false },
      error: null,
    });
    const clientPerfRaw = vi.fn(async () => []);
    authedAdminDb({ clientPerfRaw });
    const empty = await runRoute('GET', '/admin/api/perf/raw', {
      headers: { authorization: BEARER },
    });
    // An absent beforeId reaches the db read as undefined (a fresh first page).
    expect(clientPerfRaw).toHaveBeenCalledWith(24, 100, undefined);
    expect(empty.body).toEqual({
      success: true,
      data: { rows: [], nextBeforeId: null, hasMore: false },
      error: null,
    });
  });

  it('shared-ips online=1 serves the live slice: sorted, paged, with per-row blocked flags', async () => {
    authedAdminDb();
    installAdminRuntime({
      liveSharedIps: vi.fn(() => [
        { ip: '1.1.1.1', accountCount: 1, lastSeenAt: '2026-01-01' },
        { ip: '2.2.2.2', accountCount: 3, lastSeenAt: '2026-01-02' },
        { ip: '3.3.3.3', accountCount: 2, lastSeenAt: '2026-01-03' },
      ]),
      isIpBlocked: vi.fn((ip: string) => ip === '2.2.2.2'),
    });
    const r = await runRoute('GET', '/admin/api/shared-ips', {
      url: '/admin/api/shared-ips?online=1&page=1&limit=2',
      headers: { authorization: BEARER },
    });
    // Default sort: accountCount desc; page 1 with limit 2 slices the top two rows.
    expect(r.body).toEqual({
      success: true,
      data: {
        rows: [
          { ip: '2.2.2.2', accountCount: 3, lastSeenAt: '2026-01-02', blocked: true },
          { ip: '3.3.3.3', accountCount: 2, lastSeenAt: '2026-01-03', blocked: false },
        ],
        total: 3,
        page: 1,
        limit: 2,
      },
      error: null,
    });
  });

  it('shared-ips DB branch passes page/limit/sort/dir through and maps blocked per row', async () => {
    const listSharedIps = vi.fn(async (page: number, limit: number, sort: string, dir: string) => ({
      rows: [{ ip: '9.9.9.9', accountCount: 2, lastSeenAt: '2026-01-01' }],
      total: 1,
      page,
      limit,
      sort,
      dir,
    }));
    authedAdminDb({ listSharedIps });
    installAdminRuntime({ isIpBlocked: vi.fn(() => true) });
    const r = await runRoute('GET', '/admin/api/shared-ips', {
      url: '/admin/api/shared-ips?page=2&limit=5&sort=last_seen&dir=asc',
      headers: { authorization: BEARER },
    });
    expect(listSharedIps).toHaveBeenCalledWith(2, 5, 'last_seen', 'asc');
    expect(r.body).toEqual({
      success: true,
      data: {
        rows: [{ ip: '9.9.9.9', accountCount: 2, lastSeenAt: '2026-01-01', blocked: true }],
        total: 1,
        page: 2,
        limit: 5,
        sort: 'last_seen',
        dir: 'asc',
      },
      error: null,
    });
  });

  it('ip-associations maps live online flags onto the accounts and adds the blocked flag', async () => {
    const associationsForIp = vi.fn(async (ip: string, page: number, limit: number) => ({
      ip,
      accounts: [{ accountId: 2 }, { accountId: 3 }],
      total: 2,
      page,
      limit,
    }));
    authedAdminDb({ cleanIp: () => '9.9.9.9', associationsForIp });
    installAdminRuntime({
      liveAccountIds: vi.fn(() => new Set([2])),
      isIpBlocked: vi.fn(() => true),
    });
    const r = await runRoute('GET', '/admin/api/ip-associations', {
      url: '/admin/api/ip-associations?ip=9.9.9.9&page=1&limit=25',
      headers: { authorization: BEARER },
    });
    expect(associationsForIp).toHaveBeenCalledWith('9.9.9.9', 1, 25);
    expect(r.body).toEqual({
      success: true,
      data: {
        ip: '9.9.9.9',
        accounts: [
          { accountId: 2, online: true },
          { accountId: 3, online: false },
        ],
        total: 2,
        page: 1,
        limit: 25,
        blocked: true,
        blockable: true,
      },
      error: null,
    });
  });

  it('ip-associations reads the stored unknown marker without treating it as blockable', async () => {
    const associationsForIp = vi.fn(async (ip: string, page: number, limit: number) => ({
      ip,
      accounts: [{ accountId: 20 }],
      total: 1,
      page,
      limit,
    }));
    authedAdminDb({ associationsForIp });
    const rt = installAdminRuntime();

    const r = await runRoute('GET', '/admin/api/ip-associations', {
      url: '/admin/api/ip-associations?ip=unknown&page=1&limit=25',
      headers: { authorization: BEARER },
    });

    expect(associationsForIp).toHaveBeenCalledWith('unknown', 1, 25);
    expect(rt.isIpBlocked).not.toHaveBeenCalled();
    expect(r.body).toEqual({
      success: true,
      data: {
        ip: 'unknown',
        accounts: [{ accountId: 20, online: false }],
        total: 1,
        page: 1,
        limit: 25,
        blocked: false,
        blockable: false,
      },
      error: null,
    });
  });

  it('moderation/queue passes the live account ids to the queue read', async () => {
    const live = new Set([1, 2]);
    const moderationQueue = vi.fn(async () => [{ accountId: 1, openReports: 2 }]);
    authedAdminDb({ moderationQueue });
    installAdminRuntime({ liveAccountIds: vi.fn(() => live) });
    const r = await runRoute('GET', '/admin/api/moderation/queue', {
      headers: { authorization: BEARER },
    });
    expect(moderationQueue).toHaveBeenCalledWith(live);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ accountId: 1, openReports: 2 }] },
      error: null,
    });
  });

  it('moderation/history scopes tab reads to the current admin account', async () => {
    const listModerationActions = vi.fn(async () => ({ rows: [], total: 0, page: 2, limit: 100 }));
    authedAdminDb({ listModerationActions });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/moderation/history', {
      headers: { authorization: BEARER },
      url: '/admin/api/moderation/history?tab=notes&page=2&limit=100',
    });
    expect(listModerationActions).toHaveBeenCalledWith('notes', ADMIN_ACCOUNT_ID, 2, 100);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [], total: 0, page: 2, limit: 100 },
      error: null,
    });
  });

  it('moderation/accounts/:id composes the account/reports/chat/blockedIps detail', async () => {
    const detail = {
      id: 5,
      username: 'bob',
      lastLoginIp: '1.1.1.1',
      recentSessions: [{ ip: '2.2.2.2' }, { ip: null }],
    };
    authedAdminDb({
      accountDetail: async () => detail,
      moderationReportsForAccount: async () => [{ id: 11 }],
      chatModerationForAccount: async () => ({ strikes: 1 }),
    });
    installAdminRuntime({
      liveAccountIds: vi.fn(() => new Set([5])),
      isIpBlocked: vi.fn((ip: string) => ip === '2.2.2.2'),
    });
    const r = await runRoute('GET', '/admin/api/moderation/accounts/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    // The detail spreads whole (online merged in); blockedIps keeps only the
    // login/session IPs the live blocker recognizes.
    expect(r.body).toEqual({
      success: true,
      data: {
        account: { ...detail, online: true },
        reports: [{ id: 11 }],
        chat: { strikes: 1 },
        blockedIps: ['2.2.2.2'],
      },
      error: null,
    });
  });

  it('404s the moderation detail for an absent account (handler-owned prose)', async () => {
    authedAdminDb({
      accountDetail: async () => null,
      moderationReportsForAccount: async () => [],
      chatModerationForAccount: async () => ({}),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/moderation/accounts/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'account not found' });
  });

  it('accounts/:id merges the live online flag into the detail', async () => {
    authedAdminDb({ accountDetail: async () => ({ id: 5, username: 'bob' }) });
    installAdminRuntime({ liveAccountIds: vi.fn(() => new Set([5])) });
    const r = await runRoute('GET', '/admin/api/accounts/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.body).toEqual({
      success: true,
      data: { id: 5, username: 'bob', online: true },
      error: null,
    });
  });

  it('chat-filter returns the soft/hard word lists, the config, and the moderated accounts', async () => {
    const listFilterWords = vi.fn(async (tier: string) =>
      tier === 'soft' ? [{ id: 1, word: 'darn' }] : [{ id: 2, word: 'worse' }],
    );
    authedAdminDb({
      listFilterWords,
      getFilterConfig: async () => ({ warningsBeforeMute: 3 }),
      chatModeratedAccounts: async () => [{ accountId: 9 }],
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/chat-filter', {
      headers: { authorization: BEARER },
    });
    expect(listFilterWords).toHaveBeenCalledWith('soft');
    expect(listFilterWords).toHaveBeenCalledWith('hard');
    expect(r.body).toEqual({
      success: true,
      data: {
        soft: [{ id: 1, word: 'darn' }],
        hard: [{ id: 2, word: 'worse' }],
        config: { warningsBeforeMute: 3 },
        accounts: [{ accountId: 9 }],
      },
      error: null,
    });
  });

  it('bug-reports/:id/screenshot returns the on-demand screenshot payload', async () => {
    const getBugReportScreenshot = vi.fn(async () => 'data:image/png;base64,abc');
    authedAdminDb({ getBugReportScreenshot });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/bug-reports/:id/screenshot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(getBugReportScreenshot).toHaveBeenCalledWith(5);
    expect(r.body).toEqual({
      success: true,
      data: { screenshot: 'data:image/png;base64,abc' },
      error: null,
    });
  });

  it('characters passes search/sort/dir/page/limit through (dir whitelisted, sort defaults to level)', async () => {
    const listCharacters = vi.fn(async () => ({ rows: [{ id: 3, name: 'Bob' }], total: 1 }));
    authedAdminDb({ listCharacters });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/characters', {
      url: '/admin/api/characters?search=bob&sort=name&dir=asc&page=2&limit=10',
      headers: { authorization: BEARER },
    });
    expect(listCharacters).toHaveBeenCalledWith('bob', 'name', 'asc', 2, 10);
    // The db result rides UNWRAPPED as data (legacy ok(res, await listCharacters(...))).
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 3, name: 'Bob' }], total: 1 },
      error: null,
    });
    await runRoute('GET', '/admin/api/characters', {
      // Anything but asc coerces to desc; search/sort/page/limit take their defaults.
      url: '/admin/api/characters?dir=sideways',
      headers: { authorization: BEARER },
    });
    expect(listCharacters).toHaveBeenLastCalledWith('', 'level', 'desc', 1, 25);
  });
});

// ---------------------------------------------------------------------------
// 11. Migrated write handlers: remaining side effects + branches (QA gate).
// ---------------------------------------------------------------------------

describe('migrated write handlers + side effects (QA gate parity coverage)', () => {
  it('lift-mute records the lift and pushes the live unmute', async () => {
    const liftAccountChatMute = vi.fn(async () => {});
    authedAdminDb({ liftAccountChatMute });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/lift-mute', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appealed' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(liftAccountChatMute).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: 'appealed',
    });
    expect(rt.liftChatMuteLive).toHaveBeenCalledWith(5);
  });

  it('reactivate forwards the reason and admin id to the audited reactivation', async () => {
    const reactivateAccountAudited = vi.fn(async () => {});
    authedAdminDb({ reactivateAccountAudited });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(reactivateAccountAudited).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: 'appeal accepted',
    });
  });

  it('reset-strikes forwards the reason and admin id to the audited reset', async () => {
    const resetChatStrikesAudited = vi.fn(async () => true);
    authedAdminDb({ resetChatStrikesAudited });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reset-strikes', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(resetChatStrikesAudited).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: 'appeal accepted',
    });
    expect(rt.resetChatStrikesLive).toHaveBeenCalledWith(5);
  });

  it('note appends the audit note from body.reason (the legacy field name)', async () => {
    const addAccountNote = vi.fn(async () => {});
    authedAdminDb({ addAccountNote });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/note', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'watch this one' },
    });
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(addAccountNote).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      note: 'watch this one',
    });
  });

  it('a suspend actually sends the security-incident mail with the derived reason + until', async () => {
    const target = { id: 5, username: 'x', email: 'x@y.z', locale: 'en', marketing_opt_in: false };
    const emailSecurityIncident = vi.fn();
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () => target,
      emailSecurityIncident,
      revokeTokensExcept: vi.fn(async () => {}),
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'suspend' },
      body: { reason: '  griefing ', expiresAt: '2030-02-01' },
    });
    expect(r.status).toBe(200);
    // The mail rides a floating void promise chain; flush it before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    // The reason is trimmed; a suspend carries the expiresAt string as the until.
    expect(emailSecurityIncident).toHaveBeenCalledWith(target, 'suspend', 'griefing', '2030-02-01');
  });

  it('a ban without a reason mails "not specified" + "permanent"', async () => {
    const target = { id: 5, username: 'x', email: 'x@y.z', locale: 'en', marketing_opt_in: false };
    const emailSecurityIncident = vi.fn();
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () => target,
      emailSecurityIncident,
      revokeTokensExcept: vi.fn(async () => {}),
    });
    installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'ban' },
      body: {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emailSecurityIncident).toHaveBeenCalledWith(target, 'ban', 'not specified', 'permanent');
  });

  it('no mail is sent when the account has no mail target', async () => {
    const emailSecurityIncident = vi.fn();
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () => null,
      emailSecurityIncident,
    });
    installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'suspend' },
      body: {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emailSecurityIncident).not.toHaveBeenCalled();
  });

  it('a successful blocked-ips/delete reloads the live block list', async () => {
    const removeBlockedIp = vi.fn(async () => true);
    authedAdminDb({ cleanIp: () => '9.9.9.9', removeBlockedIp });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips/delete', {
      headers: { authorization: BEARER },
      body: { ip: '9.9.9.9' },
    });
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(removeBlockedIp).toHaveBeenCalledWith('9.9.9.9', ADMIN_ACCOUNT_ID);
    expect(rt.reloadBlockedIps).toHaveBeenCalledTimes(1);
  });

  it('a successful word delete reloads the live filter', async () => {
    const removeFilterWord = vi.fn(async () => true);
    authedAdminDb({ removeFilterWord });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words/:id/delete', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(removeFilterWord).toHaveBeenCalledWith(5);
    expect(rt.reloadChatFilter).toHaveBeenCalledTimes(1);
  });

  it('chat-filter/config returns the UPDATED CONFIG object (not ok:true) and reloads the filter', async () => {
    const updateFilterConfig = vi.fn(async () => ({
      warningsBeforeMute: 2,
      muteLadderSeconds: [60, 300],
    }));
    authedAdminDb({ updateFilterConfig });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/config', {
      headers: { authorization: BEARER },
      body: { warningsBeforeMute: 2, muteLadderSeconds: [60, 300] },
    });
    expect(updateFilterConfig).toHaveBeenCalledWith({
      warningsBeforeMute: 2,
      muteLadderSeconds: [60, 300],
    });
    expect(rt.reloadChatFilter).toHaveBeenCalledTimes(1);
    // The config route answers with the updated config itself, a distinct body shape.
    expect(r.body).toEqual({
      success: true,
      data: { warningsBeforeMute: 2, muteLadderSeconds: [60, 300] },
      error: null,
    });
  });

  it('404s a reset-strikes for an unknown account and skips the live push', async () => {
    authedAdminDb({ resetChatStrikesAudited: async () => false });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reset-strikes', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'account not found' });
    expect(rt.resetChatStrikesLive).not.toHaveBeenCalled();
  });

  it('a successful report ignore resolves ok:true with the note from the body', async () => {
    const ignoreReport = vi.fn(async () => true);
    authedAdminDb({ ignoreReport });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/reports/:id/ignore', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { note: 'duplicate' },
    });
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(ignoreReport).toHaveBeenCalledWith(5, ADMIN_ACCOUNT_ID, 'duplicate');
  });
});

// ---------------------------------------------------------------------------
// 12. Re-verification pins (the admin-migration audit): the overview merge math, the
// catch -> 400 err.message remaps, and the remaining legacy guard negatives.
// ---------------------------------------------------------------------------

describe('overview merge math (the one non-trivial read computation)', () => {
  it('pins the full merged body: both peak Math.max merges and server.peakOnline (usage moved to provider-usage)', async () => {
    // Values chosen so each non-trivial Math.max argument WINS somewhere: live online
    // (3) beats peakOnlineToday (1); db peakOnlineAllTime (100) beats live online AND
    // is the winning middle argument of server.peakOnline (over live peakOnline 5).
    // Dropping any merge argument changes the asserted body. The provider-usage
    // snapshot deliberately does NOT ride here anymore: it moved to its own
    // ops_usage.read route (release v0.22.0), pinned by the provider-usage test.
    const providerUsageSnapshot = vi.fn(() => ({ generatedAt: 9 }));
    authedAdminDb({
      overviewCounts: async () => ({ accounts: 4, peakOnlineToday: 1, peakOnlineAllTime: 100 }),
      providerUsageSnapshot,
    });
    installAdminRuntime();
    // A distinctive cap (not colliding with any other body number) proves this arm
    // reads the injected canonicalPlayersCap source, not a hardcoded 0 or a stat.
    configureAdminPlayersCap(() => 4242);
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        accounts: 4,
        peakOnlineToday: 3,
        peakOnlineAllTime: 100,
        playersCap: 4242,
        server: {
          online: 3,
          onlineAccounts: 2,
          peakOnline: 100,
          uptimeSeconds: 100,
          tickMsAvg: 1,
          simEntities: 10,
          rssBytes: 1,
          heapUsedBytes: 1,
        },
      },
      error: null,
    });
    expect(providerUsageSnapshot).not.toHaveBeenCalled();
  });

  it('serves playersCap 0 when the cap source is unconfigured (graceful default)', async () => {
    // adminPlayersCap() returns 0 (it does NOT throw) when configureAdminPlayersCap was
    // never wired, so a boot-wiring gap degrades this one cosmetic field to the same
    // "cap disabled" sentinel canonicalPlayersCap emits, instead of failing the whole
    // overview. Pin that false branch of the accessor.
    authedAdminDb({
      overviewCounts: async () => ({ accounts: 0, peakOnlineToday: 0, peakOnlineAllTime: 0 }),
    });
    installAdminRuntime();
    resetAdminPlayersCapForTests();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect((r.body as { data: { playersCap: number } }).data.playersCap).toBe(0);
  });

  it('GET /admin/api/provider-usage serves the usage snapshot on its own route', async () => {
    const usage = { generatedAt: 9, windows: ['w'], metrics: ['m'], caches: ['c'] };
    authedAdminDb({ providerUsageSnapshot: () => usage });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/provider-usage', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { usage }, error: null });
  });
});

// ---------------------------------------------------------------------------
// 12b. Overview player-cap boot wiring + dual-arm structural pins. main.ts cannot
// be imported (it boots a server on import), so the boot wiring is verified by
// source text (the tests/server/main_retention_wiring.test.ts idiom), comment-
// stripped so a commented-out call can never satisfy a pin.
// ---------------------------------------------------------------------------

describe('overview player-cap wiring', () => {
  const stripLineComments = (s: string): string => s.replace(/\/\/[^\n]*/g, '');
  const MAIN = stripLineComments(
    readFileSync(join(__dirname, '..', '..', 'server', 'main.ts'), 'utf8'),
  );
  const ADMIN = stripLineComments(
    readFileSync(join(__dirname, '..', '..', 'server', 'admin.ts'), 'utf8'),
  );

  it('main.ts feeds canonicalPlayersCap into configureAdminPlayersCap at boot', () => {
    // Without this wiring the accessor silently defaults to 0 and no unit test reds
    // (each injects its own source). The CALL-form token '(canonicalPlayersCap)' cannot
    // be satisfied by the import line, which lists the bare identifier.
    expect(MAIN).toContain('configureAdminPlayersCap(canonicalPlayersCap)');
  });

  it('both overview arms read the ONE injected cap accessor (dual-arm agreement)', () => {
    // The legacy handleAdminApi branch and the RouteDef overviewHandler must both source
    // the cap from adminPlayersCap(), so the field cannot diverge across the two dispatch
    // paths; exactly two call sites, one per arm. A hardcoded value or a divergent source
    // in either arm drops the count.
    const hits = ADMIN.match(/playersCap: adminPlayersCap\(\)/g) ?? [];
    expect(hits).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Release v0.22.0 arrivals: staff identity/roles + the antibot-config family.
// Each pins the migrated handler byte-identical to its legacy twin.
// ---------------------------------------------------------------------------

describe('staff identity + role management (release v0.22.0)', () => {
  it('GET /admin/api/me returns the caller identity with expanded permissions', async () => {
    authedAdminDb({
      adminRolesForAccount: async () => ({ username: 'op', roles: ['viewer'] }),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/me', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        username: 'op',
        roles: ['viewer'],
        permissions: ['analytics.read', 'accounts.read', 'support.read', 'moderation.read'],
      },
      error: null,
    });
  });

  it('GET /admin/api/staff lists rows plus the dashboard-assignable roles (no superadmin)', async () => {
    authedAdminDb({
      listStaff: async () => [{ accountId: 1, username: 'op', roles: ['admin'] }],
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/staff', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        rows: [{ accountId: 1, username: 'op', roles: ['admin'] }],
        assignableRoles: ['admin', 'moderator', 'viewer'],
      },
      error: null,
    });
  });

  it('GET /admin/api/staff/history reads the 50 most recent audit rows', async () => {
    const roleChangeHistory = vi.fn(async () => [{ id: 1 }]);
    authedAdminDb({ roleChangeHistory });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/staff/history', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { rows: [{ id: 1 }] }, error: null });
    expect(roleChangeHistory).toHaveBeenCalledWith(50);
  });

  it('POST /admin/api/staff/roles applies a change and kicks the target live sessions', async () => {
    const setAccountAdminRoles = vi.fn(async () => ({ before: ['viewer'], after: ['moderator'] }));
    authedAdminDb({
      findAccount: async () => ({ id: 42, username: 'mika' }) as never,
      adminRolesForAccount: async (id: number) =>
        id === ADMIN_ACCOUNT_ID
          ? { username: 'op', roles: ['superadmin'] }
          : { username: 'mika', roles: ['viewer'] },
      setAccountAdminRoles,
    });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/staff/roles', {
      headers: { authorization: BEARER },
      body: { username: 'mika', roles: ['moderator'] },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { ok: true, username: 'mika', roles: ['moderator'] },
      error: null,
    });
    expect(setAccountAdminRoles).toHaveBeenCalledWith({
      accountId: 42,
      roles: ['moderator'],
      actorAccountId: ADMIN_ACCOUNT_ID,
    });
    // The roles changed, so the target's live sessions are force-disconnected
    // (in-game permissions are snapshotted at WS join).
    expect(rt.disconnectAccount).toHaveBeenCalledWith(42, 'Connection to the server was lost.');
  });

  it('does NOT kick when the role set is unchanged', async () => {
    authedAdminDb({
      findAccount: async () => ({ id: 42, username: 'mika' }) as never,
      adminRolesForAccount: async (id: number) =>
        id === ADMIN_ACCOUNT_ID
          ? { username: 'op', roles: ['superadmin'] }
          : { username: 'mika', roles: ['viewer'] },
      setAccountAdminRoles: async () => ({ before: ['viewer'], after: ['viewer'] }),
    });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/staff/roles', {
      headers: { authorization: BEARER },
      body: { username: 'mika', roles: ['viewer'] },
    });
    expect(r.status).toBe(200);
    expect(rt.disconnectAccount).not.toHaveBeenCalled();
  });

  it('400s an unknown role, a superadmin grant, and an own-account edit; 404s a missing target', async () => {
    const cases: Array<{ body: Record<string, unknown>; status: number; error: string }> = [
      { body: { username: 'mika', roles: ['owner'] }, status: 400, error: 'unknown role' },
      {
        body: { username: 'mika', roles: ['superadmin'] },
        status: 400,
        error: 'superadmin roles are managed via the grant script',
      },
      { body: { username: 'ghost', roles: ['viewer'] }, status: 404, error: 'account not found' },
      {
        body: { username: 'op', roles: ['viewer'] },
        status: 400,
        error: 'you cannot change your own roles',
      },
    ];
    for (const c of cases) {
      const setAccountAdminRoles = vi.fn();
      authedAdminDb({
        findAccount: async (username: string) =>
          username === 'ghost'
            ? null
            : ({ id: username === 'op' ? ADMIN_ACCOUNT_ID : 42, username } as never),
        setAccountAdminRoles,
      });
      installAdminRuntime();
      const r = await runRoute('POST', '/admin/api/staff/roles', {
        headers: { authorization: BEARER },
        body: c.body,
      });
      expect(r.status, JSON.stringify(c.body)).toBe(c.status);
      expect(r.body).toEqual({ success: false, data: null, error: c.error });
      expect(setAccountAdminRoles).not.toHaveBeenCalled();
    }
  });

  it('refuses to edit a target that currently holds superadmin', async () => {
    const setAccountAdminRoles = vi.fn();
    authedAdminDb({
      findAccount: async () => ({ id: 42, username: 'root' }) as never,
      adminRolesForAccount: async (id: number) =>
        id === ADMIN_ACCOUNT_ID
          ? { username: 'op', roles: ['superadmin'] }
          : { username: 'root', roles: ['superadmin'] },
      setAccountAdminRoles,
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/staff/roles', {
      headers: { authorization: BEARER },
      body: { username: 'root', roles: ['viewer'] },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'superadmin roles are managed via the grant script',
    });
    expect(setAccountAdminRoles).not.toHaveBeenCalled();
  });
});

describe('antibot-config family (release v0.22.0 #1433)', () => {
  const FIELDS = [
    { id: 'enforce', value: true, defaultValue: false },
    { id: 'kick_score', value: 1.0, defaultValue: 1.0 },
  ];

  it('GET /admin/api/antibot-config returns the live fields + last-saved stamp', async () => {
    authedAdminDb({
      loadAntibotConfig: async () => ({
        data: { enforce: true },
        updatedAt: '2026-07-05T00:00:00Z',
      }),
    });
    installAdminRuntime({ antibotConfigFields: vi.fn(() => FIELDS) });
    const r = await runRoute('GET', '/admin/api/antibot-config', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { fields: FIELDS, updatedAt: '2026-07-05T00:00:00Z' },
      error: null,
    });
  });

  it('GET /admin/api/antibot-config/history returns the audit entries', async () => {
    authedAdminDb({ listAntibotConfigHistory: async () => [{ id: 3 }] });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/antibot-config/history', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { entries: [{ id: 3 }] }, error: null });
  });

  it('POST /admin/api/antibot-config validates, applies live, persists the EFFECTIVE overrides, and answers the fresh fields', async () => {
    const saveAntibotConfigChange = vi.fn(async () => ({ updatedAt: '2026-07-05T00:00:01Z' }));
    authedAdminDb({ saveAntibotConfigChange });
    const applyAntibotConfig = vi.fn(() => ({ errors: [] as string[] }));
    // enforce differs from its default, kick_score does not: only enforce persists.
    installAdminRuntime({
      antibotConfigFields: vi.fn(() => FIELDS),
      applyAntibotConfig,
    });
    const r = await runRoute('POST', '/admin/api/antibot-config', {
      headers: { authorization: BEARER },
      body: { overrides: { enforce: true }, note: 'turn it on' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { fields: FIELDS, updatedAt: '2026-07-05T00:00:01Z' },
      error: null,
    });
    expect(applyAntibotConfig).toHaveBeenCalledWith({ enforce: true });
    expect(saveAntibotConfigChange).toHaveBeenCalledWith(
      { enforce: true },
      ADMIN_ACCOUNT_ID,
      'turn it on',
    );
  });

  it('400s a missing overrides object without touching the detector', async () => {
    const applyAntibotConfig = vi.fn(() => ({ errors: [] as string[] }));
    authedAdminDb({});
    installAdminRuntime({ applyAntibotConfig });
    const r = await runRoute('POST', '/admin/api/antibot-config', {
      headers: { authorization: BEARER },
      body: { overrides: [1, 2] },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'an overrides object is required',
    });
    expect(applyAntibotConfig).not.toHaveBeenCalled();
  });

  it('400s a rejected document, re-applies the previous effective overrides, persists nothing', async () => {
    const saveAntibotConfigChange = vi.fn();
    authedAdminDb({ saveAntibotConfigChange });
    // First call (the attempted apply) fails validation; the rollback re-apply follows.
    const applyAntibotConfig = vi
      .fn(() => ({ errors: [] as string[] }))
      .mockImplementationOnce(() => ({ errors: ['enforce: expected a boolean'] }));
    installAdminRuntime({
      antibotConfigFields: vi.fn(() => FIELDS),
      applyAntibotConfig,
    });
    const r = await runRoute('POST', '/admin/api/antibot-config', {
      headers: { authorization: BEARER },
      body: { overrides: { enforce: 'yes' } },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'enforce: expected a boolean',
    });
    // Call 1: the rejected document. Call 2: the rollback to the previous effective
    // set (enforce was the one non-default field before the attempt).
    expect(applyAntibotConfig).toHaveBeenNthCalledWith(1, { enforce: 'yes' });
    expect(applyAntibotConfig).toHaveBeenNthCalledWith(2, { enforce: true });
    expect(saveAntibotConfigChange).not.toHaveBeenCalled();
  });
});

describe('catch -> 400 err.message remap (legacy prose passthrough, per write handler)', () => {
  // Every migrated write handler reproduces the legacy try/catch that surfaces a thrown
  // domain Error verbatim as 400 { success:false, data:null, error: err.message }. The
  // dashboard keys on that prose, so pin the passthrough on each handler. The moderate
  // action uses 'unban' (no admin-target guard, no mail/disconnect side path).
  const CATCH_CASES: ReadonlyArray<{
    label: string;
    path: string;
    params?: Record<string, string>;
    fake: string;
  }> = [
    {
      label: 'moderate :action',
      path: '/admin/api/moderation/accounts/:id/:action',
      params: { id: '5', action: 'unban' },
      fake: 'moderateAccount',
    },
    {
      label: 'reactivate',
      path: '/admin/api/moderation/accounts/:id/reactivate',
      params: { id: '5' },
      fake: 'reactivateAccountAudited',
    },
    {
      label: 'chat-mute',
      path: '/admin/api/moderation/accounts/:id/chat-mute',
      params: { id: '5' },
      fake: 'muteAccountChat',
    },
    {
      label: 'force-rename',
      path: '/admin/api/moderation/characters/:id/force-rename',
      params: { id: '5' },
      fake: 'forceCharacterRename',
    },
    {
      label: 'lift-mute',
      path: '/admin/api/moderation/accounts/:id/lift-mute',
      params: { id: '5' },
      fake: 'liftAccountChatMute',
    },
    {
      label: 'note',
      path: '/admin/api/moderation/accounts/:id/note',
      params: { id: '5' },
      fake: 'addAccountNote',
    },
    {
      label: 'reset-strikes',
      path: '/admin/api/moderation/accounts/:id/reset-strikes',
      params: { id: '5' },
      fake: 'resetChatStrikesAudited',
    },
    { label: 'blocked-ips add', path: '/admin/api/blocked-ips', fake: 'addBlockedIp' },
  ];

  for (const c of CATCH_CASES) {
    it(`${c.label}: a thrown domain Error surfaces verbatim as the 400 error prose`, async () => {
      authedAdminDb({
        [c.fake]: async () => {
          throw new Error(`${c.label} exploded`);
        },
      });
      installAdminRuntime();
      const r = await runRoute('POST', c.path, {
        headers: { authorization: BEARER },
        params: c.params,
        body: c.label === 'blocked-ips add' ? { ip: '9.9.9.9' } : {},
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ success: false, data: null, error: `${c.label} exploded` });
    });
  }

  it('a NON-Error throw falls back to the per-route legacy prose (reactivation failed)', async () => {
    authedAdminDb({
      reactivateAccountAudited: async () => {
        // The legacy catch only reads .message off an Error; anything else gets the fallback.
        throw 'boom';
      },
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'appeal accepted' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'reactivation failed' });
  });
});

describe('remaining legacy guard negatives (re-verification audit)', () => {
  it('login 401s a wrong password for an EXISTING account (verifyPassword negative)', async () => {
    const verifyPassword = vi.fn(async () => false);
    setDb({
      rateLimited: allowedRateLimit,
      findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
      verifyPassword,
      adminRolesForAccount: async () => ({ username: 'bob', roles: ['admin'] }),
    });
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'bob', password: 'wrong' },
    });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid username or password' });
    expect(verifyPassword).toHaveBeenCalledWith('wrong', 'h');
  });

  it('a suspend with NO expiresAt mails the "until reviewed" until (the third derivation branch)', async () => {
    const target = { id: 5, username: 'x', email: 'x@y.z', locale: 'en', marketing_opt_in: false };
    const emailSecurityIncident = vi.fn();
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () => target,
      emailSecurityIncident,
      revokeTokensExcept: vi.fn(async () => {}),
    });
    installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'suspend' },
      body: { reason: 'griefing' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(emailSecurityIncident).toHaveBeenCalledWith(
      target,
      'suspend',
      'griefing',
      'until reviewed',
    );
  });

  it('an unsuspend on an ADMIN target passes the guard (it applies to suspend|ban only, legacy parity)', async () => {
    const moderateAccount = vi.fn(async () => {});
    authedAdminDb({ moderateAccount });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: String(ADMIN_ACCOUNT_ID), action: 'unsuspend' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(moderateAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ADMIN_ACCOUNT_ID, action: 'unsuspend' }),
    );
  });

  it('400s a chat-filter word that is empty after normalization (addFilterWord false), no reload', async () => {
    authedAdminDb({ addFilterWord: async () => false });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words', {
      headers: { authorization: BEARER },
      body: { word: '   ', tier: 'soft' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'word is empty after normalization',
    });
    expect(rt.reloadChatFilter).not.toHaveBeenCalled();
  });

  it('400s a blocked-ips add when addBlockedIp rejects the ip (falsy), no reload and no kick', async () => {
    const addBlockedIp = vi.fn(async () => '');
    authedAdminDb({ cleanIp: () => '9.9.9.9', addBlockedIp });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
      body: { ip: '9.9.9.9' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'a valid IP address is required' });
    expect(addBlockedIp).toHaveBeenCalledWith(expect.objectContaining({ ip: '9.9.9.9' }));
    expect(rt.reloadBlockedIps).not.toHaveBeenCalled();
    expect(rt.disconnectByIp).not.toHaveBeenCalled();
  });

  it('400s a blocked-ips add for unknown before the write boundary', async () => {
    const addBlockedIp = vi.fn(async () => 'unknown');
    authedAdminDb({ addBlockedIp });
    const rt = installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
      body: { ip: 'unknown' },
    });

    expect(r.status).toBe(400);
    expect(addBlockedIp).not.toHaveBeenCalled();
    expect(rt.reloadBlockedIps).not.toHaveBeenCalled();
    expect(rt.disconnectByIp).not.toHaveBeenCalled();
  });

  it('400s a blocked-ips delete on an invalid ip BEFORE the remove (cleanIp pre-check)', async () => {
    const removeBlockedIp = vi.fn(async () => true);
    authedAdminDb({ cleanIp: () => '', removeBlockedIp });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips/delete', {
      headers: { authorization: BEARER },
      body: { ip: 'not-an-ip' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'a valid IP address is required' });
    expect(removeBlockedIp).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Reset password (accounts.password): the RouteDef twin of the legacy branch.
// ---------------------------------------------------------------------------

describe('reset-password RouteDef handler (accounts.password)', () => {
  const resetDeps = () => ({
    accountById: vi.fn(async () => ({ id: 5 })),
    recordPasswordReset: vi.fn(async () => {}),
    hashPassword: vi.fn(async () => 'salt:hashed'),
    updatePasswordHash: vi.fn(async () => {}),
    revokeTokensExcept: vi.fn(async () => {}),
  });

  it('audits first, rehashes, revokes every token, and kicks live sessions', async () => {
    const deps = resetDeps();
    authedAdminDb(deps);
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/accounts/:id/reset-password', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { password: 'newpass123', reason: 'account recovery' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(deps.recordPasswordReset).toHaveBeenCalledWith({
      accountId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      reason: 'account recovery',
    });
    expect(deps.hashPassword).toHaveBeenCalledWith('newpass123');
    expect(deps.updatePasswordHash).toHaveBeenCalledWith(5, 'salt:hashed');
    expect(deps.revokeTokensExcept).toHaveBeenCalledWith(5, null);
    expect(rt.disconnectAccount).toHaveBeenCalledWith(5, 'Connection to the server was lost.');
    // The audit row lands before the credential write (no unaudited action).
    expect(deps.recordPasswordReset.mock.invocationCallOrder[0]).toBeLessThan(
      deps.updatePasswordHash.mock.invocationCallOrder[0],
    );
  });

  it('rejects out-of-bounds passwords and unknown accounts without any write', async () => {
    const deps = resetDeps();
    authedAdminDb(deps);
    installAdminRuntime();
    const short = await runRoute('POST', '/admin/api/accounts/:id/reset-password', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { password: 'abc', reason: 'r' },
    });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({
      success: false,
      data: null,
      error: 'password must be at least 6 chars',
    });
    const long = await runRoute('POST', '/admin/api/accounts/:id/reset-password', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { password: 'x'.repeat(129), reason: 'r' },
    });
    expect(long.status).toBe(400);
    expect(long.body).toEqual({
      success: false,
      data: null,
      error: 'password must be at most 128 chars',
    });

    authedAdminDb({ ...deps, accountById: vi.fn(async () => null) });
    installAdminRuntime();
    const missing = await runRoute('POST', '/admin/api/accounts/:id/reset-password', {
      headers: { authorization: BEARER },
      params: { id: '12345' },
      body: { password: 'newpass123', reason: 'r' },
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, data: null, error: 'account not found' });

    expect(deps.recordPasswordReset).not.toHaveBeenCalled();
    expect(deps.updatePasswordHash).not.toHaveBeenCalled();
    expect(deps.revokeTokensExcept).not.toHaveBeenCalled();
  });

  it('refuses a staff target unless the actor is a superadmin', async () => {
    const deps = resetDeps();
    // The actor holds accounts.password via the plain admin role, but the target
    // reads as staff (isAdminAccount true), so the reset is refused.
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async (id: number) =>
        id === ADMIN_ACCOUNT_ID ? { username: 'op', roles: ['admin'] } : null,
      isAdminAccount: async () => true,
      ...deps,
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/accounts/:id/reset-password', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { password: 'newpass123', reason: 'r' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'only a superadmin can reset a staff password',
    });
    expect(deps.updatePasswordHash).not.toHaveBeenCalled();
    expect(deps.revokeTokensExcept).not.toHaveBeenCalled();
  });

  it('is denied 403 by the central gate for a moderator (accounts.password not held)', async () => {
    const deps = resetDeps();
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      ...deps,
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/accounts/:id/reset-password', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { password: 'newpass123', reason: 'r' },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'you do not have permission to do this',
    });
    expect(deps.updatePasswordHash).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 12. Account flair: the AI-operated mark and an official streamer's links.
//
// The security boundary is normalizeStreamerLink (src/sim/account_flair.ts), run
// inside the audited db write. These tests therefore drive the REAL
// moderation_db write through the route, with pool.connect spied onto a recording
// client, so "a hostile link never reaches the database" is asserted against the
// real write path rather than a fake that re-states the rule. Only the read-back
// (loadAccountFlair) is faked; nothing here opens a Postgres connection.
// ---------------------------------------------------------------------------

/** A pooled-client stand-in that records every statement the write path issues. */
function recordingPoolClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }),
    release: vi.fn(),
  };
  const connect = vi.spyOn(pool, 'connect').mockResolvedValue(client as never);
  return {
    connect,
    calls,
    /** The first recorded statement whose SQL contains `fragment`. */
    find: (fragment: string) => calls.find((c) => c.sql.includes(fragment)),
    sqlLog: () => calls.map((c) => c.sql.trim().split('\n')[0]),
  };
}

describe('account flair (AI mark + streamer links)', () => {
  const LIVE_FLAIR = { ai: true, streamer: false, links: {} };

  it('403s BOTH flair routes for a staff account that lacks moderation.act', async () => {
    // viewer holds accounts.read but not moderation.act (admin_permissions.ts), so
    // the central gate denies the write before the handler (and before any db call).
    const setAccountAiFlag = vi.fn(async () => {});
    const setAccountStreamerFlair = vi.fn(async () => {});
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['viewer'] }),
      setAccountAiFlag,
      setAccountStreamerFlair,
    });
    const rt = installAdminRuntime();

    const ai = await runRoute('POST', '/admin/api/accounts/:id/ai', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { ai: true },
    });
    const streamer = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: true, links: { twitch: 'https://twitch.tv/someone' } },
    });

    for (const r of [ai, streamer]) {
      expect(r.status).toBe(403);
      expect(r.body).toEqual({
        success: false,
        data: null,
        error: 'you do not have permission to do this',
      });
    }
    expect(setAccountAiFlag).not.toHaveBeenCalled();
    expect(setAccountStreamerFlair).not.toHaveBeenCalled();
    expect(rt.applyAccountFlairLive).not.toHaveBeenCalled();
  });

  it('lets a moderator set the AI mark: audited write, then the live push', async () => {
    const db = recordingPoolClient();
    const loadAccountFlair = vi.fn(async () => LIVE_FLAIR);
    // The REAL setAccountAiFlag runs (not overridden), so the transaction and its
    // audit row are the ones production issues.
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair,
    });
    const rt = installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/ai', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { ai: true, reason: 'partner bot account' },
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    // The write is one transaction: the column flip AND its audit row, or neither.
    expect(db.sqlLog()[0]).toBe('BEGIN');
    expect(db.sqlLog().at(-1)).toBe('COMMIT');
    const update = db.find('SET is_ai');
    expect(update?.params).toEqual([5, true]);
    const audit = db.find('INSERT INTO account_moderation_actions');
    expect(audit?.params).toEqual([5, ADMIN_ACCOUNT_ID, 'set_ai', 'partner bot account', null]);
    // The flair pushed live is the one re-read from the row, never the request body.
    expect(loadAccountFlair).toHaveBeenCalledWith(5);
    expect(rt.applyAccountFlairLive).toHaveBeenCalledWith(5, LIVE_FLAIR);
  });

  it('audits an AI-mark write with no reason (non-punitive: a reason is optional)', async () => {
    const db = recordingPoolClient();
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair: async () => LIVE_FLAIR,
    });
    installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/ai', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { ai: false },
    });

    expect(r.status).toBe(200);
    // Unlike ban/mute (which throw 'moderation reason is required'), the row lands.
    expect(db.find('SET is_ai')?.params).toEqual([5, false]);
    expect(db.find('INSERT INTO account_moderation_actions')?.params).toEqual([
      5,
      ADMIN_ACCOUNT_ID,
      'set_ai',
      '',
      null,
    ]);
  });

  it('400s a non-boolean ai / streamer flag before any db write', async () => {
    const db = recordingPoolClient();
    authedAdminDb({ loadAccountFlair: async () => LIVE_FLAIR });
    const rt = installAdminRuntime();

    const ai = await runRoute('POST', '/admin/api/accounts/:id/ai', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { ai: 'yes' },
    });
    expect(ai.status).toBe(400);
    expect(ai.body).toEqual({ success: false, data: null, error: 'ai must be a boolean' });

    const streamer = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: 1, links: {} },
    });
    expect(streamer.status).toBe(400);
    expect(streamer.body).toEqual({
      success: false,
      data: null,
      error: 'streamer must be a boolean',
    });

    const badLinks = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: true, links: ['https://twitch.tv/someone'] },
    });
    expect(badLinks.status).toBe(400);
    expect(badLinks.body).toEqual({
      success: false,
      data: null,
      error: 'a links object is required',
    });

    expect(db.connect).not.toHaveBeenCalled();
    expect(rt.applyAccountFlairLive).not.toHaveBeenCalled();
  });

  // The security case. Each of these is a way an operator-entered string could turn
  // into a hostile window.open on every player's client, so each must die at the
  // write gate: 400, no transaction, no live push.
  it.each([
    ['a javascript: scheme', 'javascript:alert(1)'],
    ['a plain-http link', 'http://twitch.tv/someone'],
    ['a foreign host', 'https://evil.com/someone'],
    ['a lookalike host', 'https://twitch.tv.evil.com/someone'],
    ['embedded credentials', 'https://user:pass@twitch.tv/someone'],
  ])('rejects %s with a 400 and never opens a transaction', async (_label, url) => {
    const db = recordingPoolClient();
    const loadAccountFlair = vi.fn(async () => LIVE_FLAIR);
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair,
    });
    const rt = installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: true, links: { twitch: url } },
    });

    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid streamer link' });
    // The gate runs before pool.connect, so the bad link never reaches Postgres...
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
    // ...and never reaches a player.
    expect(loadAccountFlair).not.toHaveBeenCalled();
    expect(rt.applyAccountFlairLive).not.toHaveBeenCalled();
  });

  it('stores only the NORMALIZED links for a valid write, and audits it as set_streamer', async () => {
    const db = recordingPoolClient();
    const live = {
      ai: false,
      streamer: true,
      links: { twitch: 'https://twitch.tv/someone', youtube: 'https://youtu.be/abc' },
    };
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair: async () => live,
    });
    const rt = installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {
        streamer: true,
        // Untrimmed, and a blank field for a platform the operator left empty.
        links: {
          twitch: '  https://twitch.tv/someone  ',
          kick: '',
          youtube: 'https://youtu.be/abc',
        },
        reason: 'verified partner',
      },
    });

    expect(r.status).toBe(200);
    const update = db.find('SET is_streamer');
    // A blank platform is absent (not stored as ''), and the kept links are the
    // normalized hrefs, not the raw operator text.
    expect(update?.params).toEqual([
      5,
      true,
      { twitch: 'https://twitch.tv/someone', youtube: 'https://youtu.be/abc' },
    ]);
    expect(db.find('INSERT INTO account_moderation_actions')?.params).toEqual([
      5,
      ADMIN_ACCOUNT_ID,
      'set_streamer',
      'verified partner',
      null,
    ]);
    expect(rt.applyAccountFlairLive).toHaveBeenCalledWith(5, live);
  });

  it('keeps the links stored but stops WIRING them once the streamer flag is off', async () => {
    const db = recordingPoolClient();
    const storedLinks = { twitch: 'https://twitch.tv/someone' };
    // The row after the flag is switched off: links intact, flag down.
    const flagOff: AccountFlair = { ai: false, streamer: false, links: storedLinks };
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair: async () => flagOff,
    });
    // A locally-typed spy, so the pushed flair keeps its AccountFlair type (the
    // runtime helper's override bag is deliberately loose).
    const applyAccountFlairLive = vi.fn<(accountId: number, flair: AccountFlair) => void>();
    installAdminRuntime({ applyAccountFlairLive });

    const r = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: false, links: storedLinks },
    });

    expect(r.status).toBe(200);
    // The links ARE still persisted (an operator can toggle the flair back on
    // without retyping them)...
    expect(db.find('SET is_streamer')?.params).toEqual([5, false, storedLinks]);
    // ...but the wire gate ships nothing while the flag is down, so no client sees
    // them. This is the one function both the entity encoder (identityFields.slk)
    // and the chat fan-out call, so gating it here gates every surface.
    const pushed = applyAccountFlairLive.mock.calls[0][1];
    expect(pushed).toEqual(flagOff);
    expect(wireStreamerLinks(pushed)).toBeUndefined();
    // Sanity: the same links DO wire once the flag is on, so the assertion above is
    // pinning the flag, not a broken links bag.
    expect(wireStreamerLinks({ ...flagOff, streamer: true })).toEqual(storedLinks);
  });

  // The dashboard drives all THREE streamer actions (mark / unmark / save links)
  // through this one endpoint, always sending both the flag and the full bag, so a
  // re-send of an unchanged flag has to be an ordinary write, not a conflict.
  it('is idempotent: saving links while ALREADY a streamer just writes again', async () => {
    const db = recordingPoolClient();
    const links = { twitch: 'https://twitch.tv/someone' };
    const already: AccountFlair = { ai: false, streamer: true, links };
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair: async () => already,
    });
    const rt = installAdminRuntime();

    const first = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: true, links },
    });
    const second = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: true, links },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Two full writes, each with its own audit row: no unchanged-flag short circuit.
    expect(db.calls.filter((c) => c.sql.includes('SET is_streamer'))).toHaveLength(2);
    expect(
      db.calls.filter((c) => c.sql.includes('INSERT INTO account_moderation_actions')),
    ).toHaveLength(2);
    expect(rt.applyAccountFlairLive).toHaveBeenCalledTimes(2);
  });

  it('leaves the stored links ALONE when the body omits the links key', async () => {
    const db = recordingPoolClient();
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair: async () => ({ ai: false, streamer: false, links: {} }),
    });
    installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: false },
    });

    expect(r.status).toBe(200);
    // The flag moves; streamer_links is not in the UPDATE at all, so an omitted key
    // can never wipe an account's links.
    const update = db.find('SET is_streamer');
    expect(update?.sql).not.toContain('streamer_links');
    expect(update?.params).toEqual([5, false]);
  });

  it('clears the links only on an EXPLICIT empty bag', async () => {
    const db = recordingPoolClient();
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      loadAccountFlair: async () => ({ ai: false, streamer: true, links: {} }),
    });
    installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/streamer', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { streamer: true, links: {} },
    });

    expect(r.status).toBe(200);
    expect(db.find('SET is_streamer')?.params).toEqual([5, true, {}]);
  });

  it('surfaces a db failure as a 400 without pushing anything live', async () => {
    setDb({
      accountAndScopeForToken: async () => fullToken(),
      adminRolesForAccount: async () => ({ username: 'op', roles: ['moderator'] }),
      setAccountAiFlag: async () => {
        throw new Error('boom');
      },
      loadAccountFlair: async () => LIVE_FLAIR,
    });
    const rt = installAdminRuntime();

    const r = await runRoute('POST', '/admin/api/accounts/:id/ai', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { ai: true },
    });

    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'boom' });
    expect(rt.applyAccountFlairLive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The guild bank operator READ (GET /admin/api/guilds/:id/bank): the slot list
// the escape hatch below is unusable without. Deliberately WIDER than the purge
// (moderation.read, not the superadmin-only guildbank.purge), because reading
// destroys nothing and "is this bank stuck?" is the question that decides
// whether there is anything to escalate. The payload is guild-scoped property
// only: what it must NOT carry is pinned here and in
// tests/server/admin_guild_bank_view.test.ts.
// ---------------------------------------------------------------------------

describe('guild bank operator read', () => {
  const STATE = {
    treasury: 12_345,
    capacity: 30,
    purchasedSlots: 30,
    usedSlots: 2,
    dormantSlots: 1,
    slots: [
      { index: 0, itemId: 'wolf_fang', count: 3, dormant: false },
      { index: 1, itemId: 'reins_grag_bear', count: 1, dormant: true },
    ],
  };

  it('answers the live book for the target guild', async () => {
    const adminGuildBankState = vi.fn(() => STATE);
    authedAdminDb({});
    installAdminRuntime({ adminGuildBankState });

    const r = await runRoute('GET', '/admin/api/guilds/:id/bank', {
      headers: { authorization: BEARER },
      params: { id: '913' },
    });

    expect(adminGuildBankState).toHaveBeenCalledWith(913);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { guildId: 913, ...STATE },
      error: null,
    });
  });

  it('carries nothing account-scoped: the response is item ids, counts, and flags', async () => {
    // The operator boundary. The snapshot this read projects keeps the real
    // per-copy payload (the purge's ledger evidence), so a regression that
    // forwarded it would leak another character's bind identity to every
    // moderation.read operator.
    authedAdminDb({});
    installAdminRuntime({ adminGuildBankState: vi.fn(() => STATE) });
    const r = await runRoute('GET', '/admin/api/guilds/:id/bank', {
      headers: { authorization: BEARER },
      params: { id: '913' },
    });
    const data = (r.body as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual([
      'capacity',
      'dormantSlots',
      'guildId',
      'purchasedSlots',
      'slots',
      'treasury',
      'usedSlots',
    ]);
    for (const slot of data.slots as Record<string, unknown>[]) {
      expect(Object.keys(slot).sort()).toEqual(['count', 'dormant', 'index', 'itemId']);
    }
    expect(r.raw).not.toContain('instance');
    expect(r.raw).not.toContain('boundTo');
  });

  it('404s a guild with no loaded book, reusing the purge line an operator already knows', async () => {
    authedAdminDb({});
    installAdminRuntime({ adminGuildBankState: vi.fn(() => null) });
    const r = await runRoute('GET', '/admin/api/guilds/:id/bank', {
      headers: { authorization: BEARER },
      params: { id: '913' },
    });
    expect(r.status).toBe(404);
    // Byte-identical to the purge's no_book body, so the dashboard's existing
    // error.guildBankNotLoaded row localizes both without a second string.
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'that guild has no loaded bank',
    });
  });

  it('is reachable by a moderator and a viewer, unlike the purge beside it', async () => {
    // The deliberate widening, pinned: the roles that investigate a ticket can
    // SEE a stuck bank. The same roles are denied the purge (pinned below).
    for (const roles of [['moderator'], ['viewer'], ['admin']]) {
      const adminGuildBankState = vi.fn(() => STATE);
      authedAdminDb({ adminRolesForAccount: async () => ({ username: 'op', roles }) });
      installAdminRuntime({ adminGuildBankState });
      const r = await runRoute('GET', '/admin/api/guilds/:id/bank', {
        headers: { authorization: BEARER },
        params: { id: '913' },
      });
      expect(r.status, roles[0]).toBe(200);
      expect(adminGuildBankState, roles[0]).toHaveBeenCalledWith(913);
    }
  });

  it('denies a role holding no moderation.read before the live sim is read', async () => {
    const adminGuildBankState = vi.fn(() => STATE);
    authedAdminDb({ adminRolesForAccount: async () => ({ username: 'op', roles: [] }) });
    installAdminRuntime({ adminGuildBankState });
    const r = await runRoute('GET', '/admin/api/guilds/:id/bank', {
      headers: { authorization: BEARER },
      params: { id: '913' },
    });
    expect(r.status).toBe(403);
    expect(adminGuildBankState).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated caller before the sim is reached', async () => {
    const adminGuildBankState = vi.fn(() => STATE);
    installAdminRuntime({ adminGuildBankState });
    const r = await runRoute('GET', '/admin/api/guilds/:id/bank', { params: { id: '913' } });
    expect(r.status).toBe(401);
    expect(adminGuildBankState).not.toHaveBeenCalled();
  });

  it('both dispatch arms run the SAME shared body (the dual-edit rule)', () => {
    const source = readFileSync(join(process.cwd(), 'server/admin.ts'), 'utf8');
    const calls = source.match(/guildBankStateOutcome\(/g) ?? [];
    // one declaration + two call sites
    expect(calls.length).toBe(3);
    expect(source).toContain('const guildBankStateMatch =');
    expect(source).toContain("path: '/admin/api/guilds/:id/bank',");
  });
});

// ---------------------------------------------------------------------------
// The guild bank dormant-slot escape hatch (POST /admin/api/guilds/:id/bank/
// purge-slot). It destroys player property, so the authorization arm matters as
// much as the happy path: it carries its OWN permission (guildbank.purge), not
// moderation.act, and every refusal must reach the operator as its own body.
// ---------------------------------------------------------------------------

describe('guild bank dormant-slot purge', () => {
  const OK_BODY = {
    slot: 3,
    itemId: 'wolf_fang',
    reason: 'stuck rift-gear copy, guild disbanding',
  };

  it('purges the named slot, writes the audited row, and answers with what was removed', async () => {
    const adminPurgeGuildBankSlot = vi.fn(async () => ({
      ok: true as const,
      removed: { itemId: 'wolf_fang', count: 2 },
      carrierCharacterId: 11,
    }));
    const recordAdminGuildBankPurge = vi.fn(async () => {});
    authedAdminDb({ recordAdminGuildBankPurge });
    installAdminRuntime({ adminPurgeGuildBankSlot });

    const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
      headers: { authorization: BEARER },
      params: { id: '913' },
      body: OK_BODY,
    });

    // The acting OPERATOR's account id is threaded to the game, not the carrier's.
    expect(adminPurgeGuildBankSlot).toHaveBeenCalledWith(913, 3, 'wolf_fang', ADMIN_ACCOUNT_ID);
    // ...and the audited moderation row carries who, why, and what.
    expect(recordAdminGuildBankPurge).toHaveBeenCalledWith({
      guildId: 913,
      reason: OK_BODY.reason,
      adminAccountId: ADMIN_ACCOUNT_ID,
      itemId: 'wolf_fang',
      count: 2,
      slotIndex: 3,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { guildId: 913, slotIndex: 3, itemId: 'wolf_fang', count: 2, audited: true },
      error: null,
    });
  });

  it('reports audited:false (never a 500) when only the audit insert fails', async () => {
    // The item is already gone; a failed audit row cannot un-remove it, so the
    // operator is told the purge landed AND that the log row did not.
    authedAdminDb({
      recordAdminGuildBankPurge: vi.fn(async () => {
        throw new Error('audit db down');
      }),
    });
    installAdminRuntime({
      adminPurgeGuildBankSlot: vi.fn(async () => ({
        ok: true as const,
        removed: { itemId: 'wolf_fang', count: 1 },
        carrierCharacterId: 11,
      })),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
      headers: { authorization: BEARER },
      params: { id: '913' },
      body: OK_BODY,
    });
    errSpy.mockRestore();
    expect(r.status).toBe(200);
    expect((r.body as { data: { audited: boolean } }).data.audited).toBe(false);
  });

  it('denies every dashboard-grantable role BEFORE touching the live sim', async () => {
    // guildbank.purge is superadmin-only: moderator reaches the guild rename,
    // and even `admin` (otherwise everything) must NOT reach this.
    for (const roles of [['moderator'], ['admin'], ['viewer']]) {
      const adminPurgeGuildBankSlot = vi.fn();
      const recordAdminGuildBankPurge = vi.fn();
      authedAdminDb({
        adminRolesForAccount: async () => ({ username: 'op', roles }),
        recordAdminGuildBankPurge,
      });
      installAdminRuntime({ adminPurgeGuildBankSlot });

      const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
        headers: { authorization: BEARER },
        params: { id: '913' },
        body: OK_BODY,
      });

      expect(r.status, roles[0]).toBe(403);
      expect(adminPurgeGuildBankSlot, roles[0]).not.toHaveBeenCalled();
      expect(recordAdminGuildBankPurge, roles[0]).not.toHaveBeenCalled();
    }
  });

  it('rejects a malformed slot, a missing itemId, and a missing reason, calling nothing', async () => {
    const adminPurgeGuildBankSlot = vi.fn();
    authedAdminDb({});
    installAdminRuntime({ adminPurgeGuildBankSlot });

    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...OK_BODY, slot: undefined }, 'a slot index is required'],
      [{ ...OK_BODY, slot: 'first' }, 'a slot index is required'],
      [{ ...OK_BODY, slot: -1 }, 'a slot index is required'],
      [{ ...OK_BODY, slot: 1.5 }, 'a slot index is required'],
      [{ ...OK_BODY, itemId: undefined }, 'the item id in that slot is required'],
      [{ ...OK_BODY, itemId: '   ' }, 'the item id in that slot is required'],
      [{ ...OK_BODY, reason: undefined }, 'a moderation reason is required (500 chars max)'],
      [{ ...OK_BODY, reason: '  ' }, 'a moderation reason is required (500 chars max)'],
      [{ ...OK_BODY, reason: 'x'.repeat(501) }, 'a moderation reason is required (500 chars max)'],
    ];
    for (const [body, error] of cases) {
      const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
        headers: { authorization: BEARER },
        params: { id: '913' },
        body,
      });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body, JSON.stringify(body)).toEqual({ success: false, data: null, error });
    }
    expect(adminPurgeGuildBankSlot).not.toHaveBeenCalled();
  });

  it('maps each refusal reason to its own status and operator body', async () => {
    const cases = [
      { reason: 'no_book', status: 404, error: 'that guild has no loaded bank' },
      {
        reason: 'no_carrier',
        status: 409,
        error: 'no member of that guild is online to persist the change',
      },
      { reason: 'not_dormant', status: 400, error: 'that slot is not a stuck item' },
      {
        reason: 'save_failed',
        status: 503,
        error: 'the change could not be saved and was rolled back',
      },
      {
        // The guild-delete window: its OWN reason, and deliberately not the
        // save_failed one. Nothing was attempted, so nothing was saved and
        // nothing was rolled back, and 409 (a conflict with a delete already in
        // flight) is not 503 (a transient the operator should retry into).
        reason: 'delete_in_flight',
        status: 409,
        error: 'that guild is being deleted, so its bank is closed',
      },
    ] as const;
    for (const c of cases) {
      const recordAdminGuildBankPurge = vi.fn();
      authedAdminDb({ recordAdminGuildBankPurge });
      installAdminRuntime({
        adminPurgeGuildBankSlot: vi.fn(async () => ({ ok: false as const, reason: c.reason })),
      });
      const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
        headers: { authorization: BEARER },
        params: { id: '913' },
        body: OK_BODY,
      });
      expect(r.status, c.reason).toBe(c.status);
      expect(r.body, c.reason).toEqual({ success: false, data: null, error: c.error });
      // A refused purge never logs a moderation row.
      expect(recordAdminGuildBankPurge, c.reason).not.toHaveBeenCalled();
    }
  });

  it('fails CLOSED on an unrecognized refusal reason instead of faking success', async () => {
    // A reason added to the game later must never fall through the switch into
    // the success return (which would read `removed` off a refusal).
    authedAdminDb({});
    installAdminRuntime({
      adminPurgeGuildBankSlot: vi.fn(async () => ({ ok: false, reason: 'future_reason' })),
    });
    const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
      headers: { authorization: BEARER },
      params: { id: '913' },
      body: OK_BODY,
    });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'the guild bank change was refused',
    });
  });

  it('401s an unauthenticated caller before the sim is reached', async () => {
    const adminPurgeGuildBankSlot = vi.fn();
    installAdminRuntime({ adminPurgeGuildBankSlot });
    const r = await runRoute('POST', '/admin/api/guilds/:id/bank/purge-slot', {
      params: { id: '913' },
      body: OK_BODY,
    });
    expect(r.status).toBe(401);
    expect(adminPurgeGuildBankSlot).not.toHaveBeenCalled();
  });

  it('both dispatch arms run the SAME shared body (the dual-edit rule)', () => {
    // The legacy ladder arm and the RouteDef handler must not drift, so pin
    // that neither carries its own logic: both call the one shared helper.
    const source = readFileSync(join(process.cwd(), 'server/admin.ts'), 'utf8');
    const calls = source.match(/purgeGuildBankSlotOutcome\(/g) ?? [];
    // one declaration + two call sites
    expect(calls.length).toBe(3);
    expect(source).toContain('const guildBankPurgeMatch =');
    expect(source).toContain("path: '/admin/api/guilds/:id/bank/purge-slot'");
  });
});

// ---------------------------------------------------------------------------
// 12. R35 GM professions tooling: the inspector read + the two audited restores.
// ---------------------------------------------------------------------------

describe('R35 professions inspector (GET /admin/api/characters/:id/professions)', () => {
  const BLOB_ROW = {
    id: 5,
    name: 'Aldric',
    class: 'warrior',
    level: 12,
    accountId: 9,
    username: 'aldric-owner',
    state: {
      gatheringProficiency: { mining: 42.5 },
      craftSkills: { alchemy: 30 },
      knownRecipes: ['recipe_a', 'recipe_b'],
      toolEffectSlots: {
        mining: {
          effectId: 'gatherers_cache',
          durability: 3,
          maxDurability: 16,
          craftedBy: 'Mira',
          confirmMode: 'always',
        },
      },
      // One live node id (enriched from content) and one retired id (null
      // enrichment; the load-side filter would drop it in game).
      nodeHarvestCooldowns: { ore_eastbrook_1: 120, retired_node_xyz: 30 },
      archetype: { activeArchetype: 'alchemy', pairedMajor: 'engineering', hobbyCraft: null },
      masteryResetApplied: true,
      proficiencyDisplayHealApplied: true,
      recipesGrandfathered: true,
    },
    updatedAt: '2026-07-30T12:00:00.000Z',
  };

  it('shapes the stored blob for an OFFLINE character (live false, save clock kept)', async () => {
    const characterProfessionsRow = vi.fn(async () => BLOB_ROW);
    authedAdminDb({ characterProfessionsRow });
    installAdminRuntime({ adminCharacterState: vi.fn(() => null) });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(200);
    const sheet = (r.body as { data: Record<string, any> }).data;
    expect(characterProfessionsRow).toHaveBeenCalledWith(5, true); // offline: fetch the blob
    expect(sheet.name).toBe('Aldric');
    expect(sheet.live).toBe(false);
    expect(sheet.updatedAt).toBe('2026-07-30T12:00:00.000Z');
    expect(sheet.preMigration).toBe(false); // the fixture carries all three one-shot flags
    expect(sheet.gathering).toContainEqual({ professionId: 'mining', proficiency: 42.5 });
    // Every gathering profession renders, absent ones as 0.
    expect(sheet.gathering).toContainEqual({ professionId: 'fishing', proficiency: 0 });
    expect(sheet.crafting).toContainEqual({ craftId: 'alchemy', skill: 30, tier: 1 });
    expect(sheet.knownRecipes).toBe(2);
    // The sheet runs the LOADER'S normalizeArchetypeState, so the stored
    // null hobby renders as the default the next login resolves for the
    // alchemy+engineering pair (enchanting; inscription has no content).
    expect(sheet.archetype).toEqual({
      activeArchetype: 'alchemy',
      pairedMajor: 'engineering',
      hobbyCraft: 'enchanting',
    });
    expect(sheet.slots).toEqual([
      {
        professionId: 'mining',
        effectId: 'gatherers_cache',
        durability: 3,
        maxDurability: 16,
        craftedBy: 'Mira',
        confirmMode: 'always',
      },
    ]);
    // Sorted longest-remaining first; the live node enriches, the retired one
    // reads null zone/type.
    expect(sheet.nodeTimers).toEqual([
      {
        nodeId: 'ore_eastbrook_1',
        zoneId: 'eastbrook_vale',
        nodeType: 'ore',
        remainingSeconds: 120,
      },
      { nodeId: 'retired_node_xyz', zoneId: null, nodeType: null, remainingSeconds: 30 },
    ]);
    // The server-authored effect vocabulary the restore-slot select renders.
    expect(sheet.toolEffectIds).toEqual(['gatherers_cache', 'artisans_eye', 'quickening_charm']);
  });

  it('overlays a LIVE serializeCharacter snapshot when the character is online here', async () => {
    const characterProfessionsRow = vi.fn(async () => BLOB_ROW);
    authedAdminDb({ characterProfessionsRow });
    installAdminRuntime({
      adminCharacterState: vi.fn(() => ({ gatheringProficiency: { mining: 43.5 } })),
    });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(200);
    const sheet = (r.body as { data: Record<string, any> }).data;
    expect(sheet.live).toBe(true);
    expect(sheet.updatedAt).toBeNull(); // a live snapshot is "now"
    expect(sheet.gathering).toContainEqual({ professionId: 'mining', proficiency: 43.5 });
    // A live read discards the blob, so the query must not fetch it.
    expect(characterProfessionsRow).toHaveBeenCalledWith(5, false);
  });

  it('falls back to the legacy pre-rename professions key (dual-key read)', async () => {
    authedAdminDb({
      characterProfessionsRow: vi.fn(async () => ({
        ...BLOB_ROW,
        state: { professions: { herbalism: 7 } },
      })),
    });
    installAdminRuntime({ adminCharacterState: vi.fn(() => null) });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    const sheet = (r.body as { data: Record<string, any> }).data;
    expect(sheet.gathering).toContainEqual({ professionId: 'herbalism', proficiency: 7 });
  });

  it('404s an unknown character with the standard envelope', async () => {
    authedAdminDb({ characterProfessionsRow: vi.fn(async () => null) });
    installAdminRuntime({ adminCharacterState: vi.fn(() => null) });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'character not found' });
  });
});

describe('R35 GM restores (restore-item / restore-slot)', () => {
  it('restore-item audits FIRST, then mints on the live session', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    const rt = installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreItem: vi.fn(() => 'ok'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'copper_mining_pick', count: 2, reason: 'lost to issue 2514' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(recordProfessionsRestore).toHaveBeenCalledWith({
      characterId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      action: 'restore_item',
      detail: 'copper_mining_pick x2',
      reason: 'lost to issue 2514',
    });
    expect(rt.adminRestoreItem).toHaveBeenCalledWith(5, 'copper_mining_pick', 2);
    // A grant may never exist unaudited: the audit row precedes the mint.
    const auditOrder = recordProfessionsRestore.mock.invocationCallOrder[0];
    const mintOrder = (rt.adminRestoreItem as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(mintOrder);
  });

  it('restore-item refuses an offline character BEFORE any audit write', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    const rt = installAdminRuntime({
      adminCharacterOnline: vi.fn(() => false),
      adminRestoreItem: vi.fn(() => 'ok'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'copper_mining_pick', count: 1, reason: 'lost' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'character is not online on this realm',
    });
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
    expect(rt.adminRestoreItem).not.toHaveBeenCalled();
    expect(rt.adminCharacterOnline).toHaveBeenCalledWith(5);
  });

  it('restore-item refuses an unknown item and an out-of-range count pre-audit', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreItem: vi.fn(() => 'ok'),
    });
    const bad = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'not_a_real_item', count: 1, reason: 'lost' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ success: false, data: null, error: 'unknown item id' });
    const over = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'copper_mining_pick', count: 21, reason: 'lost' },
    });
    expect(over.status).toBe(400);
    expect(over.body).toEqual({
      success: false,
      data: null,
      error: 'count must be a whole number between 1 and 20',
    });
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
  });

  it('restore-item surfaces a missing reason as the audited write refusal', async () => {
    authedAdminDb({
      recordProfessionsRestore: vi.fn(async () => {
        throw new Error('moderation reason is required');
      }),
    });
    const rt = installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreItem: vi.fn(() => 'ok'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'copper_mining_pick', count: 1 },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'moderation reason is required',
    });
    expect(rt.adminRestoreItem).not.toHaveBeenCalled(); // no unaudited grant
  });

  it('restore-slot audits then re-mints, with the profession/effect detail', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    const rt = installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreToolEffectSlot: vi.fn(() => 'ok'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'row vanished' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(recordProfessionsRestore).toHaveBeenCalledWith({
      characterId: 5,
      adminAccountId: ADMIN_ACCOUNT_ID,
      action: 'restore_slot',
      detail: 'mining/gatherers_cache',
      reason: 'row vanished',
    });
    expect(rt.adminRestoreToolEffectSlot).toHaveBeenCalledWith(5, 'mining', 'gatherers_cache');
  });

  it('restore-slot maps the sim refusals to their own error prose', async () => {
    authedAdminDb({ recordProfessionsRestore: vi.fn(async () => ({ accountId: 9 })) });
    const rt = installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreToolEffectSlot: vi.fn(() => 'no_tool'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'row vanished' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'the character owns no tool for that profession',
    });
    expect(rt.adminRestoreToolEffectSlot).toHaveBeenCalled();
  });

  it('restore-slot refuses a craft (non-gathering) profession id pre-audit', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreToolEffectSlot: vi.fn(() => 'ok'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'cooking', effectId: 'gatherers_cache', reason: 'row vanished' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'unknown gathering profession id',
    });
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
  });
});

describe('R35 GM restores: refusal prose arms', () => {
  it('restore-slot maps already_slotted and invalid_request to their own prose', async () => {
    authedAdminDb({ recordProfessionsRestore: vi.fn(async () => ({ accountId: 9 })) });
    const rt = installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreToolEffectSlot: vi.fn(() => 'already_slotted'),
    });
    const slotted = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'row vanished' },
    });
    expect(slotted.status).toBe(400);
    expect(slotted.body).toEqual({
      success: false,
      data: null,
      error: 'that profession already has a slotted effect',
    });
    (rt.adminRestoreToolEffectSlot as ReturnType<typeof vi.fn>).mockReturnValue('invalid_request');
    const badPair = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'row vanished' },
    });
    expect(badPair.status).toBe(400);
    expect(badPair.body).toEqual({
      success: false,
      data: null,
      error: 'that effect cannot be slotted on that profession',
    });
  });

  it('both restores surface the post-audit leave race as their own prose', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true), // online at the pre-check...
      adminRestoreItem: vi.fn(() => 'offline'), // ...gone by the mint
      adminRestoreToolEffectSlot: vi.fn(() => 'offline'),
    });
    const raceProse = 'character went offline before the restore landed';
    const item = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'copper_mining_pick', count: 1, reason: 'lost' },
    });
    expect(item.status).toBe(400);
    expect(item.body).toEqual({ success: false, data: null, error: raceProse });
    const slot = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'lost' },
    });
    expect(slot.status).toBe(400);
    expect(slot.body).toEqual({ success: false, data: null, error: raceProse });
    // The race is the ONE place an audit row may outlive a failed grant, so
    // the row must exist for the history to stay honest.
    expect(recordProfessionsRestore).toHaveBeenCalledTimes(2);
  });

  it('restore-slot refuses an unknown effect id pre-audit', async () => {
    const recordProfessionsRestore = vi.fn(async () => ({ accountId: 9 }));
    authedAdminDb({ recordProfessionsRestore });
    installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreToolEffectSlot: vi.fn(() => 'ok'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-slot', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { professionId: 'mining', effectId: 'not_an_effect', reason: 'lost' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown tool effect id' });
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
  });
});

describe('R35 professions inspector: fix-round edge pins', () => {
  it('survives a NULL characters.state row (created but never entered)', async () => {
    authedAdminDb({
      characterProfessionsRow: vi.fn(async () => ({
        id: 5,
        name: 'Unborn',
        class: 'warrior',
        level: 1,
        accountId: 9,
        username: 'alice',
        state: null,
        updatedAt: '2026-07-30T12:00:00.000Z',
      })),
    });
    installAdminRuntime({ adminCharacterState: vi.fn(() => null) });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(200);
    const sheet = (r.body as { data: Record<string, any> }).data;
    expect(sheet.gathering).toContainEqual({ professionId: 'mining', proficiency: 0 });
    expect(sheet.slots).toEqual([]);
    expect(sheet.nodeTimers).toEqual([]);
    expect(sheet.knownRecipes).toBe(0);
    // Never-entered is emptyBlob, NOT pre-migration: first login takes the
    // construction path the one-shot migrations never touch.
    expect(sheet.preMigration).toBe(false);
  });

  it('marks a pre-migration blob and clamps a tampered node timer', async () => {
    authedAdminDb({
      characterProfessionsRow: vi.fn(async () => ({
        id: 5,
        name: 'Veteran',
        class: 'warrior',
        level: 12,
        accountId: 9,
        username: 'alice',
        // A pre-curve blob: no one-shot flags, an over-cap node timer, and a
        // fishing slot the loader drops plus a legacy confirm-mode row.
        state: {
          gatheringProficiency: { mining: 50 },
          // 99999 pins the clamp; the negative and NaN rows pin the
          // loader's positive() filter (garbage never renders).
          nodeHarvestCooldowns: {
            ore_eastbrook_1: 99999,
            ore_eastbrook_2: -5,
            ore_eastbrook_3: Number.NaN,
          },
          toolEffectSlots: {
            fishing: {
              effectId: 'gatherers_cache',
              durability: 3,
              maxDurability: 16,
              confirmMode: 'always',
            },
            mining: { effectId: 'gatherers_cache', durability: 3, maxDurability: 16 },
          },
        },
        updatedAt: '2026-07-30T12:00:00.000Z',
      })),
    });
    installAdminRuntime({ adminCharacterState: vi.fn(() => null) });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    const sheet = (r.body as { data: Record<string, any> }).data;
    // The one-shot load migrations have not run: the operator is warned.
    expect(sheet.preMigration).toBe(true);
    // The load-side clamp: never display a wait the game would not honor
    // (ore respawn is 240s).
    expect(sheet.nodeTimers).toEqual([
      {
        nodeId: 'ore_eastbrook_1',
        zoneId: 'eastbrook_vale',
        nodeType: 'ore',
        remainingSeconds: 240,
      },
    ]);
    // The loader's slot rules: the refused fishing row DROPS; the legacy
    // row without a confirmMode reads 'always'.
    expect(sheet.slots).toEqual([
      {
        professionId: 'mining',
        effectId: 'gatherers_cache',
        durability: 3,
        maxDurability: 16,
        craftedBy: null,
        confirmMode: 'always',
      },
    ]);
  });

  it('a LIVE snapshot is never pre-migration even when its flags are absent', async () => {
    authedAdminDb({
      characterProfessionsRow: vi.fn(async () => ({
        id: 5,
        name: 'Live',
        class: 'warrior',
        level: 12,
        accountId: 9,
        username: 'alice',
        state: null,
        updatedAt: '2026-07-30T12:00:00.000Z',
      })),
    });
    installAdminRuntime({
      adminCharacterState: vi.fn(() => ({ gatheringProficiency: { mining: 1 } })),
    });
    const r = await runRoute('GET', '/admin/api/characters/:id/professions', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    const sheet = (r.body as { data: Record<string, any> }).data;
    expect(sheet.live).toBe(true);
    expect(sheet.preMigration).toBe(false);
  });
});

describe('characterProfessionsSheet: the per-field normalizer arms (pure)', () => {
  const baseInput = (state: Record<string, unknown>) => ({
    characterId: 5,
    name: 'Aldric',
    class: 'warrior',
    level: 12,
    accountId: 9,
    username: 'alice',
    state: state as never,
    live: false,
    updatedAt: null as string | null,
    emptyBlob: false,
  });
  const ALL_FLAGS = {
    masteryResetApplied: true,
    proficiencyDisplayHealApplied: true,
    recipesGrandfathered: true,
  };

  it('preMigration fires when ANY single one-shot flag is missing (per-dimension)', () => {
    // The check ORs three independent flags; each case drops exactly one so
    // a deleted conjunct in the source fails its own case.
    for (const missing of [
      'masteryResetApplied',
      'proficiencyDisplayHealApplied',
      'recipesGrandfathered',
    ] as const) {
      const flags: Record<string, boolean> = { ...ALL_FLAGS };
      delete flags[missing];
      const sheet = characterProfessionsSheet(baseInput(flags));
      expect(sheet.preMigration, `missing ${missing} must warn`).toBe(true);
    }
    expect(characterProfessionsSheet(baseInput(ALL_FLAGS)).preMigration).toBe(false);
  });

  it('clamps out-of-range proficiencies and craft skills the way the login does', () => {
    const sheet = characterProfessionsSheet(
      baseInput({
        ...ALL_FLAGS,
        gatheringProficiency: { mining: 999, logging: -5 },
        craftSkills: { alchemy: 99999 },
      }),
    );
    // mining maxSkill is 100 (content); a tampered 999 renders as the value
    // the next login resolves, and a negative floors at 0.
    expect(sheet.gathering).toContainEqual({ professionId: 'mining', proficiency: 100 });
    expect(sheet.gathering).toContainEqual({ professionId: 'logging', proficiency: 0 });
    const alchemy = sheet.crafting.find((c) => c.craftId === 'alchemy');
    expect(alchemy?.skill).toBeLessThanOrEqual(300);
    expect(Number.isFinite(alchemy?.skill)).toBe(true);
  });

  it('drops a ZERO node timer (the > 0 boundary) and tie-breaks equal timers by node id', () => {
    const sheet = characterProfessionsSheet(
      baseInput({
        ...ALL_FLAGS,
        nodeHarvestCooldowns: { ore_eastbrook_1: 0, zz_retired: 30, aa_retired: 30 },
      }),
    );
    // The literal 0 row is not "pending", it is the loader's drop boundary.
    expect(sheet.nodeTimers.map((t) => t.nodeId)).toEqual(['aa_retired', 'zz_retired']);
  });

  it('counts knownRecipes through the loader Set (duplicates collapse)', () => {
    const sheet = characterProfessionsSheet(
      baseInput({ ...ALL_FLAGS, knownRecipes: ['recipe_a', 'recipe_a', 'recipe_a'] }),
    );
    expect(sheet.knownRecipes).toBe(1);
  });

  it('renders a corrupt non-iterable knownRecipes as 0 instead of a 500', () => {
    // The loader THROWS on this blob (such a character cannot log in), which
    // is exactly why the sheet must not: the inspector is the tool an
    // operator opens to diagnose it. Guarded on iterability, not isArray,
    // so a string still counts its characters the way the loader Set does.
    expect(
      characterProfessionsSheet(baseInput({ ...ALL_FLAGS, knownRecipes: 42 })).knownRecipes,
    ).toBe(0);
    expect(
      characterProfessionsSheet(baseInput({ ...ALL_FLAGS, knownRecipes: {} })).knownRecipes,
    ).toBe(0);
    expect(
      characterProfessionsSheet(baseInput({ ...ALL_FLAGS, knownRecipes: 'abc' })).knownRecipes,
    ).toBe(3);
  });

  it('repairs an invalid archetype the way the login does (trio nulls together)', () => {
    const sheet = characterProfessionsSheet(
      baseInput({
        ...ALL_FLAGS,
        archetype: { activeArchetype: 'not_a_craft', pairedMajor: 'engineering', hobbyCraft: null },
      }),
    );
    // normalizeArchetypeState refuses the invalid active craft, and without
    // an active there is no pair and no hobby: the operator sees the reset
    // the next login performs, not the raw stored trio.
    expect(sheet.archetype).toEqual({ activeArchetype: null, pairedMajor: null, hobbyCraft: null });
  });
});

describe('R35 restore-item: the defensive invalid_item arm', () => {
  it('maps a runtime invalid_item to its own prose, never the offline race', async () => {
    authedAdminDb({ recordProfessionsRestore: vi.fn(async () => ({ accountId: 9 })) });
    installAdminRuntime({
      adminCharacterOnline: vi.fn(() => true),
      adminRestoreItem: vi.fn(() => 'invalid_item'),
    });
    const r = await runRoute('POST', '/admin/api/moderation/characters/:id/restore-item', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { itemId: 'copper_mining_pick', count: 1, reason: 'lost' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown item id' });
  });
});
