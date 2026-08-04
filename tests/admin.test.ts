import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layers so no Postgres is needed; the router logic is under test.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  findAccount: vi.fn(),
  touchLogin: vi.fn(),
  saveToken: vi.fn(),
  accountAndScopeForToken: vi.fn(),
  isAdminAccount: vi.fn(),
  accountMailTarget: vi.fn(async () => null),
  accountById: vi.fn(),
  updatePasswordHash: vi.fn(),
  revokeTokensExcept: vi.fn(),
}));
vi.mock('../server/admin_db', async () => {
  const actual = await vi.importActual<typeof import('../server/admin_db')>('../server/admin_db');
  return {
    escapeLike: actual.escapeLike,
    overviewCounts: vi.fn(),
    registrationsByDay: vi.fn(),
    sessionsByDay: vi.fn(),
    classDistribution: vi.fn(),
    levelDistribution: vi.fn(),
    onlineHistory: vi.fn(),
    listAccounts: vi.fn(),
    listCharacters: vi.fn(),
    listSharedIps: vi.fn(),
    accountDetail: vi.fn(),
    associationsForIp: vi.fn(),
    characterProfessionsRow: vi.fn(),
    clientPerfSummary: vi.fn(),
    clientPerfRaw: vi.fn(),
  };
});
vi.mock('../server/admin_guilds_db', () => ({
  listAdminGuilds: vi.fn(),
  adminGuildDetail: vi.fn(),
  listAdminGuildHistory: vi.fn(),
  renameAdminGuild: vi.fn(),
}));
vi.mock('../server/auth', () => ({
  verifyPassword: vi.fn(async () => false),
  newToken: vi.fn(() => 'b'.repeat(64)),
  hashPassword: vi.fn(async () => 'salt:hashed'),
  MIN_PASSWORD_LENGTH: 6,
  MAX_PASSWORD_LENGTH: 128,
}));
vi.mock('../server/account', () => ({
  verifyLoginTwoFactor: vi.fn(async () => false),
}));
vi.mock('../server/moderation_db', () => ({
  forceCharacterRename: vi.fn(),
  recordProfessionsRestore: vi.fn(),
  moderationQueue: vi.fn(),
  moderationReportsForAccount: vi.fn(),
  ignoreReport: vi.fn(),
  liftAccountChatMute: vi.fn(),
  moderateAccount: vi.fn(),
  muteAccountChat: vi.fn(),
  reactivateAccountAudited: vi.fn(),
  recordPasswordReset: vi.fn(),
  resetChatStrikesAudited: vi.fn(),
}));
vi.mock('../server/chat_filter_db', () => ({
  addFilterWord: vi.fn(),
  chatModeratedAccounts: vi.fn(async () => []),
  chatModerationForAccount: vi.fn(),
  getFilterConfig: vi.fn(),
  listFilterWords: vi.fn(),
  removeFilterWord: vi.fn(),
  updateFilterConfig: vi.fn(),
}));
vi.mock('../server/ip_block_db', () => ({
  addBlockedIp: vi.fn(async () => '1.2.3.4'),
  removeBlockedIp: vi.fn(async () => true),
  listBlockedIps: vi.fn(async () => []),
  cleanIp: (v: unknown) => {
    const value = typeof v === 'string' ? v.trim() : '';
    return isIP(value) ? value : '';
  },
}));
// The staff-role identity delegates to the mocked isAdminAccount by default, so
// the pre-permissions tests keep their exact call order (actor check first,
// then the sanction-target check). Permission-specific tests override it.
vi.mock('../server/staff_db', () => ({
  adminRolesForAccount: vi.fn(async (accountId: number) => {
    const { isAdminAccount } = await import('../server/db');
    return (await isAdminAccount(accountId)) ? { username: 'admin', roles: ['superadmin'] } : null;
  }),
  listStaff: vi.fn(async () => []),
  setAccountAdminRoles: vi.fn(),
  roleChangeHistory: vi.fn(async () => []),
}));

import { verifyLoginTwoFactor } from '../server/account';
import {
  configureAdminPlayersCap,
  handleAdminApi,
  parsePageParams,
  resetAdminPlayersCapForTests,
} from '../server/admin';
import {
  accountDetail,
  associationsForIp,
  characterProfessionsRow,
  clientPerfRaw,
  clientPerfSummary,
  escapeLike,
  listAccounts,
  listCharacters,
  listSharedIps,
  onlineHistory,
  overviewCounts,
  type PerfRawRow,
} from '../server/admin_db';
import {
  adminGuildDetail,
  listAdminGuildHistory,
  listAdminGuilds,
  renameAdminGuild,
} from '../server/admin_guilds_db';
import { resetAdminGuildListReadsForTests } from '../server/admin_guilds_read';
import { resetOverviewCacheForTests } from '../server/admin_overview_cache';
import { hashPassword, verifyPassword } from '../server/auth';
import type { CalibrationHistogram, SuspiciousPlayer } from '../server/bot_detector/contract';
import {
  addFilterWord,
  chatModerationForAccount,
  getFilterConfig,
  listFilterWords,
  removeFilterWord,
  updateFilterConfig,
} from '../server/chat_filter_db';
import {
  accountAndScopeForToken,
  accountById,
  accountMailTarget,
  findAccount,
  isAdminAccount,
  pool,
  revokeTokensExcept,
  updatePasswordHash,
} from '../server/db';
import { addBlockedIp, removeBlockedIp } from '../server/ip_block_db';
import type { LiveSharedIp } from '../server/live_shared_ips';
import {
  forceCharacterRename,
  ignoreReport,
  liftAccountChatMute,
  moderateAccount,
  moderationQueue,
  moderationReportsForAccount,
  muteAccountChat,
  reactivateAccountAudited,
  recordPasswordReset,
  recordProfessionsRestore,
  resetChatStrikesAudited,
} from '../server/moderation_db';
import { authFailureCount, resetAuthFailures } from '../server/ratelimit';
import {
  adminRolesForAccount,
  listStaff,
  roleChangeHistory,
  setAccountAdminRoles,
} from '../server/staff_db';

const VALID_TOKEN = 'a'.repeat(64);
const fullToken = (accountId: number) => ({ accountId, scope: 'full' as const });

function fakeReq(
  opts: { method?: string; url?: string; token?: string; body?: unknown; ip?: string } = {},
) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = opts.method ?? 'GET';
  req.url = opts.url ?? '/admin/api/overview';
  req.headers = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  // A per-call source IP: random by default, or pinned via opts.ip so a test can
  // simulate a distributed attacker who never repeats a source address.
  req.socket = { remoteAddress: opts.ip ?? `10.0.0.${Math.floor(Math.random() * 250) + 1}` };
  if (opts.method === 'POST') {
    setImmediate(() => {
      if (opts.body !== undefined) req.emit('data', JSON.stringify(opts.body));
      req.emit('end');
    });
  }
  return req as unknown as IncomingMessage;
}

interface AdminJson {
  [key: string]: AdminJson;
  [key: number]: AdminJson;
}

interface FakeResponse {
  statusCode: number;
  body: AdminJson;
  writeHead(status: number): void;
  end(data?: string): void;
}

function fakeRes(): FakeResponse & ServerResponse {
  const res: FakeResponse = {
    statusCode: 0,
    body: {},
    writeHead(status: number) {
      this.statusCode = status;
    },
    end(data?: string) {
      this.body = data ? JSON.parse(data) : null;
    },
  };
  return res as FakeResponse & ServerResponse;
}

const fakeGameState = {
  adminStats: () => ({
    online: 2,
    onlineAccounts: 2,
    peakOnline: 5,
    uptimeSeconds: 100,
    tickMsAvg: 1.5,
    simEntities: 40,
    rssBytes: 1,
    heapUsedBytes: 1,
  }),
  liveSessions: () => [],
  suspiciousPlayers: vi.fn<() => SuspiciousPlayer[]>(() => []),
  detectionCalibration: vi.fn(() => ({
    schemaVersion: 1 as const,
    capturedAt: '2026-07-03T10:15:30.000Z',
    serverStartedAt: '2026-07-03T08:15:30.000Z',
    uptimeSeconds: 7200,
    histograms: [] as CalibrationHistogram[],
  })),
  liveAccountIds: () => new Set([9]),
  liveCharacterIds: () => new Set([8]),
  liveSharedIps: vi.fn<() => LiveSharedIp[]>(() => []),
  disconnectAccount: vi.fn(),
  muteAccountChat: vi.fn(),
  reloadChatFilter: vi.fn(async () => {}),
  liftChatMuteLive: vi.fn(),
  resetChatStrikesLive: vi.fn(),
  isIpBlocked: vi.fn(() => false),
  reloadBlockedIps: vi.fn(async () => {}),
  disconnectByIp: vi.fn(),
  // The guild bank operator read (the legacy ladder arm of
  // GET /admin/api/guilds/:id/bank). Null is "no loaded book" for that guild.
  adminGuildBankState: vi.fn((_guildId: number): Record<string, unknown> | null => null),
  adminCharacterState: vi.fn((): Record<string, unknown> | null => ({})),
  adminCharacterOnline: vi.fn(() => true),
  adminRestoreItem: vi.fn((): 'ok' | 'offline' | 'invalid_item' => 'ok'),
  adminRestoreToolEffectSlot: vi.fn(
    (): 'ok' | 'offline' | 'invalid_request' | 'no_tool' | 'already_slotted' => 'ok',
  ),
  social: { guildRenamed: vi.fn() },
};
const fakeGame = fakeGameState as typeof fakeGameState & Parameters<typeof handleAdminApi>[2];

