// Unit coverage for the admin economy-oversight routes (server/admin.ts):
// the rich list (GET /admin/api/wealth/top), the per-account gold breakdown
// (GET /admin/api/accounts/:id/wealth), and the suspicion-flag workflow
// (GET /admin/api/flags, GET /admin/api/accounts/:id/flags,
// POST /admin/api/flags/:id/status, POST /admin/api/flags/:id/note).
//
// Follows the tests/server/admin.test.ts harness: routes are driven through
// their real middleware chain (withErrors + requireAdmin [+ the :id loader])
// with fakeCtx, the db bundle faked via setAdminDbForTests, so every path pins
// the envelope, the auth gate, the central permission map, the dedicated
// oversight rate limiters, and the workflow validation.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_oversight';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAdminDbForTests, routes, setAdminDbForTests } from '../../server/admin';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  resetAdminOversightRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { ADMIN_ERROR_KEYS } from '../../src/admin/i18n';
import { en } from '../../src/admin/i18n.en';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;
const FIXED_NOW_MS = 1_700_000_000_000;

type DbOverrides = Record<string, unknown>;
function setDb(overrides: DbOverrides): void {
  setAdminDbForTests(overrides as Parameters<typeof setAdminDbForTests>[0]);
}

// Same shape as admin.test.ts's authedAdminDb, with the caller's ROLES
// parameterizable so the viewer (moderation.read, no moderation.act) arm can
// pin the 403.
function authedAdminDb(overrides: DbOverrides = {}, roles: string[] = ['superadmin']): void {
  setDb({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  });
}

function readRes(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  let body: unknown;
  try {
    body = fake.body ? JSON.parse(fake.body) : undefined;
  } catch {
    body = undefined;
  }
  return { status: fake.statusCode, body };
}

function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

function concretePath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z_]+)/g, (whole, name) => params[name] ?? whole);
}

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

// A rate-limit outcome stub typed off the real bundle (the admin.test.ts
// two-tier-limiter gotcha): a RateLimitOutcome shape change fails at tsc.
type AdminDbBundle = Parameters<typeof setAdminDbForTests>[0];
const allowed = (): ReturnType<NonNullable<AdminDbBundle['adminOversightReadRateLimited']>> => ({
  allowed: true,
  remaining: 1,
  resetSeconds: 0,
});
const denied = (): ReturnType<NonNullable<AdminDbBundle['adminOversightReadRateLimited']>> => ({
  allowed: false,
  remaining: 0,
  resetSeconds: 30,
});

const FLAG_ROW = {
  id: 11,
  accountId: 42,
  username: 'suspect',
  bannedAt: null,
  suspendedUntil: null,
  source: 'bot_detector',
  kind: 'session_automation',
  severity: 'high',
  details: 'Bot detector confirmed: score 12',
  relatedAccounts: [],
  status: 'new',
  copperAtFlag: 5_000,
  copperNow: 25_000,
  occurrences: 3,
  firstSeenAt: '2026-08-01T00:00:00Z',
  lastSeenAt: '2026-08-18T00:00:00Z',
  updatedAt: '2026-08-18T00:00:00Z',
};

const DATASET = {
  rows: [FLAG_ROW, { ...FLAG_ROW, id: 12, accountId: 43, username: 'other', status: 'cleared' }],
  countsByStatus: { new: 1, under_review: 0, cleared: 1, actioned: 0 },
  truncated: false,
};

beforeEach(() => {
  setRateLimitClock(() => FIXED_NOW_MS);
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetAdminDbForTests();
});

afterEach(() => {
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetRateLimitClock();
  resetAdminDbForTests();
  vi.restoreAllMocks();
});

