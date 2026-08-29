// Legacy-arm coverage for the admin economy-oversight routes: the flag-off
// rollback path (API_DISPATCH=legacy) serves every one of the six routes from
// the inline handleAdminApi ladder in server/admin.ts, not the RouteDef table
// tests/server/admin_oversight.test.ts drives. Until the ladder is deleted the
// two arms are dual-edited, so each contract pinned there (the 401 body, the
// central permission gate, the happy-path envelopes, the dedicated oversight
// limiters) needs its own pin on this arm.
//
// Harness: the tests/server/admin_overview_cache_arms.test.ts idiom. The ladder
// calls the db modules DIRECTLY (no setAdminDbForTests bundle on this arm), so
// auth and the four flag/wealth reads ride partial mocks over the real modules,
// and the two cache-backed reads (top holders, the flag dataset) ride their
// configure* injection seams. The rate limiters are the real ones, reset per
// test under a pinned clock.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_oversight_legacy';

import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The flag-count redaction's negative arm needs a caller holding accounts.read
// WITHOUT moderation.read; no shipped role does (pinned by
// tests/server/admin_oversight_redaction.test.ts), so the same synthetic-role
// passthrough over permissionsForRoles mints one here for the legacy ladder.
const synthetic = vi.hoisted(() => ({ ACCOUNTS_ONLY_ROLE: 'accounts-only-synthetic' }));

vi.mock('../../server/admin_permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/admin_permissions')>();
  const permissionsForRoles: typeof actual.permissionsForRoles = (roles) =>
    roles.includes(synthetic.ACCOUNTS_ONLY_ROLE)
      ? new Set(['accounts.read'])
      : actual.permissionsForRoles(roles);
  return { ...actual, permissionsForRoles };
});
vi.mock('../../server/admin_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/admin_db')>();
  return { ...actual, listAccounts: vi.fn() };
});
vi.mock('../../server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db')>();
  return { ...actual, accountAndScopeForToken: vi.fn() };
});
vi.mock('../../server/staff_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/staff_db')>();
  return { ...actual, adminRolesForAccount: vi.fn() };
});
vi.mock('../../server/account_wealth_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/account_wealth_db')>();
  return { ...actual, accountWealthBreakdown: vi.fn(), largeGoldMovementsForAccount: vi.fn() };
});
vi.mock('../../server/suspicion_flags_db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/suspicion_flags_db')>();
  return {
    ...actual,
    activeSuspicionFlagCounts: vi.fn(),
    suspicionFlagsForAccount: vi.fn(),
    transitionSuspicionFlag: vi.fn(),
    addSuspicionFlagNote: vi.fn(),
  };
});

import {
  configureTopWealthHolders,
  LARGE_GOLD_MOVEMENT_LIMIT,
  resetTopWealthHoldersForTests,
} from '../../server/account_wealth';
import {
  accountWealthBreakdown,
  largeGoldMovementsForAccount,
} from '../../server/account_wealth_db';
import { handleAdminApi } from '../../server/admin';
import { listAccounts } from '../../server/admin_db';
import { accountAndScopeForToken } from '../../server/db';
import {
  ADMIN_FLAG_WRITE_MAX_PER_MINUTE,
  ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE,
  resetAdminOversightRateLimits,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { adminRolesForAccount } from '../../server/staff_db';
import {
  configureSuspicionFlagDataset,
  resetSuspicionFlagDatasetForTests,
} from '../../server/suspicion_flags';
import {
  activeSuspicionFlagCounts,
  addSuspicionFlagNote,
  type SuspicionFlagDataset,
  suspicionFlagsForAccount,
  transitionSuspicionFlag,
} from '../../server/suspicion_flags_db';

const VALID_TOKEN = 'a'.repeat(64);
const ADMIN_ACCOUNT_ID = 7;
const FIXED_NOW_MS = 1_700_000_000_000;

const UNAUTHENTICATED = { success: false, data: null, error: 'admin authentication required' };
const FORBIDDEN = { success: false, data: null, error: 'you do not have permission to do this' };
const TOO_MANY = {
  success: false,
  data: null,
  error: 'too many requests, wait a moment and try again',
};

// Same shape as tests/admin.test.ts's fakeReq: the ladder's readBody drains
// 'data'/'end' events, emitted on the next macrotask for a POST.
interface ReqOpts {
  method?: 'GET' | 'POST';
  url: string;
  token?: string;
  body?: unknown;
}

function fakeReq(opts: ReqOpts): http.IncomingMessage {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = opts.method ?? 'GET';
  req.url = opts.url;
  req.headers = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  req.socket = { remoteAddress: '10.0.0.1' };
  if (req.method === 'POST') {
    setImmediate(() => {
      if (opts.body !== undefined) req.emit('data', JSON.stringify(opts.body));
      req.emit('end');
    });
  }
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

// None of the six routes touch the game server; a stub that throws on any
// member access pins that.
const fakeGame = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`oversight route touched game.${String(prop)}`);
    },
  },
) as Parameters<typeof handleAdminApi>[2];