beforeEach(() => {
  vi.clearAllMocks();
  // The overview branch reads through the shared TTL memo (admin_overview_cache),
  // whose refresh IS the mocked overviewCounts here; start every test cold so one
  // test's cached value never leaks into the next.
  resetOverviewCacheForTests();
  resetAdminGuildListReadsForTests();
  resetAdminPlayersCapForTests();
  // The per-account failed-login throttle (server/ratelimit.ts) is real, module-level
  // state; reset it so one test's failures never leak into the next.
  resetAuthFailures();
  fakeGame.isIpBlocked.mockReturnValue(false);
  fakeGame.liveSharedIps.mockReturnValue([]);
  fakeGame.suspiciousPlayers.mockReturnValue([]);
  fakeGame.detectionCalibration.mockReturnValue({
    schemaVersion: 1,
    capturedAt: '2026-07-03T10:15:30.000Z',
    serverStartedAt: '2026-07-03T08:15:30.000Z',
    uptimeSeconds: 7200,
    histograms: [],
  });
  // Default so the moderation-detail route (which now also loads chat state)
  // resolves; individual chat-filter tests override as needed.
  vi.mocked(chatModerationForAccount).mockResolvedValue({
    chatMutedUntil: null,
    chatStrikes: 0,
    violations: [],
  });
});

