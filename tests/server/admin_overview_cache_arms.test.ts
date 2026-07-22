// Arm-parity proof for the admin overview memo: the legacy handleAdminApi arm and
// the RouteDef arm both serve /admin/api/overview through ONE shared cache
// instance (server/admin_overview_cache.ts), so two requests inside the TTL cost
// one overviewCounts refresh, while each arm's live adminStats() merge still runs
// per-request. Deliberately NO setAdminDbForTests overviewCounts override here:
// that would replace the cache-backed bundle member and make the parity vacuous.
// Auth instead rides partial mocks over the real db/staff_db modules, which drive
// BOTH the legacy arm's direct imports and the real lazy bundle's members.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is
// unset; admin.ts imports it, so set a dummy URL. The pool never connects: the
// auth reads are mocked and the overview read goes through the injected fake.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_overview_arms';

import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
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
  configureAdminRuntime,
  handleAdminApi,
  resetAdminDbForTests,
  resetAdminRuntimeForTests,
  routes,
} from '../../server/admin';
import type { OverviewCounts } from '../../server/admin_db';
import {
  ADMIN_OVERVIEW_TTL_MS,
  resetOverviewCacheForTests,
  setOverviewCacheForTests,
} from '../../server/admin_overview_cache';
import { accountAndScopeForToken } from '../../server/db';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Method, Middleware } from '../../server/http/types';
import { adminRolesForAccount } from '../../server/staff_db';
import { type FakeRes, fakeCtx } from './helpers';

const BEARER = `Bearer ${'a'.repeat(64)}`;
const ADMIN_ACCOUNT_ID = 7;
const FIXED_NOW_MS = 1_000_000;

// Distinct value per field so a dropped field or a stale snapshot fails a pin.
// peakOnlineToday (10) loses to both arms' live online; peakOnlineAllTime (500)
// wins every merge it joins.
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

// Per-arm live stats with DIFFERENT online values: the merged bodies diverging
// on peakOnlineToday/server.online while sharing one refresh proves the counts
// are cached and the adminStats merge is per-request.
const LEGACY_STATS = {
  online: 40,
  onlineAccounts: 2,
  peakOnline: 20,
  uptimeSeconds: 100,
  tickMsAvg: 1.5,
  simEntities: 10,
  rssBytes: 1,
  heapUsedBytes: 1,
};
const ROUTE_STATS = {
  online: 60,
  onlineAccounts: 3,
  peakOnline: 25,
  uptimeSeconds: 200,
  tickMsAvg: 1,
  simEntities: 11,
  rssBytes: 2,
  heapUsedBytes: 2,
};

let nowMs = 0;
let calls = 0;

// --- Legacy arm harness (mirrors tests/admin.test.ts, trimmed to this route) ---

function fakeReq(): http.IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = 'GET';
  req.url = '/admin/api/overview';
  req.headers = { authorization: BEARER };
  req.socket = { remoteAddress: '10.0.0.1' };
  return req as unknown as http.IncomingMessage;
}

interface LegacyRes {
  statusCode: number;
  body: unknown;
  writeHead(status: number): void;
  end(data?: string): void;
}

function legacyRes(): LegacyRes & http.ServerResponse {
  const res: LegacyRes = {
    statusCode: 0,
    body: undefined,
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res as LegacyRes & http.ServerResponse;
}

const fakeGame = { adminStats: () => LEGACY_STATS } as unknown as Parameters<
  typeof handleAdminApi
>[2];

async function runLegacyOverview() {
  const res = legacyRes();
  await handleAdminApi(fakeReq(), res, fakeGame);
  return { status: res.statusCode, body: res.body };
}

// --- RouteDef arm harness (mirrors tests/server/admin.test.ts, trimmed) ---

function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

async function runRouteOverview() {
  const route = routeFor('GET', '/admin/api/overview');
  const ctx = fakeCtx({ method: 'GET', url: route.path, headers: { authorization: BEARER } });
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
  return { status: fake.statusCode, body: JSON.parse(fake.body) as unknown };
}

beforeEach(() => {
  resetOverviewCacheForTests();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  nowMs = FIXED_NOW_MS;
  calls = 0;
  setOverviewCacheForTests({
    query: async () => {
      calls += 1;
      return COUNTS;
    },
    now: () => nowMs,
  });
  vi.mocked(accountAndScopeForToken).mockResolvedValue({
    accountId: ADMIN_ACCOUNT_ID,
    scope: 'full',
  });
  vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'op', roles: ['superadmin'] });
  configureAdminRuntime({ adminStats: vi.fn(() => ROUTE_STATS) } as unknown as AdminRuntime);
});

afterEach(() => {
  resetOverviewCacheForTests();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  vi.clearAllMocks();
});

describe('admin overview cache arm parity', () => {
  it('both arms reject a staff read token before staff or overview reads', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue({
      accountId: ADMIN_ACCOUNT_ID,
      scope: 'read',
    });
    vi.mocked(adminRolesForAccount).mockClear();

    const legacy = await runLegacyOverview();
    const routed = await runRouteOverview();

    const body = {
      success: false,
      data: null,
      error: 'admin authentication required',
    };
    expect(legacy).toEqual({ status: 401, body });
    expect(routed).toEqual({ status: 401, body });
    expect(adminRolesForAccount).not.toHaveBeenCalled();
    expect(calls).toBe(0);
  });

  it('both arms share the singleton: two requests inside the TTL, one refresh', async () => {
    const legacy = await runLegacyOverview();
    const routed = await runRouteOverview();

    // One refresh served both dispatch arms.
    expect(calls).toBe(1);

    // Legacy arm: cached counts merged with ITS live stats (online 40).
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({
        accounts: 101,
        siteUsersNow: 5,
        peakOnlineToday: 40,
        peakOnlineAllTime: 500,
        server: expect.objectContaining({ online: 40, peakOnline: 500 }),
      }),
    });

    // RouteDef arm: the SAME cached counts merged with ITS live stats (online
    // 60), so the Math.max merges ran per-request over one shared snapshot.
    expect(routed.status).toBe(200);
    expect(routed.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({
        accounts: 101,
        siteUsersNow: 5,
        peakOnlineToday: 60,
        peakOnlineAllTime: 500,
        server: expect.objectContaining({ online: 60, peakOnline: 500 }),
      }),
    });
  });

  it('route-first order shares the same singleton: a warm legacy request re-uses the refresh', async () => {
    const routed = await runRouteOverview();
    expect(calls).toBe(1);
    expect(routed.status).toBe(200);

    // The legacy arm arrives second, inside the TTL: still one refresh, and
    // its OWN live stats merged over the shared snapshot.
    const legacy = await runLegacyOverview();
    expect(calls).toBe(1);
    expect(legacy.status).toBe(200);
    expect(legacy.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({
        accounts: 101,
        peakOnlineToday: 40,
        server: expect.objectContaining({ online: 40, peakOnline: 500 }),
      }),
    });
  });

  it('the TTL is live through the arms: a request past the TTL re-queries', async () => {
    // Same-file literal pin so the clock advance below cannot degrade into a
    // constant-self-comparison if the module's TTL drifts.
    expect(ADMIN_OVERVIEW_TTL_MS).toBe(60_000);
    await runLegacyOverview();
    expect(calls).toBe(1);

    nowMs += ADMIN_OVERVIEW_TTL_MS;
    const routed = await runRouteOverview();
    expect(calls).toBe(2);
    expect(routed.status).toBe(200);
    expect(routed.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({ accounts: 101, peakOnlineToday: 60 }),
    });
  });
});