async function legacy(opts: ReqOpts) {
  const res = legacyRes();
  await handleAdminApi(fakeReq(opts), res, fakeGame);
  return { status: res.statusCode, body: res.body };
}

const authed = (opts: ReqOpts) => legacy({ ...opts, token: VALID_TOKEN });

function actAs(roles: string[]): void {
  vi.mocked(accountAndScopeForToken).mockResolvedValue({
    accountId: ADMIN_ACCOUNT_ID,
    scope: 'full',
  });
  vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'op', roles });
}

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

const BREAKDOWN = {
  accountId: 42,
  purseCopper: 100,
  mailCopper: 10,
  marketCopper: 5,
  totalCopper: 115,
  updatedAt: '2026-08-18T00:00:00Z',
  characters: [],
};
const MOVEMENTS = [{ id: 1, op: 'withdraw_gold', copperDelta: -200_000 }];
const HISTORY = { flags: [FLAG_ROW], events: [{ id: 1, flagId: 11 }] };

type Sources = { topHolders: ReturnType<typeof vi.fn>; dataset: ReturnType<typeof vi.fn> };
let sources: Sources;

// Every route, with the params the RouteDef suite uses, so the two files cover
// the same six paths on their respective arms.
const ROUTES: { method: 'GET' | 'POST'; url: string; body?: unknown }[] = [
  { method: 'GET', url: '/admin/api/wealth/top' },
  { method: 'GET', url: '/admin/api/accounts/42/wealth' },
  { method: 'GET', url: '/admin/api/accounts/42/flags' },
  { method: 'GET', url: '/admin/api/flags' },
  { method: 'POST', url: '/admin/api/flags/11/status', body: { status: 'cleared' } },
  { method: 'POST', url: '/admin/api/flags/11/note', body: { note: 'hello' } },
];

function expectNoStoreReached(): void {
  expect(sources.topHolders).not.toHaveBeenCalled();
  expect(sources.dataset).not.toHaveBeenCalled();
  expect(accountWealthBreakdown).not.toHaveBeenCalled();
  expect(largeGoldMovementsForAccount).not.toHaveBeenCalled();
  expect(suspicionFlagsForAccount).not.toHaveBeenCalled();
  expect(transitionSuspicionFlag).not.toHaveBeenCalled();
  expect(addSuspicionFlagNote).not.toHaveBeenCalled();
}