describe('admin api auth', () => {
  it('rejects requests without a token', async () => {
    const res = fakeRes();
    await handleAdminApi(fakeReq(), res, fakeGame);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a valid token whose account is not an admin', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(false);
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN }), res, fakeGame);

    expect(res.statusCode).toBe(401);
    expect(isAdminAccount).toHaveBeenCalledWith(7);
  });

  it('rejects a staff read token before resolving roles or serving the handler', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue({ accountId: 7, scope: 'read' });
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(adminRolesForAccount).mockClear();
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN }), res, fakeGame);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: 'admin authentication required',
    });
    expect(adminRolesForAccount).not.toHaveBeenCalled();
    expect(isAdminAccount).not.toHaveBeenCalled();
    expect(overviewCounts).not.toHaveBeenCalled();
  });

  it('serves the overview to an admin token and includes live server stats', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(overviewCounts).mockResolvedValue({
      accounts: 10,
      characters: 20,
      accountsToday: 1,
      accountsWeek: 3,
      accountsMonth: 7,
      sessionsToday: 5,
      activeAccountsToday: 4,
      activeAccountsWeek: 6,
      activeAccountsMonth: 8,
      returningAccountsToday: 2,
      avgPlaytimeSeconds: 1200,
      peakOnlineToday: 3,
      peakOnlineAllTime: 9,
      siteUsersNow: 12,
    });
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    // Exactly one DB read per cold request: the beforeEach cache reset makes
    // this test's stub the refresh, so a stale cross-test snapshot (or a
    // double refresh) shows up here as a count drift.
    expect(overviewCounts).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({
        accounts: 10,
        siteUsersNow: 12,
        server: expect.objectContaining({ online: 2 }),
      }),
    });
  });

  it('serves fresh counts to a later cold request instead of a stale snapshot', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    // A different stub body than the other overview test: without the
    // beforeEach cache reset, whichever overview test runs second would be
    // served the FIRST test's cached counts and fail here, so the reset is
    // load-bearing, not prophylactic.
    vi.mocked(overviewCounts).mockResolvedValue({
      accounts: 77,
      characters: 88,
      accountsToday: 9,
      accountsWeek: 10,
      accountsMonth: 11,
      sessionsToday: 12,
      activeAccountsToday: 13,
      activeAccountsWeek: 15,
      activeAccountsMonth: 16,
      returningAccountsToday: 17,
      avgPlaytimeSeconds: 1800,
      peakOnlineToday: 18,
      peakOnlineAllTime: 19,
      siteUsersNow: 21,
    });
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    expect(overviewCounts).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({ accounts: 77, siteUsersNow: 21 }),
    });
  });

  it('includes the injected realm player cap on the legacy overview arm', async () => {
    // The legacy handleAdminApi overview branch is a SEPARATE body from the RouteDef
    // overviewHandler, so it needs its own cap assertion. The RouteDef merge-math test
    // (tests/server/admin.test.ts) pins 4242 on that arm; pinning the SAME value here
    // proves both dispatch arms read the one injected canonicalPlayersCap source, and
    // reds if the legacy arm ever omits playersCap (the objectContaining "serves the
    // overview" case would stay green on such an omission).
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(overviewCounts).mockResolvedValue({
      accounts: 1,
      characters: 1,
      accountsToday: 0,
      accountsWeek: 0,
      accountsMonth: 0,
      sessionsToday: 0,
      activeAccountsToday: 0,
      activeAccountsWeek: 0,
      activeAccountsMonth: 0,
      returningAccountsToday: 0,
      avgPlaytimeSeconds: 0,
      peakOnlineToday: 0,
      peakOnlineAllTime: 0,
      siteUsersNow: 0,
    });
    configureAdminPlayersCap(() => 4242);
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      error: null,
      data: expect.objectContaining({ playersCap: 4242 }),
    });
  });

  it('serves persistent online history with cleaned range parameters', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(onlineHistory).mockResolvedValue({
      range: '7d',
      bucket: 'day',
      points: [
        {
          bucketStart: '2026-06-24T00:00:00.000Z',
          avgPlayers: 4,
          peakPlayers: 7,
          avgAccounts: 3,
          peakAccounts: 5,
          avgSiteUsers: 10,
          peakSiteUsers: 12,
        },
      ],
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/online-history?range=7d' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(onlineHistory).toHaveBeenCalledWith('7d');
    expect(res.body.data.points[0]).toEqual(
      expect.objectContaining({ peakPlayers: 7, peakAccounts: 5, peakSiteUsers: 12 }),
    );
  });

  it('serves live suspicious players to an authenticated admin', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    fakeGame.suspiciousPlayers.mockReturnValue([
      {
        ref: { accountId: 12, characterId: 34, name: 'Watcher', ip: '203.0.113.9' },
        snapshot: null,
        state: 'SUSPICIOUS',
        score: 1.4,
        evidence: [
          {
            kind: 'review_signal_a',
            weight: 1.4,
            detail: 'Public-safe synthetic evidence A.',
            expiresAt: 123,
          },
        ],
      },
    ]);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/suspicious-players' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.players[0]).toEqual(
      expect.objectContaining({
        ref: expect.objectContaining({ accountId: 12, name: 'Watcher' }),
        score: 1.4,
      }),
    );
    expect(fakeGame.suspiciousPlayers).toHaveBeenCalledOnce();
  });

  it('serves detection calibration histograms to an authenticated admin', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    fakeGame.detectionCalibration.mockReturnValue({
      schemaVersion: 1,
      capturedAt: '2026-07-03T10:15:30.000Z',
      serverStartedAt: '2026-07-03T08:15:30.000Z',
      uptimeSeconds: 7200,
      histograms: [
        {
          id: 'metric_a_ms',
          count: 2,
          min: 10,
          max: 30,
          sum: 40,
          buckets: [
            { le: 10, count: 1 },
            { le: 50, count: 1 },
          ],
          overflowCount: 0,
        },
      ],
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/detection-calibration' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        capturedAt: '2026-07-03T10:15:30.000Z',
        serverStartedAt: '2026-07-03T08:15:30.000Z',
        uptimeSeconds: 7200,
      }),
    );
    expect(res.body.data.histograms[0]).toEqual(
      expect.objectContaining({ id: 'metric_a_ms', count: 2 }),
    );
    expect(fakeGame.detectionCalibration).toHaveBeenCalledOnce();
  });

  it('rejects admin login for a non-admin account even with the right password', async () => {
    // scrypt hash of "hunter22" is irrelevant — verifyPassword fails on a junk
    // hash, so this asserts the credential failure path returns 401.
    vi.mocked(findAccount).mockResolvedValue({ id: 3, username: 'bob', password_hash: 'junk' });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'bob', password: 'hunter22' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/invalid username or password/);
  });

  it('rejects non-GET methods on data endpoints', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({ method: 'DELETE', token: VALID_TOKEN, url: '/admin/api/accounts' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(405);
  });

  it('returns 404 for unknown admin endpoints', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN, url: '/admin/api/nope' }), res, fakeGame);

    expect(res.statusCode).toBe(404);
  });

  it('passes pagination and search through to the accounts query', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(listAccounts).mockResolvedValue({ rows: [], total: 0, page: 2, limit: 50 });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/accounts?page=2&limit=50&search=bob' }),
      res,
      fakeGame,
    );

    expect(listAccounts).toHaveBeenCalledWith('bob', 2, 50);
    expect(res.statusCode).toBe(200);
  });

  it('passes pagination, search, and sorting through to the characters query', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(listCharacters).mockResolvedValue({ rows: [], total: 0, page: 3, limit: 50 });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/characters?page=3&limit=50&search=Merlin&sort=name&dir=asc',
      }),
      res,
      fakeGame,
    );

    expect(listCharacters).toHaveBeenCalledWith('Merlin', 'name', 'asc', 3, 50);
    expect(res.statusCode).toBe(200);
  });

  it('serves unstuck reports through the production admin dispatcher', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: '9',
            realm: 'main',
            account_id: 4,
            character_id: 5,
            character_name: 'Aleph',
            area_kind: 'dungeon',
            area_id: 'hollow_crypt',
            instance_id: null,
            instance_slot: 2,
            origin_raw_x: 100,
            origin_raw_y: 3,
            origin_raw_z: 200,
            origin_local_x: 4,
            origin_local_y: 3,
            origin_local_z: 8,
            destination_raw_x: null,
            destination_raw_y: null,
            destination_raw_z: null,
            destination_local_x: null,
            destination_local_y: null,
            destination_local_z: null,
            outcome: 'cancelled',
            reason: 'moved',
            invoked_at: '2026-07-14T00:00:00.000Z',
            resolved_at: '2026-07-14T00:00:03.000Z',
            created_at: '2026-07-14T00:00:03.000Z',
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            area_kind: 'dungeon',
            area_id: 'hollow_crypt',
            bucket_local_x: 0,
            bucket_local_y: 0,
            bucket_local_z: 5,
            report_count: 3,
            completed_count: 1,
            cancelled_count: 2,
            failed_count: 0,
            first_invoked_at: '2026-07-13T00:00:00.000Z',
            last_resolved_at: '2026-07-14T00:00:03.000Z',
          },
        ],
      } as never);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/unstuck-reports?days=14&limit=25',
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      days: 14,
      limit: 25,
      reports: [
        {
          id: 9,
          characterName: 'Aleph',
          origin: { x: 100, y: 3, z: 200, localX: 4, localY: 3, localZ: 8 },
          destination: null,
          outcome: 'cancelled',
          reason: 'moved',
        },
      ],
      hotspots: [
        {
          bucket: { x: 0, y: 0, z: 5 },
          count: 3,
          completed: 1,
          cancelled: 2,
          failed: 0,
        },
      ],
    });
  });

  it('skips the unstuck hotspot aggregate on legacy cursor pages', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/unstuck-reports?days=14&limit=25&beforeId=9',
      }),
      res,
      fakeGame,
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(pool.query).mock.calls[0][0])).toContain('FROM unstuck_reports r');
    expect(String(vi.mocked(pool.query).mock.calls[0][0])).not.toContain('WITH bucketed AS');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({
      reports: [],
      hotspots: [],
      hasMore: false,
      nextBeforeId: null,
    });
  });

  it('serves shared IPs with their current block state', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(listSharedIps).mockResolvedValue({
      rows: [
        {
          ip: '203.0.113.7',
          accountCount: 3,
          lastSeenAt: '2026-06-28T12:00:00Z',
        },
      ],
      total: 1,
      page: 2,
      limit: 50,
    });
    fakeGame.isIpBlocked.mockReturnValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/shared-ips?page=2&limit=50&sort=last_seen&dir=asc',
      }),
      res,
      fakeGame,
    );

    expect(listSharedIps).toHaveBeenCalledWith(2, 50, 'last_seen', 'asc');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.rows[0]).toEqual(
      expect.objectContaining({ ip: '203.0.113.7', blocked: true }),
    );
  });

  it('serves online shared IPs from memory without querying session history', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    fakeGame.liveSharedIps.mockReturnValue([
      {
        ip: '203.0.113.8',
        accountCount: 4,
        lastSeenAt: '2026-06-28T12:00:00Z',
      },
      {
        ip: '203.0.113.9',
        accountCount: 2,
        lastSeenAt: '2026-06-28T11:00:00Z',
      },
    ]);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/shared-ips?online=1&page=1&limit=1&sort=last_seen&dir=asc',
      }),
      res,
      fakeGame,
    );

    expect(listSharedIps).not.toHaveBeenCalled();
    expect(fakeGame.liveSharedIps).toHaveBeenCalledOnce();
    expect(res.body.data).toEqual({
      rows: [
        {
          ip: '203.0.113.9',
          accountCount: 2,
          lastSeenAt: '2026-06-28T11:00:00Z',
          blocked: false,
        },
      ],
      total: 2,
      page: 1,
      limit: 1,
    });
  });

  it('serves grouped IP associations with normalized pagination', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(associationsForIp).mockResolvedValue({
      ip: '203.0.113.7',
      accounts: [
        {
          accountId: 9,
          username: 'linked',
          isAdmin: false,
          status: 'active',
          suspendedUntil: null,
          createdAt: '2026-01-01T00:00:00Z',
          createdWithIp: false,
          lastLoginWithIp: true,
          hasSession: false,
          lastSeenAt: '2026-06-01T00:00:00Z',
          characters: [],
        },
      ],
      total: 1,
      page: 2,
      limit: 50,
    });
    fakeGame.isIpBlocked.mockReturnValueOnce(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/ip-associations?ip=203.0.113.7&page=2&limit=50',
      }),
      res,
      fakeGame,
    );

    expect(associationsForIp).toHaveBeenCalledWith('203.0.113.7', 2, 50);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.blocked).toBe(true);
    expect(res.body.data.blockable).toBe(true);
    expect(res.body.data.accounts[0].online).toBe(true);
  });

  it('serves associations for the stored unknown marker without checking the block list', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(associationsForIp).mockResolvedValue({
      ip: 'unknown',
      accounts: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/ip-associations?ip=unknown' }),
      res,
      fakeGame,
    );

    expect(associationsForIp).toHaveBeenCalledWith('unknown', 1, 25);
    expect(fakeGame.isIpBlocked).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      ip: 'unknown',
      accounts: [],
      total: 0,
      page: 1,
      limit: 25,
      blocked: false,
      blockable: false,
    });
  });

  it('rejects an invalid IP association lookup', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/ip-associations?ip=not-an-ip' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(associationsForIp).not.toHaveBeenCalled();
  });

  it('serves the moderation queue to admins with online account context', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(moderationQueue).mockResolvedValue([
      {
        accountId: 9,
        username: 'badactor',
        isAdmin: false,
        status: 'active',
        suspendedUntil: null,
        openReports: 4,
        latestReportAt: new Date().toISOString(),
        latestReason: 'spam',
        characterNames: ['Badactor'],
        online: true,
      },
    ]);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/moderation/queue' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(moderationQueue).toHaveBeenCalledWith(new Set([9]));
    expect(res.body.data.rows[0].openReports).toBe(4);
  });

  it('serves perf summaries and raw rows through existing admin auth', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(clientPerfSummary).mockResolvedValue({
      hours: 24,
      generatedAt: 'now',
      totals: {
        sampleCount: 1,
        medianFps: 60,
        p95FrameMs: 18,
        p99FrameMs: 22,
        contextLossCount: 0,
        avgRenderScale: 1,
        avgEffectiveRenderScale: 0.9,
      },
      byPreset: [],
      byGfxTier: [],
      byGpu: [],
      byBrowser: [],
      byOs: [],
      byScenario: [],
      byCrowd: [],
      worstGpuBuckets: [],
      suggestionCounts: [{ id: 'hardware-acceleration', sampleCount: 3 }],
    });
    vi.mocked(clientPerfRaw).mockResolvedValue([
      { id: 123 } as unknown as PerfRawRow,
      { id: 100 } as unknown as PerfRawRow,
    ]);

    const summaryRes = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/perf/summary?hours=24' }),
      summaryRes,
      fakeGame,
    );
    expect(summaryRes.statusCode).toBe(200);
    expect(clientPerfSummary).toHaveBeenCalledWith(24);
    expect(summaryRes.body.data.totals.sampleCount).toBe(1);
    // The phase 05 suggestionCounts field rides the summary response verbatim.
    expect(summaryRes.body.data.suggestionCounts).toEqual([
      { id: 'hardware-acceleration', sampleCount: 3 },
    ]);

    const rawRes = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/perf/raw?hours=24&limit=10&beforeId=500' }),
      rawRes,
      fakeGame,
    );
    expect(rawRes.statusCode).toBe(200);
    expect(clientPerfRaw).toHaveBeenCalledWith(24, 10, 500);
    expect(rawRes.body.data.rows).toHaveLength(2);
    expect(rawRes.body.data.nextBeforeId).toBe(100);
    expect(rawRes.body.data.hasMore).toBe(false);
  });

  it('loads moderation account detail with open reports', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(accountDetail).mockResolvedValue({
      id: 9,
      username: 'badactor',
      createdAt: '',
      lastLogin: null,
      isAdmin: false,
      bannedAt: null,
      suspendedUntil: null,
      moderationReason: '',
      chatMutedUntil: null,
      chatMuteReason: '',
      chatStrikes: 0,
      isAi: false,
      isStreamer: false,
      streamerLinks: {},
      lastLoginIp: null,
      playtimeSeconds: 0,
      characters: [],
      recentSessions: [],
      moderationHistory: [],
    });
    vi.mocked(moderationReportsForAccount).mockResolvedValue([]);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/moderation/accounts/9' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(moderationReportsForAccount).toHaveBeenCalledWith(9);
    expect(res.body.data.account.online).toBe(true);
  });

  it('includes the in-memory online state in account detail without another query', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(accountDetail).mockResolvedValue({
      id: 9,
      username: 'online-player',
      createdAt: '',
      lastLogin: null,
      isAdmin: false,
      bannedAt: null,
      suspendedUntil: null,
      moderationReason: '',
      chatMutedUntil: null,
      chatMuteReason: '',
      chatStrikes: 0,
      isAi: false,
      isStreamer: false,
      streamerLinks: {},
      lastLoginIp: null,
      playtimeSeconds: 0,
      characters: [],
      recentSessions: [],
      moderationHistory: [],
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/accounts/9' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.online).toBe(true);
    expect(accountDetail).toHaveBeenCalledWith(9);
  });

  it('ignores an open report', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(ignoreReport).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/reports/55/ignore',
        body: { note: 'no issue' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(ignoreReport).toHaveBeenCalledWith(55, 7, 'no issue');
  });

  it('suspends and disconnects an account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(moderateAccount).mockResolvedValue();
    const res = fakeRes();
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/suspend',
        body: { reason: 'abuse', expiresAt },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(moderateAccount).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      action: 'suspend',
      reason: 'abuse',
      expiresAt,
    });
    expect(fakeGame.disconnectAccount).toHaveBeenCalledWith(9, 'This account is suspended.');
    expect(revokeTokensExcept).toHaveBeenCalledWith(9, null);
  });

  it('bans and disconnects an account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(moderateAccount).mockResolvedValue();
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/ban',
        body: { reason: 'severe abuse' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(moderateAccount).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      action: 'ban',
      reason: 'severe abuse',
      expiresAt: undefined,
    });
    expect(fakeGame.disconnectAccount).toHaveBeenCalledWith(9, 'This account has been banned.');
    expect(revokeTokensExcept).toHaveBeenCalledWith(9, null);
  });

  it('mutes account chat and sends a live warning without disconnecting', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(muteAccountChat).mockResolvedValue();
    const res = fakeRes();
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/chat-mute',
        body: { reason: 'keep chat civil', expiresAt },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(muteAccountChat).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      reason: 'keep chat civil',
      expiresAt,
    });
    expect(fakeGame.muteAccountChat).toHaveBeenCalledWith(9, expiresAt, 'keep chat civil');
    expect(fakeGame.disconnectAccount).not.toHaveBeenCalled();
  });

  it('unbans without disconnecting the account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(moderateAccount).mockResolvedValue();
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/unban',
        body: { reason: 'appeal accepted' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(moderateAccount).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      action: 'unban',
      reason: 'appeal accepted',
      expiresAt: undefined,
    });
    expect(fakeGame.disconnectAccount).not.toHaveBeenCalled();
    expect(revokeTokensExcept).not.toHaveBeenCalled();
  });

  it('unsuspends without disconnecting the account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(moderateAccount).mockResolvedValue();
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/unsuspend',
        body: { reason: 'appeal accepted' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(moderateAccount).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      action: 'unsuspend',
      reason: 'appeal accepted',
      expiresAt: undefined,
    });
    expect(fakeGame.disconnectAccount).not.toHaveBeenCalled();
    expect(accountMailTarget).not.toHaveBeenCalled();
    expect(revokeTokensExcept).not.toHaveBeenCalled();
  });

  it('rejects suspending or banning admin accounts', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/ban',
        body: { reason: 'bad admin' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/admin accounts cannot/);
    expect(moderateAccount).not.toHaveBeenCalled();
    expect(fakeGame.disconnectAccount).not.toHaveBeenCalled();
  });

  it('forces a character rename and disconnects that account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(forceCharacterRename).mockResolvedValue({ accountId: 9 });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/force-rename',
        body: { reason: 'bad name' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(forceCharacterRename).toHaveBeenCalledWith({
      characterId: 42,
      adminAccountId: 7,
      reason: 'bad name',
    });
    expect(fakeGame.disconnectAccount).toHaveBeenCalledWith(
      9,
      'A moderator requires one of your characters to be renamed.',
    );
  });
});