describe('auth gate on every oversight route', () => {
  const CASES: [Method, string, Record<string, string>][] = [
    ['GET', '/admin/api/wealth/top', {}],
    ['GET', '/admin/api/accounts/:id/wealth', { id: '42' }],
    ['GET', '/admin/api/accounts/:id/flags', { id: '42' }],
    ['GET', '/admin/api/flags', {}],
    ['POST', '/admin/api/flags/:id/status', { id: '11' }],
    ['POST', '/admin/api/flags/:id/note', { id: '11' }],
  ];

  it('401s every route without a bearer and never reaches the handler', async () => {
    authedAdminDb();
    for (const [method, path, params] of CASES) {
      const r = await runRoute(method, path, { params });
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.reached, `${method} ${path}`).toBe(false);
      expect(r.body).toEqual({
        success: false,
        data: null,
        error: 'admin authentication required',
      });
    }
  });

  it('403s a workflow write for a viewer (moderation.read without moderation.act)', async () => {
    authedAdminDb({}, ['viewer']);
    const r = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { status: 'cleared' },
    });
    expect(r.status).toBe(403);
    expect(r.reached).toBe(false);
  });

  it('403s a note write for a viewer (moderation.read without moderation.act) before any db write', async () => {
    const addSuspicionFlagNote = vi.fn(async () => true);
    authedAdminDb({ addSuspicionFlagNote, adminFlagWriteRateLimited: vi.fn(allowed) }, ['viewer']);
    const r = await runRoute('POST', '/admin/api/flags/:id/note', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { note: 'a viewer must not annotate' },
    });
    expect(r.status).toBe(403);
    expect(r.reached).toBe(false);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'you do not have permission to do this',
    });
    expect(addSuspicionFlagNote).not.toHaveBeenCalled();
  });

  it('403s the flag list for a role without moderation.read', async () => {
    // The two non-superadmin-only roles holding accounts.read but not
    // moderation.read do not exist as a bundle; fake a bare analytics viewer.
    authedAdminDb({}, ['unknown-role']);
    const r = await runRoute('GET', '/admin/api/flags', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(403);
    expect(r.reached).toBe(false);
  });
});

describe('GET /admin/api/wealth/top', () => {
  it('returns the cached rich list', async () => {
    const rows = [{ accountId: 1, username: 'rich', totalCopper: 9_999 }];
    const topWealthHolders = vi.fn(async () => rows);
    authedAdminDb({ topWealthHolders, adminOversightReadRateLimited: vi.fn(allowed) });
    const r = await runRoute('GET', '/admin/api/wealth/top', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { rows }, error: null });
  });

  it('429s when the oversight read limiter denies', async () => {
    const topWealthHolders = vi.fn(async () => []);
    authedAdminDb({ topWealthHolders, adminOversightReadRateLimited: vi.fn(denied) });
    const r = await runRoute('GET', '/admin/api/wealth/top', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'too many requests, wait a moment and try again',
    });
    expect(topWealthHolders).not.toHaveBeenCalled();
  });
});