beforeEach(() => {
  setRateLimitClock(() => FIXED_NOW_MS);
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetTopWealthHoldersForTests();
  resetSuspicionFlagDatasetForTests();
  sources = {
    topHolders: vi.fn(async () => [RICH_ROW]),
    dataset: vi.fn(async () => DATASET),
  };
  configureTopWealthHolders(sources.topHolders as () => Promise<(typeof RICH_ROW)[]>);
  configureSuspicionFlagDataset(sources.dataset as unknown as () => Promise<SuspicionFlagDataset>);
  vi.mocked(accountWealthBreakdown).mockResolvedValue(BREAKDOWN);
  vi.mocked(largeGoldMovementsForAccount).mockResolvedValue(
    MOVEMENTS as unknown as Awaited<ReturnType<typeof largeGoldMovementsForAccount>>,
  );
  vi.mocked(suspicionFlagsForAccount).mockResolvedValue(
    HISTORY as unknown as Awaited<ReturnType<typeof suspicionFlagsForAccount>>,
  );
  vi.mocked(transitionSuspicionFlag).mockResolvedValue({
    ok: true,
    flag: { ...FLAG_ROW, status: 'under_review' },
  } as unknown as Awaited<ReturnType<typeof transitionSuspicionFlag>>);
  vi.mocked(addSuspicionFlagNote).mockResolvedValue(true);
});

afterEach(() => {
  resetRateLimits();
  resetAdminOversightRateLimits();
  resetRateLimitClock();
  resetTopWealthHoldersForTests();
  resetSuspicionFlagDatasetForTests();
  vi.clearAllMocks();
});

describe('legacy handleAdminApi arm: the auth gate on every oversight route', () => {
  it('401s every route without a bearer, before any staff or store read', async () => {
    actAs(['superadmin']);
    for (const route of ROUTES) {
      const r = await legacy(route);
      expect(r.status, `${route.method} ${route.url}`).toBe(401);
      expect(r.body, `${route.method} ${route.url}`).toEqual(UNAUTHENTICATED);
    }
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
    expect(adminRolesForAccount).not.toHaveBeenCalled();
    expectNoStoreReached();
  });

  it('403s both workflow writes for a viewer (moderation.read without moderation.act)', async () => {
    actAs(['viewer']);
    for (const route of ROUTES.filter((r) => r.method === 'POST')) {
      const r = await authed(route);
      expect(r.status, route.url).toBe(403);
      expect(r.body, route.url).toEqual(FORBIDDEN);
    }
    expect(transitionSuspicionFlag).not.toHaveBeenCalled();
    expect(addSuspicionFlagNote).not.toHaveBeenCalled();
  });

  it('403s every read for a role holding neither accounts.read nor moderation.read', async () => {
    // No shipped role separates the two read permissions, so an unknown role
    // (which resolves to an empty permission set) pins the closed gate on all
    // four reads at once.
    actAs(['unknown-role']);
    for (const route of ROUTES.filter((r) => r.method === 'GET')) {
      const r = await authed(route);
      expect(r.status, route.url).toBe(403);
      expect(r.body, route.url).toEqual(FORBIDDEN);
    }
    expectNoStoreReached();
  });
});