describe('legacy guild administration parity', () => {
  function authenticate(roles: string[] = ['superadmin']): void {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'admin', roles } as never);
  }

  it('serves list, detail, and retained history with the legacy response shapes', async () => {
    authenticate();
    vi.mocked(listAdminGuilds).mockResolvedValue({
      rows: [{ id: 4, name: 'Keepers' }],
      total: 1,
      page: 2,
      limit: 10,
    } as never);
    vi.mocked(adminGuildDetail).mockResolvedValue({
      guild: { id: 4, name: 'Keepers' },
      members: [{ characterId: 8, characterName: 'Alice' }],
    } as never);
    vi.mocked(listAdminGuildHistory).mockResolvedValue([
      { id: 1, oldName: 'Old Name', newName: 'Keepers' },
    ] as never);

    const list = fakeRes();
    await handleAdminApi(
      fakeReq({
        token: VALID_TOKEN,
        url: '/admin/api/guilds?search=Keep&page=2&limit=10&sort=created_at&dir=desc',
      }),
      list,
      fakeGame,
    );
    expect(list.statusCode).toBe(200);
    expect(listAdminGuilds).toHaveBeenCalledWith('Keep', 2, 10, 'created_at', 'desc');

    const detail = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds/4' }),
      detail,
      fakeGame,
    );
    expect(detail.body.data.members).toEqual([
      { characterId: 8, characterName: 'Alice', online: true },
    ]);

    const historyResponse = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds/4/history' }),
      historyResponse,
      fakeGame,
    );
    expect(historyResponse.body.data).toEqual({
      rows: [{ id: 1, oldName: 'Old Name', newName: 'Keepers' }],
    });
  });

  it('serves the guild bank operator read, and 404s a guild whose book is not loaded', async () => {
    // The LEGACY arm of GET /admin/api/guilds/:id/bank (its RouteDef twin is
    // covered in tests/server/admin.test.ts). Both run one shared body, so what
    // this proves is that the ladder reaches it at all and answers the same
    // envelope: a route present only in the RouteDef table would 404 here for
    // every operator running with API_DISPATCH=legacy.
    authenticate();
    const state = {
      treasury: 12_345,
      capacity: 30,
      purchasedSlots: 30,
      usedSlots: 1,
      dormantSlots: 1,
      slots: [{ index: 0, itemId: 'final_argument_greatblade', count: 1, dormant: true }],
    };
    fakeGameState.adminGuildBankState.mockReturnValueOnce(state);

    const loaded = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds/4/bank' }),
      loaded,
      fakeGame,
    );
    expect(fakeGameState.adminGuildBankState).toHaveBeenCalledWith(4);
    expect(loaded.statusCode).toBe(200);
    expect(loaded.body.data).toEqual({ guildId: 4, ...state });

    fakeGameState.adminGuildBankState.mockReturnValueOnce(null);
    const missing = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds/4/bank' }),
      missing,
      fakeGame,
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.body.error).toBe('that guild has no loaded bank');
  });

  it('denies the guild bank read to a role without moderation.read', async () => {
    // The central fail-closed gate runs before the ladder arm, so the live sim
    // is never read for an operator who may not see a guild's property.
    authenticate(['support-only-unknown-role']);
    const denied = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds/4/bank' }),
      denied,
      fakeGame,
    );
    expect(denied.statusCode).toBe(403);
    expect(fakeGameState.adminGuildBankState).not.toHaveBeenCalled();
  });

  it('returns 503 before a third distinct legacy member-count read can occupy the pool', async () => {
    authenticate();
    const resolvers: Array<
      (value: { rows: never[]; total: number; page: number; limit: number }) => void
    > = [];
    vi.mocked(listAdminGuilds).mockImplementation(
      async (_search, _page, _limit) =>
        new Promise<{ rows: never[]; total: number; page: number; limit: number }>((resolve) => {
          resolvers.push(resolve);
        }) as never,
    );

    const firstResponse = fakeRes();
    const first = handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds?sort=member_count&page=1' }),
      firstResponse,
      fakeGame,
    );
    const secondResponse = fakeRes();
    const second = handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds?sort=member_count&page=2' }),
      secondResponse,
      fakeGame,
    );
    await vi.waitFor(() => expect(listAdminGuilds).toHaveBeenCalledTimes(2));

    const rejected = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds?sort=member_count&page=3' }),
      rejected,
      fakeGame,
    );
    expect(rejected.statusCode).toBe(503);
    expect(rejected.body).toEqual({
      success: false,
      data: null,
      error: 'guild list busy, try again',
    });
    expect(listAdminGuilds).toHaveBeenCalledTimes(2);

    // The admission control exists for the aggregating sort, so the default
    // name-sorted directory must still load while that class is saturated.
    const directoryResponse = fakeRes();
    const directory = handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/guilds?page=1' }),
      directoryResponse,
      fakeGame,
    );
    await vi.waitFor(() => expect(listAdminGuilds).toHaveBeenCalledTimes(3));

    resolvers.forEach((resolve, index) => {
      resolve({ rows: [], total: 0, page: index + 1, limit: 25 });
    });
    await directory;
    expect(directoryResponse.statusCode).not.toBe(503);
    await Promise.all([first, second]);
  });

  it('renames through the legacy arm and denies a viewer before the write', async () => {
    authenticate();
    vi.mocked(renameAdminGuild).mockResolvedValue({
      result: {
        guildId: 4,
        oldName: 'Old Name',
        newName: 'Keepers',
        memberCharacterIds: [8],
      },
    });

    const renamed = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/guilds/4/rename',
        body: { name: 'Keepers', reason: 'offensive name' },
      }),
      renamed,
      fakeGame,
    );
    expect(renamed.statusCode).toBe(200);
    expect(renameAdminGuild).toHaveBeenCalledWith(4, 'Keepers', 'offensive name', 7);
    expect(fakeGame.social.guildRenamed).toHaveBeenCalledWith(4, 'Old Name', 'Keepers', [8]);

    vi.mocked(renameAdminGuild).mockClear();
    vi.mocked(adminRolesForAccount).mockResolvedValueOnce({
      username: 'admin',
      roles: ['viewer'],
    });
    const denied = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/guilds/4/rename',
        body: { name: 'Denied Name', reason: 'reason' },
      }),
      denied,
      fakeGame,
    );
    expect(denied.statusCode).toBe(403);
    expect(renameAdminGuild).not.toHaveBeenCalled();
  });
});

