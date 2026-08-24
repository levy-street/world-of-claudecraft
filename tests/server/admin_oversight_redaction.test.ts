// Endpoint proof for the flag-count redaction rule on the RouteDef arm: the
// rich list (GET /admin/api/wealth/top) and the account list
// (GET /admin/api/accounts) both stamp active suspicion-flag counts on their
// rows, and both must strip them for a caller holding accounts.read WITHOUT
// moderation.read (the flag store is moderation data). redactActiveFlagCounts
// is unit tested in isolation; this file pins that the endpoints actually
// route through the permission check.
//
// No shipped role holds accounts.read without moderation.read (viewer,
// moderator, admin, and superadmin all carry both), so the negative arm rides
// a SYNTHETIC role minted by a passthrough mock over permissionsForRoles: every
// real role still resolves through the real map, and one extra role name
// resolves to exactly { accounts.read }. The vocabulary guard at the bottom
// says when a real role can replace it.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_oversight_redaction';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const synthetic = vi.hoisted(() => ({ ACCOUNTS_ONLY_ROLE: 'accounts-only-synthetic' }));

vi.mock('../../server/admin_permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/admin_permissions')>();
  const permissionsForRoles: typeof actual.permissionsForRoles = (roles) =>
    roles.includes(synthetic.ACCOUNTS_ONLY_ROLE)
      ? new Set(['accounts.read'])
      : actual.permissionsForRoles(roles);
  return { ...actual, permissionsForRoles };
});

import { resetAdminDbForTests, routes, setAdminDbForTests } from '../../server/admin';
import { permissionsForRoles, ROLE_PERMISSIONS } from '../../server/admin_permissions';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import {
  resetAdminOversightRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;
const FIXED_NOW_MS = 1_700_000_000_000;

type DbOverrides = Record<string, unknown>;

function authedAdminDb(overrides: DbOverrides, roles: string[]): void {
  setAdminDbForTests({
    accountAndScopeForToken: async () => ({ accountId: ADMIN_ACCOUNT_ID, scope: 'full' }),
    adminRolesForAccount: async (id: number) =>
      id === ADMIN_ACCOUNT_ID ? { username: 'op', roles } : null,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  } as Parameters<typeof setAdminDbForTests>[0]);
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

async function runRoute(method: Method, path: string, url = path) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  const ctx = fakeCtx({ method, url, headers: { authorization: BEARER } });
  const terminal: Middleware = async (c) => {
    await route.handler(c);
  };
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return readRes(ctx.res);
}

type AdminDbBundle = Parameters<typeof setAdminDbForTests>[0];
const allowed = (): ReturnType<NonNullable<AdminDbBundle['adminOversightReadRateLimited']>> => ({
  allowed: true,
  remaining: 1,
  resetSeconds: 0,
});

// A fixture row that HAS a non-zero count, so a missing key is a real strip,
// never a zero that happened to be absent.
const RICH_ROW = {
  accountId: 1,
  username: 'rich',
  purseCopper: 9_000,
  mailCopper: 500,
  marketCopper: 499,
  totalCopper: 9_999,
  maxLevel: 60,
  lastLogin: null,
  bannedAt: null,
  suspendedUntil: null,
  activeFlagCount: 2,
  updatedAt: '2026-08-18T00:00:00Z',
};
const { activeFlagCount: _stripped, ...RICH_ROW_REDACTED } = RICH_ROW;

const ACCOUNT_LIST = {
  rows: [
    { id: 42, username: 'suspect', totalCopper: 25_000 },
    { id: 43, username: 'other', totalCopper: 10 },
  ],
  total: 2,
  page: 1,
  limit: 25,
};

function rowsOf(body: unknown): Record<string, unknown>[] {
  return (body as { data: { rows: Record<string, unknown>[] } }).data.rows;
}

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

describe('the synthetic accounts-only role', () => {
  it('holds accounts.read and nothing else (the negative arm is not vacuous)', () => {
    const permissions = permissionsForRoles([synthetic.ACCOUNTS_ONLY_ROLE]);
    expect([...permissions]).toEqual(['accounts.read']);
    expect(permissions.has('moderation.read')).toBe(false);
  });

  it('is needed because no real role holds accounts.read without moderation.read', () => {
    // When this fails, a real role now separates the two permissions: swap it
    // in for the synthetic one below and drop the permissionsForRoles mock.
    expect(Object.keys(ROLE_PERMISSIONS).length).toBeGreaterThan(0);
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (!permissions.includes('accounts.read')) continue;
      expect(permissions, `${role} separates accounts.read from moderation.read`).toContain(
        'moderation.read',
      );
    }
  });
});