describe('legacy handleAdminApi arm: happy paths', () => {
  beforeEach(() => actAs(['superadmin']));

  it('GET /admin/api/wealth/top serves the cached rich list with flag counts for moderation.read', async () => {
    const r = await authed({ url: '/admin/api/wealth/top' });
    expect(r).toEqual({
      status: 200,
      body: { success: true, data: { rows: [RICH_ROW] }, error: null },
    });
    // A second read inside the TTL is served from the shared cache.
    await authed({ url: '/admin/api/wealth/top' });
    expect(sources.topHolders).toHaveBeenCalledTimes(1);
  });

  it('GET /admin/api/accounts/:id/wealth appends the large movements to the breakdown', async () => {
    const r = await authed({ url: '/admin/api/accounts/42/wealth' });
    expect(accountWealthBreakdown).toHaveBeenCalledWith(42);
    expect(largeGoldMovementsForAccount).toHaveBeenCalledWith(42, LARGE_GOLD_MOVEMENT_LIMIT);
    expect(r).toEqual({
      status: 200,
      body: { success: true, data: { ...BREAKDOWN, largeMovements: MOVEMENTS }, error: null },
    });
  });

  it('GET /admin/api/accounts/:id/wealth degrades a failed ledger read to an empty, flagged list', async () => {
    // largeGoldMovementsForAccount carries a 2 s statement bound; a timeout
    // there must not fail the pane whose breakdown is already computed.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      vi.mocked(largeGoldMovementsForAccount).mockRejectedValue(
        new Error('canceling statement due to statement timeout'),
      );
      const r = await authed({ url: '/admin/api/accounts/42/wealth' });
      expect(r).toEqual({
        status: 200,
        body: {
          success: true,
          data: { ...BREAKDOWN, largeMovements: [], largeMovementsUnavailable: true },
          error: null,
        },
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toMatch(
        /large gold movements read failed for account 42/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('GET /admin/api/accounts/:id/wealth 404s an unknown account', async () => {
    vi.mocked(accountWealthBreakdown).mockResolvedValue(null);
    const r = await authed({ url: '/admin/api/accounts/404/wealth' });
    expect(r).toEqual({
      status: 404,
      body: { success: false, data: null, error: 'account not found' },
    });
    expect(largeGoldMovementsForAccount).not.toHaveBeenCalled();
  });

  it('GET /admin/api/accounts/:id/flags returns the account history with events', async () => {
    const r = await authed({ url: '/admin/api/accounts/42/flags' });
    expect(suspicionFlagsForAccount).toHaveBeenCalledWith(42);
    expect(r).toEqual({ status: 200, body: { success: true, data: HISTORY, error: null } });
  });

  it('GET /admin/api/flags defaults to the active tab with counts, and filters by status', async () => {
    const active = await authed({ url: '/admin/api/flags' });
    expect(active).toEqual({
      status: 200,
      body: {
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
      },
    });
    const cleared = await authed({ url: '/admin/api/flags?status=cleared' });
    expect(
      (cleared.body as { data: { rows: { id: number }[] } }).data.rows.map((f) => f.id),
    ).toEqual([12]);
    expect(sources.dataset).toHaveBeenCalledTimes(1);
  });

  it('POST /admin/api/flags/:id/status applies the transition as the acting admin', async () => {
    const r = await authed({
      method: 'POST',
      url: '/admin/api/flags/11/status',
      body: { status: 'under_review', note: 'taking a look' },
    });
    expect(transitionSuspicionFlag).toHaveBeenCalledWith({
      flagId: 11,
      adminAccountId: ADMIN_ACCOUNT_ID,
      to: 'under_review',
      note: 'taking a look',
    });
    expect(r).toEqual({
      status: 200,
      body: { success: true, data: { flag: { ...FLAG_ROW, status: 'under_review' } }, error: null },
    });
  });

  it('POST /admin/api/flags/:id/status 400s an unknown status before any db write', async () => {
    const r = await authed({
      method: 'POST',
      url: '/admin/api/flags/11/status',
      body: { status: 'frobnicated' },
    });
    expect(r).toEqual({
      status: 400,
      body: { success: false, data: null, error: 'invalid flag status' },
    });
    expect(transitionSuspicionFlag).not.toHaveBeenCalled();
  });

  it('POST /admin/api/flags/:id/note records the trimmed note and 400s an empty one', async () => {
    const ok = await authed({
      method: 'POST',
      url: '/admin/api/flags/11/note',
      body: { note: '  checked trade logs  ' },
    });
    expect(addSuspicionFlagNote).toHaveBeenCalledWith({
      flagId: 11,
      adminAccountId: ADMIN_ACCOUNT_ID,
      note: 'checked trade logs',
    });
    expect(ok).toEqual({ status: 200, body: { success: true, data: { ok: true }, error: null } });

    const empty = await authed({
      method: 'POST',
      url: '/admin/api/flags/11/note',
      body: { note: '   ' },
    });
    expect(empty).toEqual({
      status: 400,
      body: { success: false, data: null, error: 'a note is required' },
    });
    expect(addSuspicionFlagNote).toHaveBeenCalledTimes(1);
  });
});

describe('legacy handleAdminApi arm: flag-count redaction for accounts.read without moderation.read', () => {
  beforeEach(() => {
    actAs([synthetic.ACCOUNTS_ONLY_ROLE]);
    vi.mocked(listAccounts).mockResolvedValue(
      ACCOUNT_LIST as unknown as Awaited<ReturnType<typeof listAccounts>>,
    );
    vi.mocked(activeSuspicionFlagCounts).mockResolvedValue(new Map([[42, 3]]));
  });

  it('GET /admin/api/wealth/top strips activeFlagCount from every row', async () => {
    const r = await authed({ url: '/admin/api/wealth/top' });
    expect(r).toEqual({
      status: 200,
      body: { success: true, data: { rows: [RICH_ROW_REDACTED] }, error: null },
    });
    const rows = (r.body as { data: { rows: Record<string, unknown>[] } }).data.rows;
    expect('activeFlagCount' in rows[0]).toBe(false);
  });

  it('GET /admin/api/accounts never reads the flag counts and stamps none', async () => {
    const r = await authed({ url: '/admin/api/accounts?search=sus' });
    expect(r).toEqual({ status: 200, body: { success: true, data: ACCOUNT_LIST, error: null } });
    expect(listAccounts).toHaveBeenCalledWith('sus', 1, 25, expect.any(String), expect.any(String));
    expect(activeSuspicionFlagCounts).not.toHaveBeenCalled();
    const rows = (r.body as { data: { rows: Record<string, unknown>[] } }).data.rows;
    for (const row of rows) expect('activeFlagCount' in row).toBe(false);
  });

  it('GET /admin/api/accounts stamps every row for a superadmin (the positive arm)', async () => {
    actAs(['superadmin']);
    const r = await authed({ url: '/admin/api/accounts' });
    expect(activeSuspicionFlagCounts).toHaveBeenCalledWith([42, 43]);
    expect(r).toEqual({
      status: 200,
      body: {
        success: true,
        data: {
          ...ACCOUNT_LIST,
          rows: [
            { ...ACCOUNT_LIST.rows[0], activeFlagCount: 3 },
            { ...ACCOUNT_LIST.rows[1], activeFlagCount: 0 },
          ],
        },
        error: null,
      },
    });
  });
});

describe('legacy handleAdminApi arm: the dedicated oversight limiters', () => {
  beforeEach(() => actAs(['superadmin']));

  it('429s the flag queue read past ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE', async () => {
    for (let i = 0; i < ADMIN_OVERSIGHT_READ_MAX_PER_MINUTE; i++) {
      expect((await authed({ url: '/admin/api/flags' })).status, `read ${i + 1}`).toBe(200);
    }
    const r = await authed({ url: '/admin/api/flags' });
    expect(r).toEqual({ status: 429, body: TOO_MANY });
    // The read bucket is separate from the write bucket: a write still lands.
    const write = await authed({
      method: 'POST',
      url: '/admin/api/flags/11/note',
      body: { note: 'still allowed' },
    });
    expect(write.status).toBe(200);
  });

  it('429s a flag write past ADMIN_FLAG_WRITE_MAX_PER_MINUTE without touching the store', async () => {
    for (let i = 0; i < ADMIN_FLAG_WRITE_MAX_PER_MINUTE; i++) {
      const r = await authed({
        method: 'POST',
        url: '/admin/api/flags/11/note',
        body: { note: `note ${i}` },
      });
      expect(r.status, `write ${i + 1}`).toBe(200);
    }
    const r = await authed({
      method: 'POST',
      url: '/admin/api/flags/11/note',
      body: { note: 'one too many' },
    });
    expect(r).toEqual({ status: 429, body: TOO_MANY });
    expect(addSuspicionFlagNote).toHaveBeenCalledTimes(ADMIN_FLAG_WRITE_MAX_PER_MINUTE);
  });
});