describe('admin api chat filter', () => {
  beforeEach(() => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
  });

  it('serves both word tiers and the escalation config', async () => {
    vi.mocked(listFilterWords).mockImplementation(async (tier) =>
      tier === 'hard'
        ? [{ id: 2, word: 'slur', tier: 'hard', createdAt: '' }]
        : [{ id: 1, word: 'darn', tier: 'soft', createdAt: '' }],
    );
    vi.mocked(getFilterConfig).mockResolvedValue({
      warningsBeforeMute: 1,
      muteLadderSeconds: [600],
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/chat-filter' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.soft[0].word).toBe('darn');
    expect(res.body.data.hard[0].word).toBe('slur');
    expect(res.body.data.config.muteLadderSeconds).toEqual([600]);
  });

  it('adds a word and reloads the live filter', async () => {
    vi.mocked(addFilterWord).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/chat-filter/words',
        body: { word: 'Heck', tier: 'soft' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(addFilterWord).toHaveBeenCalledWith('Heck', 'soft');
    expect(fakeGame.reloadChatFilter).toHaveBeenCalled();
  });

  it('rejects an invalid tier', async () => {
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/chat-filter/words',
        body: { word: 'x', tier: 'medium' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(addFilterWord).not.toHaveBeenCalled();
  });

  it('rejects a word that normalizes to nothing', async () => {
    vi.mocked(addFilterWord).mockResolvedValue(false);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/chat-filter/words',
        body: { word: '!!!', tier: 'hard' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(fakeGame.reloadChatFilter).not.toHaveBeenCalled();
  });

  it('deletes a word by id', async () => {
    vi.mocked(removeFilterWord).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ method: 'POST', token: VALID_TOKEN, url: '/admin/api/chat-filter/words/5/delete' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(removeFilterWord).toHaveBeenCalledWith(5);
    expect(fakeGame.reloadChatFilter).toHaveBeenCalled();
  });

  it('updates the escalation config', async () => {
    vi.mocked(updateFilterConfig).mockResolvedValue({
      warningsBeforeMute: 2,
      muteLadderSeconds: [60, 120],
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/chat-filter/config',
        body: { warningsBeforeMute: 2, muteLadderSeconds: [60, 120] },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(updateFilterConfig).toHaveBeenCalledWith({
      warningsBeforeMute: 2,
      muteLadderSeconds: [60, 120],
    });
    expect(fakeGame.reloadChatFilter).toHaveBeenCalled();
  });

  it('lifts a mute and syncs the live session', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(liftAccountChatMute).mockResolvedValue();
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/lift-mute',
        body: { reason: 'appeal accepted' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(liftAccountChatMute).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      reason: 'appeal accepted',
    });
    expect(fakeGame.liftChatMuteLive).toHaveBeenCalledWith(9);
  });

  it('resets strikes and syncs the live session', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(resetChatStrikesAudited).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/reset-strikes',
        body: { reason: 'appeal accepted' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(resetChatStrikesAudited).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      reason: 'appeal accepted',
    });
    expect(fakeGame.resetChatStrikesLive).toHaveBeenCalledWith(9);
  });

  it('rejects a reset-strikes without a reason before touching the account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(resetChatStrikesAudited).mockRejectedValue(
      new Error('moderation reason is required'),
    );
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/reset-strikes',
        body: {},
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: 'moderation reason is required',
    });
    expect(fakeGame.resetChatStrikesLive).not.toHaveBeenCalled();
  });

  it('reactivates an account and records the reason', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(reactivateAccountAudited).mockResolvedValue();
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/reactivate',
        body: { reason: 'appeal accepted' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(reactivateAccountAudited).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      reason: 'appeal accepted',
    });
  });

  it('rejects a reactivate without a reason before touching the account', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(reactivateAccountAudited).mockRejectedValue(
      new Error('moderation reason is required'),
    );
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/reactivate',
        body: {},
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: 'moderation reason is required',
    });
  });

  it('includes chat moderation state in the moderation account detail', async () => {
    vi.mocked(accountDetail).mockResolvedValue({
      id: 9,
      username: 'badactor',
      createdAt: '',
      lastLogin: null,
      isAdmin: false,
      bannedAt: null,
      suspendedUntil: null,
      moderationReason: '',
      chatMutedUntil: null,
      chatMuteReason: '',
      chatStrikes: 0,
      isAi: false,
      isStreamer: false,
      streamerLinks: {},
      lastLoginIp: null,
      playtimeSeconds: 0,
      characters: [],
      recentSessions: [],
      moderationHistory: [],
    });
    vi.mocked(moderationReportsForAccount).mockResolvedValue([]);
    vi.mocked(chatModerationForAccount).mockResolvedValue({
      chatMutedUntil: null,
      chatStrikes: 3,
      violations: [
        {
          id: 1,
          characterName: 'badactor',
          term: 'slur',
          channel: 'say',
          message: 'a slur',
          action: 'mute',
          muteSeconds: 600,
          createdAt: '',
        },
      ],
    });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/moderation/accounts/9' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.chat.chatStrikes).toBe(3);
    expect(res.body.data.chat.violations).toHaveLength(1);
  });
});

describe('parsePageParams', () => {
  it('defaults page to 1 and limit to 25', () => {
    expect(parsePageParams(new URLSearchParams())).toEqual({ page: 1, limit: 25 });
  });

  it('clamps limit to the 1..200 range', () => {
    expect(parsePageParams(new URLSearchParams('limit=9999')).limit).toBe(200);
    expect(parsePageParams(new URLSearchParams('limit=0')).limit).toBe(1);
    expect(parsePageParams(new URLSearchParams('limit=-5')).limit).toBe(1);
  });

  it('rejects garbage page values and floors fractions', () => {
    expect(parsePageParams(new URLSearchParams('page=banana')).page).toBe(1);
    expect(parsePageParams(new URLSearchParams('page=2.9')).page).toBe(2);
    expect(parsePageParams(new URLSearchParams('page=-3')).page).toBe(1);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards so a search for "%" is literal', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike('plain')).toBe('plain');
  });
});

