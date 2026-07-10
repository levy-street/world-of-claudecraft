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
//  - the requireAdmin gate: db-free 401 on a missing bearer, 401 on a non-admin, and
//    a valid admin reaches the handler (no read-only-scope 403, no moderation gate);
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

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminRuntime,
  configureAdminRuntime,
  resetAdminDbForTests,
  resetAdminRuntimeForTests,
  routes,
  setAdminDbForTests,
} from '../../server/admin';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import {
  rateLimited,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the gate BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// The admin caller the gate resolves the bearer to; isAdminAccount(id) returns true
// ONLY for this id, so a moderation target (a different id) reads as a non-admin.
const ADMIN_ACCOUNT_ID = 7;
// The admin-login per-minute ceiling (server/admin.ts ADMIN_LOGIN_MAX_PER_MINUTE).
const ADMIN_LOGIN_MAX = 10;
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
    accountForToken: async () => ADMIN_ACCOUNT_ID,
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
    disconnectAccount: vi.fn(),
    muteAccountChat: vi.fn(),
    liftChatMuteLive: vi.fn(),
    resetChatStrikesLive: vi.fn(),
    reloadChatFilter: vi.fn(async () => {}),
    reloadBlockedIps: vi.fn(async () => {}),
    disconnectByIp: vi.fn(),
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
  resetAdminDbForTests();
});

afterEach(() => {
  resetRateLimits();
  resetRateLimitClock();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
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
    authedAdminDb({ setAccountDeactivated: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
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
    const accountForToken = vi.fn(async () => ADMIN_ACCOUNT_ID);
    const adminRolesForAccount = vi.fn(async () => ({ username: 'op', roles: ['superadmin'] }));
    setDb({ accountForToken, adminRolesForAccount });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
    // A missing bearer never reaches the token lookup.
    expect(accountForToken).not.toHaveBeenCalled();
  });

  it('401s a valid bearer whose account is NOT staff (no roles)', async () => {
    setDb({ accountForToken: async () => 42, adminRolesForAccount: async () => null });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
  });

  it('401s a bearer that resolves to no account', async () => {
    setDb({
      accountForToken: async () => null,
      adminRolesForAccount: async () => ({ username: 'op', roles: ['superadmin'] }),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
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
});

// ---------------------------------------------------------------------------
// 4. The operator :id loader (requireAdminTarget) + enum :action decode.
// ---------------------------------------------------------------------------

describe('operator :id loader + enum :action', () => {
  it('reaches the handler with a valid numeric :id', async () => {
    authedAdminDb({ setAccountDeactivated: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.reached).toBe(true);
  });

  it('404s a non-numeric :id fail-closed before any handler runs (central permission gate)', async () => {
    // The permission table keys :id routes on (\d+), so a non-numeric id resolves no
    // permission and the central gate 404s it, byte-identical to the legacy arm's
    // fail-closed preamble. This supersedes the old adminIdParamDecode 422 for the
    // non-NUMERIC case; a numeric-but-invalid id (0, below) still reaches the decode.
    const setAccountDeactivated = vi.fn(async () => {});
    authedAdminDb({ setAccountDeactivated });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown admin endpoint' });
    expect(r.reached).toBe(false);
    expect(setAccountDeactivated).not.toHaveBeenCalled();
  });

  it('422s a non-positive :id (0)', async () => {
    authedAdminDb({ setAccountDeactivated: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '0' },
      body: {},
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ success: false, data: null, error: 'validation.failed' });
  });

  for (const action of ['suspend', 'unsuspend', 'ban', 'unban'] as const) {
    it(`decodes the valid action "${action}" and reaches moderateAccount`, async () => {
      const moderateAccount = vi.fn(async () => {});
      authedAdminDb({ moderateAccount, accountMailTarget: async () => null });
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
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () =>
        ({ id: 5, username: 'x', email: 'x@y.z', locale: 'en', marketing_opt_in: false }) as never,
      emailSecurityIncident,
    });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'suspend' },
      body: { reason: 'griefing' },
    });
    expect(r.status).toBe(200);
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
    authedAdminDb({ resetChatStrikes: async () => true });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reset-strikes', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
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
    authedAdminDb({ resetChatStrikes: async () => false });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reset-strikes', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
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
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        accounts: 4,
        peakOnlineToday: 3,
        peakOnlineAllTime: 100,
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
      fake: 'setAccountDeactivated',
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
        body: {},
      });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ success: false, data: null, error: `${c.label} exploded` });
    });
  }

  it('a NON-Error throw falls back to the per-route legacy prose (reactivation failed)', async () => {
    authedAdminDb({
      setAccountDeactivated: async () => {
        // The legacy catch only reads .message off an Error; anything else gets the fallback.
        throw 'boom';
      },
    });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
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
    authedAdminDb({ addBlockedIp: async () => '' });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
      body: { ip: 'not-an-ip' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'a valid IP address is required' });
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
      accountForToken: async () => ADMIN_ACCOUNT_ID,
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
      accountForToken: async () => ADMIN_ACCOUNT_ID,
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