describe('GET /admin/api/wealth/top flag-count redaction', () => {
  it('strips activeFlagCount for accounts.read without moderation.read', async () => {
    const topWealthHolders = vi.fn(async () => [RICH_ROW]);
    authedAdminDb({ topWealthHolders, adminOversightReadRateLimited: vi.fn(allowed) }, [
      synthetic.ACCOUNTS_ONLY_ROLE,
    ]);
    const r = await runRoute('GET', '/admin/api/wealth/top');
    expect(r.status).toBe(200);
    expect(topWealthHolders).toHaveBeenCalledTimes(1);
    expect(r.body).toEqual({ success: true, data: { rows: [RICH_ROW_REDACTED] }, error: null });
    expect('activeFlagCount' in rowsOf(r.body)[0]).toBe(false);
  });

  it('keeps activeFlagCount for a superadmin and for a moderation.read viewer', async () => {
    for (const roles of [['superadmin'], ['viewer']]) {
      authedAdminDb(
        {
          topWealthHolders: vi.fn(async () => [RICH_ROW]),
          adminOversightReadRateLimited: vi.fn(allowed),
        },
        roles,
      );
      const r = await runRoute('GET', '/admin/api/wealth/top');
      expect(r.status, roles.join()).toBe(200);
      expect(r.body, roles.join()).toEqual({
        success: true,
        data: { rows: [RICH_ROW] },
        error: null,
      });
      expect(rowsOf(r.body)[0].activeFlagCount, roles.join()).toBe(2);
    }
  });
});

describe('GET /admin/api/accounts flag-count redaction', () => {
  it('never reads the flag counts for accounts.read without moderation.read', async () => {
    const listAccounts = vi.fn(async () => ACCOUNT_LIST);
    const activeSuspicionFlagCounts = vi.fn(async () => new Map([[42, 3]]));
    authedAdminDb({ listAccounts, activeSuspicionFlagCounts }, [synthetic.ACCOUNTS_ONLY_ROLE]);
    const r = await runRoute('GET', '/admin/api/accounts', '/admin/api/accounts?search=sus');
    expect(r.status).toBe(200);
    expect(listAccounts).toHaveBeenCalledWith('sus', 1, 25, expect.any(String), expect.any(String));
    expect(activeSuspicionFlagCounts).not.toHaveBeenCalled();
    expect(r.body).toEqual({ success: true, data: ACCOUNT_LIST, error: null });
    for (const row of rowsOf(r.body)) expect('activeFlagCount' in row).toBe(false);
  });

  it('stamps every row with its active flag count for a superadmin (zero when unflagged)', async () => {
    const activeSuspicionFlagCounts = vi.fn(async () => new Map([[42, 3]]));
    authedAdminDb({ listAccounts: vi.fn(async () => ACCOUNT_LIST), activeSuspicionFlagCounts }, [
      'superadmin',
    ]);
    const r = await runRoute('GET', '/admin/api/accounts');
    expect(r.status).toBe(200);
    expect(activeSuspicionFlagCounts).toHaveBeenCalledWith([42, 43]);
    expect(r.body).toEqual({
      success: true,
      data: {
        ...ACCOUNT_LIST,
        rows: [
          { ...ACCOUNT_LIST.rows[0], activeFlagCount: 3 },
          { ...ACCOUNT_LIST.rows[1], activeFlagCount: 0 },
        ],
      },
      error: null,
    });
  });
});