describe('blocked-ips admin route', () => {
  beforeEach(() => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
  });

  it('blocks an IP, reloads the cache and kicks live sessions on it', async () => {
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips',
        body: { ip: '1.2.3.4', reason: 'bot' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
    expect(addBlockedIp).toHaveBeenCalled();
    expect(fakeGame.reloadBlockedIps).toHaveBeenCalled();
    expect(fakeGame.disconnectByIp).toHaveBeenCalledWith('1.2.3.4', expect.any(String));
  });

  it('returns 400 when blocking with a past expiry (addBlockedIp throws)', async () => {
    vi.mocked(addBlockedIp).mockRejectedValueOnce(new Error('block expiry must be in the future'));
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips',
        body: { ip: '1.2.3.4', expiresAt: '2000-01-01T00:00:00Z' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(400);
    expect(fakeGame.disconnectByIp).not.toHaveBeenCalled();
  });

  it('refuses to block unknown before the write boundary', async () => {
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips',
        body: { ip: 'unknown' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(400);
    expect(addBlockedIp).not.toHaveBeenCalled();
    expect(fakeGame.reloadBlockedIps).not.toHaveBeenCalled();
    expect(fakeGame.disconnectByIp).not.toHaveBeenCalled();
  });

  it('unblocks an IP and reloads the cache', async () => {
    vi.mocked(removeBlockedIp).mockResolvedValue(true);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips/delete',
        body: { ip: '1.2.3.4' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
    expect(removeBlockedIp).toHaveBeenCalledWith('1.2.3.4', 7);
    expect(fakeGame.reloadBlockedIps).toHaveBeenCalled();
  });

  it('returns 404 when unblocking an IP that is not blocked', async () => {
    vi.mocked(removeBlockedIp).mockResolvedValue(false);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips/delete',
        body: { ip: '1.2.3.4' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when unblocking with an invalid IP', async () => {
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips/delete',
        body: { ip: '' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(400);
    expect(removeBlockedIp).not.toHaveBeenCalled();
  });
});

describe('admin api password reset', () => {
  const actAs = (roles: string[], accountId = 7) => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(accountId));
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'operator', roles });
  };
  const targetExists = () =>
    vi
      .mocked(accountById)
      .mockResolvedValue({ id: 9 } as NonNullable<Awaited<ReturnType<typeof accountById>>>);
  const post = (body: unknown, id = 9) =>
    fakeReq({
      method: 'POST',
      token: VALID_TOKEN,
      url: `/admin/api/accounts/${id}/reset-password`,
      body,
    });

  it('audits, rehashes, revokes every token, and disconnects live sessions', async () => {
    actAs(['admin']);
    vi.mocked(isAdminAccount).mockResolvedValue(false); // target is not staff
    targetExists();
    const res = fakeRes();

    await handleAdminApi(
      post({ password: 'newpass123', reason: 'account recovery' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(recordPasswordReset).toHaveBeenCalledWith({
      accountId: 9,
      adminAccountId: 7,
      reason: 'account recovery',
    });
    expect(hashPassword).toHaveBeenCalledWith('newpass123');
    expect(updatePasswordHash).toHaveBeenCalledWith(9, 'salt:hashed');
    expect(revokeTokensExcept).toHaveBeenCalledWith(9, null);
    expect(fakeGame.disconnectAccount).toHaveBeenCalledWith(
      9,
      'Connection to the server was lost.',
    );
    // The audit row lands before the credential write (no unaudited action).
    expect(vi.mocked(recordPasswordReset).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(updatePasswordHash).mock.invocationCallOrder[0],
    );
  });

  it('rejects out-of-bounds passwords without touching the account', async () => {
    actAs(['admin']);
    vi.mocked(isAdminAccount).mockResolvedValue(false);
    targetExists();

    const tooShort = fakeRes();
    await handleAdminApi(post({ password: 'abc', reason: 'r' }), tooShort, fakeGame);
    expect(tooShort.statusCode).toBe(400);
    expect(tooShort.body.error).toBe('password must be at least 6 chars');

    const tooLong = fakeRes();
    await handleAdminApi(post({ password: 'x'.repeat(129), reason: 'r' }), tooLong, fakeGame);
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.body.error).toBe('password must be at most 128 chars');

    const missing = fakeRes();
    await handleAdminApi(post({ reason: 'r' }), missing, fakeGame);
    expect(missing.statusCode).toBe(400);

    expect(recordPasswordReset).not.toHaveBeenCalled();
    expect(updatePasswordHash).not.toHaveBeenCalled();
    expect(revokeTokensExcept).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown account without touching anything', async () => {
    actAs(['admin']);
    vi.mocked(isAdminAccount).mockResolvedValue(false);
    vi.mocked(accountById).mockResolvedValue(null);
    const res = fakeRes();

    await handleAdminApi(post({ password: 'newpass123', reason: 'r' }, 12345), res, fakeGame);

    expect(res.statusCode).toBe(404);
    expect(recordPasswordReset).not.toHaveBeenCalled();
    expect(updatePasswordHash).not.toHaveBeenCalled();
    expect(revokeTokensExcept).not.toHaveBeenCalled();
  });

  it('refuses a staff target unless the actor is a superadmin', async () => {
    actAs(['admin']);
    vi.mocked(isAdminAccount).mockResolvedValue(true); // target is staff
    targetExists();
    const denied = fakeRes();

    await handleAdminApi(post({ password: 'newpass123', reason: 'r' }), denied, fakeGame);

    expect(denied.statusCode).toBe(400);
    expect(denied.body.error).toBe('only a superadmin can reset a staff password');
    expect(updatePasswordHash).not.toHaveBeenCalled();
    expect(revokeTokensExcept).not.toHaveBeenCalled();

    actAs(['superadmin']);
    const allowed = fakeRes();
    await handleAdminApi(post({ password: 'newpass123', reason: 'r' }), allowed, fakeGame);
    expect(allowed.statusCode).toBe(200);
    expect(updatePasswordHash).toHaveBeenCalledWith(9, 'salt:hashed');
  });

  it('refuses the route entirely without the accounts.password permission', async () => {
    actAs(['moderator']);
    const res = fakeRes();

    await handleAdminApi(post({ password: 'newpass123', reason: 'r' }), res, fakeGame);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('you do not have permission to do this');
    expect(updatePasswordHash).not.toHaveBeenCalled();
  });

  it('requires a moderation reason, surfacing the audit failure as 400', async () => {
    actAs(['admin']);
    vi.mocked(isAdminAccount).mockResolvedValue(false);
    targetExists();
    vi.mocked(recordPasswordReset).mockRejectedValueOnce(
      new Error('moderation reason is required'),
    );
    const res = fakeRes();

    await handleAdminApi(post({ password: 'newpass123' }), res, fakeGame);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('moderation reason is required');
    expect(updatePasswordHash).not.toHaveBeenCalled();
    expect(revokeTokensExcept).not.toHaveBeenCalled();
  });
});

describe('admin api permissions', () => {
  const actAs = (roles: string[], accountId = 7) => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(accountId));
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'operator', roles });
  };

  it('serves /me with roles and expanded permissions', async () => {
    actAs(['viewer']);
    const res = fakeRes();
    await handleAdminApi(fakeReq({ token: VALID_TOKEN, url: '/admin/api/me' }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      username: 'operator',
      roles: ['viewer'],
      permissions: expect.arrayContaining(['analytics.read', 'accounts.read', 'support.read']),
    });
    expect(res.body.data.permissions).not.toContain('moderation.act');
  });

  it('refuses a mutation outside the permission set with 403', async () => {
    actAs(['viewer']);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/blocked-ips',
        body: { ip: '1.2.3.4' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('you do not have permission to do this');
    expect(addBlockedIp).not.toHaveBeenCalled();
  });

  it('refuses a read outside the permission set with 403', async () => {
    // viewer lacks botdetector.read, so the suspicious-players read is denied.
    actAs(['viewer']);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/suspicious-players' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(403);
    expect(fakeGame.suspiciousPlayers).not.toHaveBeenCalled();
  });

  it('gates provider usage on ops_usage.read (admin yes, analytics-only role no)', async () => {
    actAs(['admin']);
    const okRes = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/provider-usage' }),
      okRes,
      fakeGame,
    );
    expect(okRes.statusCode).toBe(200);
    expect(okRes.body.data.usage).toBeDefined();

    // moderator has analytics.read but NOT ops_usage.read, and the usage no
    // longer rides inside /overview, so it is fully out of reach.
    actAs(['moderator']);
    const denied = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/provider-usage' }),
      denied,
      fakeGame,
    );
    expect(denied.statusCode).toBe(403);
  });

  it('scopes a moderator to moderation surfaces, not the staff page', async () => {
    actAs(['moderator']);
    const blocked = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/blocked-ips' }),
      blocked,
      fakeGame,
    );
    expect(blocked.statusCode).toBe(200);

    actAs(['moderator']);
    const staff = fakeRes();
    await handleAdminApi(fakeReq({ token: VALID_TOKEN, url: '/admin/api/staff' }), staff, fakeGame);
    expect(staff.statusCode).toBe(403);
    expect(listStaff).not.toHaveBeenCalled();
  });

  it('lists staff with assignable roles that exclude superadmin', async () => {
    actAs(['superadmin']);
    vi.mocked(listStaff).mockResolvedValue([
      { accountId: 7, username: 'operator', roles: ['superadmin'], lastLogin: null },
    ]);
    const res = fakeRes();
    await handleAdminApi(fakeReq({ token: VALID_TOKEN, url: '/admin/api/staff' }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.assignableRoles).toEqual(['admin', 'moderator', 'viewer']);
    expect(res.body.data.rows).toHaveLength(1);
  });

  it('serves the role-change history to staff managers', async () => {
    actAs(['superadmin']);
    vi.mocked(roleChangeHistory).mockResolvedValue([]);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/staff/history' }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(roleChangeHistory).toHaveBeenCalledWith(50);
  });

  it('refuses invalid role writes: unknown role, superadmin grant, self-edit, superadmin target', async () => {
    const post = (body: unknown) =>
      fakeReq({ method: 'POST', token: VALID_TOKEN, url: '/admin/api/staff/roles', body });

    actAs(['superadmin']);
    let res = fakeRes();
    await handleAdminApi(post({ username: 'x', roles: ['wizard'] }), res, fakeGame);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown role');

    actAs(['superadmin']);
    res = fakeRes();
    await handleAdminApi(post({ username: 'x', roles: ['superadmin'] }), res, fakeGame);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/grant script/);

    // Self-edit: the target username resolves to the actor's own account id.
    actAs(['superadmin']);
    vi.mocked(findAccount).mockResolvedValue({ id: 7, username: 'operator' } as never);
    res = fakeRes();
    await handleAdminApi(post({ username: 'operator', roles: ['moderator'] }), res, fakeGame);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('you cannot change your own roles');

    // Superadmin target: refused even for another superadmin actor.
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(adminRolesForAccount).mockImplementation(async (id: number) =>
      id === 7
        ? { username: 'operator', roles: ['superadmin'] }
        : { username: 'founder', roles: ['superadmin'] },
    );
    vi.mocked(findAccount).mockResolvedValue({ id: 9, username: 'founder' } as never);
    res = fakeRes();
    await handleAdminApi(post({ username: 'founder', roles: ['moderator'] }), res, fakeGame);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/grant script/);
    expect(setAccountAdminRoles).not.toHaveBeenCalled();
  });

  it('applies a valid role change through the audited writer', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(adminRolesForAccount).mockImplementation(async (id: number) =>
      id === 7 ? { username: 'operator', roles: ['superadmin'] } : null,
    );
    vi.mocked(findAccount).mockResolvedValue({ id: 9, username: 'newmod' } as never);
    vi.mocked(setAccountAdminRoles).mockResolvedValue({ before: [], after: ['moderator'] });
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/staff/roles',
        body: { username: 'newmod', roles: ['moderator'] },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(setAccountAdminRoles).toHaveBeenCalledWith({
      accountId: 9,
      roles: ['moderator'],
      actorAccountId: 7,
    });
    expect(res.body.data).toEqual({ ok: true, username: 'newmod', roles: ['moderator'] });
  });

  it('resolves a wrong method on a known path as 405, unknown paths as 404', async () => {
    actAs(['superadmin']);
    let res = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/staff/roles' }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(405);

    actAs(['superadmin']);
    res = fakeRes();
    await handleAdminApi(
      fakeReq({ method: 'POST', token: VALID_TOKEN, url: '/admin/api/overview', body: {} }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(405);

    actAs(['superadmin']);
    res = fakeRes();
    await handleAdminApi(fakeReq({ token: VALID_TOKEN, url: '/admin/api/nope' }), res, fakeGame);
    expect(res.statusCode).toBe(404);
  });
});