describe('GET /admin/api/accounts/:id/wealth', () => {
  it('returns the breakdown with the large-movement rows appended', async () => {
    const breakdown = {
      accountId: 42,
      purseCopper: 100,
      mailCopper: 10,
      marketCopper: 5,
      totalCopper: 115,
      updatedAt: '2026-08-18T00:00:00Z',
      characters: [],
    };
    const movements = [{ id: 1, op: 'withdraw_gold', copperDelta: -200_000 }];
    const accountWealthBreakdown = vi.fn(async () => breakdown);
    const largeGoldMovementsForAccount = vi.fn(async () => movements);
    authedAdminDb({
      accountWealthBreakdown,
      largeGoldMovementsForAccount,
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('GET', '/admin/api/accounts/:id/wealth', {
      headers: { authorization: BEARER },
      params: { id: '42' },
    });
    expect(r.status).toBe(200);
    expect(accountWealthBreakdown).toHaveBeenCalledWith(42);
    expect(largeGoldMovementsForAccount).toHaveBeenCalledWith(42, 25);
    expect(r.body).toEqual({
      success: true,
      data: { ...breakdown, largeMovements: movements },
      error: null,
    });
  });

  it('degrades to an empty, flagged movement list when the ledger read fails', async () => {
    // largeGoldMovementsForAccount carries a 2 s statement bound; a timeout
    // there must not fail the pane whose breakdown is already computed.
    const breakdown = {
      accountId: 42,
      purseCopper: 100,
      mailCopper: 10,
      marketCopper: 5,
      totalCopper: 115,
      updatedAt: '2026-08-18T00:00:00Z',
      characters: [],
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    authedAdminDb({
      accountWealthBreakdown: vi.fn(async () => breakdown),
      largeGoldMovementsForAccount: vi.fn(async () => {
        throw new Error('canceling statement due to statement timeout');
      }),
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('GET', '/admin/api/accounts/:id/wealth', {
      headers: { authorization: BEARER },
      params: { id: '42' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { ...breakdown, largeMovements: [], largeMovementsUnavailable: true },
      error: null,
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toMatch(
      /large gold movements read failed for account 42/,
    );
  });

  it('404s an unknown account', async () => {
    authedAdminDb({
      accountWealthBreakdown: vi.fn(async () => null),
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('GET', '/admin/api/accounts/:id/wealth', {
      headers: { authorization: BEARER },
      params: { id: '404' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'account not found' });
  });

  it('404s a non-digit :id at the central permission gate before any db read', async () => {
    // The permission map keys the (\d+) regex, so a non-digit id never resolves
    // a permission and fails closed as an unknown endpoint (the legacy-parity
    // behavior every admin :id route shares), ahead of the 422 loader.
    const accountWealthBreakdown = vi.fn(async () => null);
    authedAdminDb({
      accountWealthBreakdown,
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('GET', '/admin/api/accounts/:id/wealth', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'unknown admin endpoint' });
    expect(accountWealthBreakdown).not.toHaveBeenCalled();
  });
});

describe('GET /admin/api/flags', () => {
  it('defaults to the active tab (new + under_review) with counts', async () => {
    authedAdminDb({
      suspicionFlagDataset: vi.fn(async () => DATASET),
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('GET', '/admin/api/flags', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: {
        rows: [FLAG_ROW],
        total: 1,
        page: 1,
        limit: 25,
        counts: DATASET.countsByStatus,
        truncated: false,
      },
      error: null,
    });
  });

  it('filters by a concrete status and passes "all" through', async () => {
    authedAdminDb({
      suspicionFlagDataset: vi.fn(async () => DATASET),
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const cleared = await runRoute('GET', '/admin/api/flags', {
      url: '/admin/api/flags?status=cleared',
      headers: { authorization: BEARER },
    });
    expect(
      (cleared.body as { data: { rows: { id: number }[] } }).data.rows.map((f) => f.id),
    ).toEqual([12]);
    const all = await runRoute('GET', '/admin/api/flags', {
      url: '/admin/api/flags?status=all',
      headers: { authorization: BEARER },
    });
    expect((all.body as { data: { total: number } }).data.total).toBe(2);
  });
});

describe('GET /admin/api/accounts/:id/flags', () => {
  it('returns the account flag history with events', async () => {
    const payload = { flags: [FLAG_ROW], events: [{ id: 1, flagId: 11 }] };
    const suspicionFlagsForAccount = vi.fn(async () => payload);
    authedAdminDb({
      suspicionFlagsForAccount,
      adminOversightReadRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('GET', '/admin/api/accounts/:id/flags', {
      headers: { authorization: BEARER },
      params: { id: '42' },
    });
    expect(r.status).toBe(200);
    expect(suspicionFlagsForAccount).toHaveBeenCalledWith(42);
    expect(r.body).toEqual({ success: true, data: payload, error: null });
  });
});

describe('POST /admin/api/flags/:id/status', () => {
  it('applies a valid transition and returns the updated flag', async () => {
    const updated = { ...FLAG_ROW, status: 'under_review' };
    const transitionSuspicionFlag = vi.fn(async () => ({ ok: true, flag: updated }));
    authedAdminDb({
      transitionSuspicionFlag,
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { status: 'under_review', note: 'taking a look' },
    });
    expect(r.status).toBe(200);
    expect(transitionSuspicionFlag).toHaveBeenCalledWith({
      flagId: 11,
      adminAccountId: ADMIN_ACCOUNT_ID,
      to: 'under_review',
      note: 'taking a look',
    });
    expect(r.body).toEqual({ success: true, data: { flag: updated }, error: null });
  });

  it('400s an unknown status before any db write', async () => {
    const transitionSuspicionFlag = vi.fn();
    authedAdminDb({
      transitionSuspicionFlag,
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { status: 'frobnicated' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid flag status' });
    expect(transitionSuspicionFlag).not.toHaveBeenCalled();
  });

  it('400s a refused transition, 409s an active-sibling collision, 404s a missing flag', async () => {
    authedAdminDb({
      transitionSuspicionFlag: vi.fn(async () => ({ ok: false, error: 'invalid_transition' })),
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const refused = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { status: 'cleared' },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      success: false,
      data: null,
      error: 'that status change is not allowed',
    });

    authedAdminDb({
      transitionSuspicionFlag: vi.fn(async () => ({ ok: false, error: 'active_flag_exists' })),
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const collided = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { status: 'under_review' },
    });
    expect(collided.status).toBe(409);
    expect(collided.body).toEqual({
      success: false,
      data: null,
      error: 'this account already has an open flag of that kind',
    });
    // The admin SPA re-localizes the prose through its reverse map: pin the
    // server literal to its catalog key so neither side can drift silently.
    expect(ADMIN_ERROR_KEYS['this account already has an open flag of that kind']).toBe(
      'error.flagActiveExists',
    );
    expect(en['error.flagActiveExists']).toBe('this account already has an open flag of that kind');

    authedAdminDb({
      transitionSuspicionFlag: vi.fn(async () => ({ ok: false, error: 'not_found' })),
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const missing = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '999' },
      body: { status: 'cleared' },
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ success: false, data: null, error: 'flag not found' });
  });

  it('429s when the flag write limiter denies', async () => {
    const transitionSuspicionFlag = vi.fn();
    authedAdminDb({
      transitionSuspicionFlag,
      adminFlagWriteRateLimited: vi.fn(denied),
    });
    const r = await runRoute('POST', '/admin/api/flags/:id/status', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { status: 'cleared' },
    });
    expect(r.status).toBe(429);
    expect(transitionSuspicionFlag).not.toHaveBeenCalled();
  });
});

describe('POST /admin/api/flags/:id/note', () => {
  it('records a note and 400s an empty one', async () => {
    const addSuspicionFlagNote = vi.fn(async () => true);
    authedAdminDb({
      addSuspicionFlagNote,
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const ok = await runRoute('POST', '/admin/api/flags/:id/note', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { note: '  checked trade logs  ' },
    });
    expect(ok.status).toBe(200);
    expect(addSuspicionFlagNote).toHaveBeenCalledWith({
      flagId: 11,
      adminAccountId: ADMIN_ACCOUNT_ID,
      note: 'checked trade logs',
    });

    const empty = await runRoute('POST', '/admin/api/flags/:id/note', {
      headers: { authorization: BEARER },
      params: { id: '11' },
      body: { note: '   ' },
    });
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ success: false, data: null, error: 'a note is required' });
  });

  it('404s a note on a missing flag', async () => {
    authedAdminDb({
      addSuspicionFlagNote: vi.fn(async () => false),
      adminFlagWriteRateLimited: vi.fn(allowed),
    });
    const r = await runRoute('POST', '/admin/api/flags/:id/note', {
      headers: { authorization: BEARER },
      params: { id: '999' },
      body: { note: 'gone' },
    });
    expect(r.status).toBe(404);
  });
});