describe('admin login payload', () => {
  it('returns roles and expanded permissions for a staff account', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'alice',
      password_hash: 'hash',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'alice', roles: ['viewer'] });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'alice', password: 'pw' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      token: 'b'.repeat(64),
      username: 'alice',
      roles: ['viewer'],
      permissions: expect.arrayContaining(['analytics.read', 'support.read', 'accounts.read']),
    });
  });

  it('rejects a correct password without a staff role with 403', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'bob',
      password_hash: 'hash',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue(null);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'bob', password: 'pw' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/does not have admin access/);
  });
});

// Regression coverage for the missing per-account brute-force lockout on the legacy
// handleLogin arm: unlike POST /api/login (server/auth_routes.ts), admin login had
// no authThrottled / recordAuthFailure / clearAuthFailures gate, so a distributed
// attacker who never repeats a source IP could guess a known admin username's
// password forever, capped only by ADMIN_LOGIN_MAX_PER_MINUTE per IP (never per
// account).
describe('admin login: per-account failed-login throttle (distributed brute force)', () => {
  const MAX_AUTH_FAILURES = 10; // server/ratelimit.ts, not exported

  it('429s the (MAX_AUTH_FAILURES + 1)th bad-password attempt against ONE account even though every attempt uses a DIFFERENT source IP', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'victim',
      password_hash: 'hash',
    } as never);

    let res: FakeResponse & ServerResponse = fakeRes();
    for (let i = 0; i < MAX_AUTH_FAILURES + 1; i++) {
      res = fakeRes();
      // A fresh, never-repeated source IP per attempt: the per-IP limiter
      // (ADMIN_LOGIN_MAX_PER_MINUTE, 10/min) never sees more than one request from
      // any of these, so if it were the only guard this loop would never lock out.
      await handleAdminApi(
        fakeReq({
          method: 'POST',
          url: '/admin/api/login',
          body: { username: 'victim', password: 'wrong' },
          ip: `203.0.113.${i + 1}`,
        }),
        res,
        fakeGame,
      );
    }
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('too many failed attempts, wait a few minutes and try again');
    // Locked out BEFORE any credential check on the final attempt: verifyPassword
    // was reached exactly MAX_AUTH_FAILURES times (once per prior failure), never
    // on the attempt that trips the lockout.
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(MAX_AUTH_FAILURES);
  });

  it('never locks out a DIFFERENT account sharing no username with the attacked one', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'victim',
      password_hash: 'hash',
    } as never);
    for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
      await handleAdminApi(
        fakeReq({
          method: 'POST',
          url: '/admin/api/login',
          body: { username: 'victim', password: 'wrong' },
          ip: `203.0.113.${i + 1}`,
        }),
        fakeRes(),
        fakeGame,
      );
    }
    // 'bystander' has never failed a login, so it is unaffected by victim's lockout.
    vi.mocked(findAccount).mockResolvedValue({
      id: 4,
      username: 'bystander',
      password_hash: 'hash2',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'bystander', roles: ['viewer'] });
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'bystander', password: 'right' },
        ip: '198.51.100.1',
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
  });

  it('a successful login clears the account throttle so a later run needs a fresh MAX_AUTH_FAILURES failures', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'bob',
      password_hash: 'hash',
    } as never);
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) {
      await handleAdminApi(
        fakeReq({
          method: 'POST',
          url: '/admin/api/login',
          body: { username: 'bob', password: 'wrong' },
          ip: `203.0.113.${i + 1}`,
        }),
        fakeRes(),
        fakeGame,
      );
    }
    // One under the ceiling; a correct password now succeeds and forgives the typos.
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'bob', roles: ['viewer'] });
    const okRes = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'bob', password: 'correct' },
        ip: '198.51.100.9',
      }),
      okRes,
      fakeGame,
    );
    expect(okRes.statusCode).toBe(200);

    // Failures started fresh: MAX_AUTH_FAILURES - 1 more bad attempts still don't
    // lock the account out.
    let lastRes: FakeResponse & ServerResponse = fakeRes();
    for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) {
      lastRes = fakeRes();
      await handleAdminApi(
        fakeReq({
          method: 'POST',
          url: '/admin/api/login',
          body: { username: 'bob', password: 'wrong-again' },
          ip: `192.0.2.${i + 1}`,
        }),
        lastRes,
        fakeGame,
      );
    }
    expect(lastRes.statusCode).toBe(401);
  });
});

// Regression coverage for BUG #15: the legacy handleLogin arm verified only
// password + staff role and skipped the account's TOTP second factor entirely
// (unlike POST /api/login, server/auth_routes.ts loginHandler), so an operator
// with 2FA enabled could sign into the highest-privilege surface in the app
// with a bare password.
describe('admin login: two-factor', () => {
  it('returns twoFactorRequired without a token when 2FA is on and no code is supplied', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'alice',
      password_hash: 'hash',
      totp_enabled_at: '2020-01-01T00:00:00.000Z',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'alice', roles: ['viewer'] });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'alice', password: 'pw' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ twoFactorRequired: true });
    expect(verifyLoginTwoFactor).not.toHaveBeenCalled();
  });

  it('401s an invalid 2FA code and records a failure', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'alice',
      password_hash: 'hash',
      totp_enabled_at: '2020-01-01T00:00:00.000Z',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'alice', roles: ['viewer'] });
    vi.mocked(verifyLoginTwoFactor).mockResolvedValueOnce(false);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'alice', password: 'pw', code: '000000' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('invalid authentication code');
    expect(authFailureCount()).toBe(1);
  });

  it('200s and issues a token for a good 2FA code', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'alice',
      password_hash: 'hash',
      totp_enabled_at: '2020-01-01T00:00:00.000Z',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'alice', roles: ['viewer'] });
    vi.mocked(verifyLoginTwoFactor).mockResolvedValueOnce(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'alice', password: 'pw', code: '123456' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      token: 'b'.repeat(64),
      username: 'alice',
      roles: ['viewer'],
      permissions: expect.arrayContaining(['analytics.read', 'support.read', 'accounts.read']),
    });
  });

  it('never challenges a staff account without 2FA enabled (no regression)', async () => {
    vi.mocked(findAccount).mockResolvedValue({
      id: 3,
      username: 'alice',
      password_hash: 'hash',
    } as never);
    vi.mocked(verifyPassword).mockResolvedValueOnce(true);
    vi.mocked(adminRolesForAccount).mockResolvedValue({ username: 'alice', roles: ['viewer'] });
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        url: '/admin/api/login',
        body: { username: 'alice', password: 'pw' },
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect((res.body.data as { token?: string }).token).toBe('b'.repeat(64));
    expect(verifyLoginTwoFactor).not.toHaveBeenCalled();
  });
});

describe('staff role change live effects', () => {
  const postRoles = (body: unknown) =>
    fakeReq({ method: 'POST', token: VALID_TOKEN, url: '/admin/api/staff/roles', body });

  const actorAndTarget = () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(adminRolesForAccount).mockImplementation(async (id: number) =>
      id === 7
        ? { username: 'operator', roles: ['superadmin'] }
        : { username: 'modbob', roles: ['moderator'] },
    );
    vi.mocked(findAccount).mockResolvedValue({ id: 9, username: 'modbob' } as never);
  };

  it('accepts an empty role set as a full revoke and disconnects live sessions', async () => {
    actorAndTarget();
    vi.mocked(setAccountAdminRoles).mockResolvedValue({ before: ['moderator'], after: [] });
    const res = fakeRes();

    await handleAdminApi(postRoles({ username: 'modbob', roles: [] }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    expect(setAccountAdminRoles).toHaveBeenCalledWith({
      accountId: 9,
      roles: [],
      actorAccountId: 7,
    });
    expect(fakeGame.disconnectAccount).toHaveBeenCalledWith(9, expect.any(String));
  });

  it('does not disconnect on a no-op role write', async () => {
    actorAndTarget();
    vi.mocked(setAccountAdminRoles).mockResolvedValue({
      before: ['moderator'],
      after: ['moderator'],
    });
    const res = fakeRes();

    await handleAdminApi(postRoles({ username: 'modbob', roles: ['moderator'] }), res, fakeGame);

    expect(res.statusCode).toBe(200);
    expect(fakeGame.disconnectAccount).not.toHaveBeenCalled();
  });
});

describe('admin api R35 professions tooling (LEGACY dispatch arm)', () => {
  beforeEach(() => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
  });

  it('serves the professions inspector through the legacy arm', async () => {
    vi.mocked(characterProfessionsRow).mockResolvedValue({
      id: 42,
      name: 'Merlin',
      class: 'mage',
      level: 12,
      accountId: 9,
      username: 'alice',
      state: { gatheringProficiency: { mining: 5 } },
      updatedAt: '2026-06-01T00:00:00Z',
    });
    vi.mocked(fakeGame.adminCharacterState).mockReturnValue(null);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/characters/42/professions' }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.name).toBe('Merlin');
    expect(res.body.data.live).toBe(false);
    expect(res.body.data.gathering).toContainEqual({ professionId: 'mining', proficiency: 5 });
  });

  it('restore-item audits FIRST then mints, mirroring the RouteDef arm', async () => {
    vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
    vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(true);
    vi.mocked(fakeGame.adminRestoreItem).mockReturnValue('ok');
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/restore-item',
        body: { itemId: 'copper_mining_pick', count: 2, reason: 'lost to a bug' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(recordProfessionsRestore).toHaveBeenCalledWith({
      characterId: 42,
      adminAccountId: 7,
      action: 'restore_item',
      detail: 'copper_mining_pick x2',
      reason: 'lost to a bug',
    });
    expect(fakeGame.adminRestoreItem).toHaveBeenCalledWith(42, 'copper_mining_pick', 2);
    const auditOrder = vi.mocked(recordProfessionsRestore).mock.invocationCallOrder[0];
    const mintOrder = vi.mocked(fakeGame.adminRestoreItem).mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(mintOrder);
  });

  it('restore-slot refuses an offline character BEFORE any audit write', async () => {
    vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
    vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(false);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/restore-slot',
        body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'lost' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('character is not online on this realm');
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
    expect(fakeGame.adminRestoreToolEffectSlot).not.toHaveBeenCalled();
  });

  // API_DISPATCH=legacy is the one-flag production rollback, so the legacy
  // arm needs the same behavioral coverage as the RouteDef twin: a drift
  // here surfaces exactly during an incident.
  it('restore-slot audits FIRST then mints, mirroring the RouteDef arm', async () => {
    vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
    vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(true);
    vi.mocked(fakeGame.adminRestoreToolEffectSlot).mockReturnValue('ok');
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/restore-slot',
        body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'row vanished' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(recordProfessionsRestore).toHaveBeenCalledWith({
      characterId: 42,
      adminAccountId: 7,
      action: 'restore_slot',
      detail: 'mining/gatherers_cache',
      reason: 'row vanished',
    });
    expect(fakeGame.adminRestoreToolEffectSlot).toHaveBeenCalledWith(
      42,
      'mining',
      'gatherers_cache',
    );
    const auditOrder = vi.mocked(recordProfessionsRestore).mock.invocationCallOrder[0];
    const mintOrder = vi.mocked(fakeGame.adminRestoreToolEffectSlot).mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(mintOrder);
  });

  it('maps every sim refusal to the SAME prose the RouteDef arm sends', async () => {
    const cases = [
      ['no_tool', 'the character owns no tool for that profession'],
      ['already_slotted', 'that profession already has a slotted effect'],
      ['invalid_request', 'that effect cannot be slotted on that profession'],
    ] as const;
    for (const [result, prose] of cases) {
      vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
      vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(true);
      vi.mocked(fakeGame.adminRestoreToolEffectSlot).mockReturnValue(result);
      const res = fakeRes();
      await handleAdminApi(
        fakeReq({
          method: 'POST',
          token: VALID_TOKEN,
          url: '/admin/api/moderation/characters/42/restore-slot',
          body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'lost' },
        }),
        res,
        fakeGame,
      );
      expect(res.statusCode, result).toBe(400);
      expect(res.body.error, result).toBe(prose);
    }
  });

  it('refuses an invalid body with the validator prose BEFORE any audit write', async () => {
    vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
    vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(true);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/restore-item',
        body: { itemId: 'copper_mining_pick', count: 25, reason: 'over the cap' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('count must be a whole number between 1 and 20');
    expect(recordProfessionsRestore).not.toHaveBeenCalled();
  });

  it('maps the post-audit offline race to its own prose (the row honestly says requested)', async () => {
    vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
    vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(true);
    vi.mocked(fakeGame.adminRestoreToolEffectSlot).mockReturnValue('offline');
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/restore-slot',
        body: { professionId: 'mining', effectId: 'gatherers_cache', reason: 'lost' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('character went offline before the restore landed');
    expect(recordProfessionsRestore).toHaveBeenCalled();
  });

  it('a live snapshot suppresses the blob fetch on the legacy arm too', async () => {
    vi.mocked(characterProfessionsRow).mockResolvedValue({
      id: 42,
      name: 'Merlin',
      class: 'mage',
      level: 12,
      accountId: 9,
      username: 'alice',
      updatedAt: '2026-06-01T00:00:00Z',
    } as never);
    vi.mocked(fakeGame.adminCharacterState).mockReturnValue({
      gatheringProficiency: { mining: 43.5 },
    } as never);
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({ token: VALID_TOKEN, url: '/admin/api/characters/42/professions' }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.live).toBe(true);
    expect(res.body.data.gathering).toContainEqual({ professionId: 'mining', proficiency: 43.5 });
    // The measured point of the CASE arm: a live read must pass
    // includeState=false so the widest TOAST column never detoasts.
    expect(characterProfessionsRow).toHaveBeenCalledWith(42, false);
  });
});

describe('admin api R35 restore-item invalid_item arm (LEGACY dispatch arm)', () => {
  it('maps a runtime invalid_item to its own prose, never the offline race', async () => {
    vi.mocked(accountAndScopeForToken).mockResolvedValue(fullToken(7));
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    vi.mocked(recordProfessionsRestore).mockResolvedValue({ accountId: 9 });
    vi.mocked(fakeGame.adminCharacterOnline).mockReturnValue(true);
    vi.mocked(fakeGame.adminRestoreItem).mockReturnValue('invalid_item');
    const res = fakeRes();
    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/characters/42/restore-item',
        body: { itemId: 'copper_mining_pick', count: 1, reason: 'lost' },
      }),
      res,
      fakeGame,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown item id');
  });
});
