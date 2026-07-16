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
  accountForToken: vi.fn(),
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
    clientPerfSummary: vi.fn(),
    clientPerfRaw: vi.fn(),
  };
});
vi.mock('../server/auth', () => ({
  verifyPassword: vi.fn(async () => false),
  newToken: vi.fn(() => 'b'.repeat(64)),
  hashPassword: vi.fn(async () => 'salt:hashed'),
  MIN_PASSWORD_LENGTH: 6,
  MAX_PASSWORD_LENGTH: 128,
}));
vi.mock('../server/moderation_db', () => ({
  forceCharacterRename: vi.fn(),
  moderationQueue: vi.fn(),
  moderationReportsForAccount: vi.fn(),
  ignoreReport: vi.fn(),
  liftAccountChatMute: vi.fn(),
  moderateAccount: vi.fn(),
  muteAccountChat: vi.fn(),
  recordPasswordReset: vi.fn(),
}));
vi.mock('../server/chat_filter_db', () => ({
  addFilterWord: vi.fn(),
  chatModeratedAccounts: vi.fn(async () => []),
  chatModerationForAccount: vi.fn(),
  getFilterConfig: vi.fn(),
  listFilterWords: vi.fn(),
  removeFilterWord: vi.fn(),
  resetChatStrikes: vi.fn(),
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

import { handleAdminApi, parsePageParams } from '../server/admin';
import {
  accountDetail,
  associationsForIp,
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
import { hashPassword, verifyPassword } from '../server/auth';
import type { CalibrationHistogram, SuspiciousPlayer } from '../server/bot_detector/contract';
import {
  addFilterWord,
  chatModerationForAccount,
  getFilterConfig,
  listFilterWords,
  removeFilterWord,
  resetChatStrikes,
  updateFilterConfig,
} from '../server/chat_filter_db';
import {
  accountById,
  accountForToken,
  accountMailTarget,
  findAccount,
  isAdminAccount,
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
  recordPasswordReset,
} from '../server/moderation_db';
import {
  adminRolesForAccount,
  listStaff,
  roleChangeHistory,
  setAccountAdminRoles,
} from '../server/staff_db';

const VALID_TOKEN = 'a'.repeat(64);

function fakeReq(opts: { method?: string; url?: string; token?: string; body?: unknown } = {}) {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: { authorization?: string };
    socket: { remoteAddress: string };
  };
  req.method = opts.method ?? 'GET';
  req.url = opts.url ?? '/admin/api/overview';
  req.headers = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  req.socket = { remoteAddress: `10.0.0.${Math.floor(Math.random() * 250) + 1}` };
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
  liveSharedIps: vi.fn<() => LiveSharedIp[]>(() => []),
  disconnectAccount: vi.fn(),
  muteAccountChat: vi.fn(),
  reloadChatFilter: vi.fn(async () => {}),
  liftChatMuteLive: vi.fn(),
  resetChatStrikesLive: vi.fn(),
  isIpBlocked: vi.fn(() => false),
  reloadBlockedIps: vi.fn(async () => {}),
  disconnectByIp: vi.fn(),
};
const fakeGame = fakeGameState as typeof fakeGameState & Parameters<typeof handleAdminApi>[2];

beforeEach(() => {
  vi.clearAllMocks();
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
    vi.mocked(accountForToken).mockResolvedValue(7);
    vi.mocked(isAdminAccount).mockResolvedValue(false);
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN }), res, fakeGame);

    expect(res.statusCode).toBe(401);
    expect(isAdminAccount).toHaveBeenCalledWith(7);
  });

  it('serves the overview to an admin token and includes live server stats', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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

  it('serves persistent online history with cleaned range parameters', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
    vi.mocked(isAdminAccount).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(fakeReq({ token: VALID_TOKEN, url: '/admin/api/nope' }), res, fakeGame);

    expect(res.statusCode).toBe(404);
  });

  it('passes pagination and search through to the accounts query', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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

  it('serves shared IPs with their current block state', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    expect(res.body.data.accounts[0].online).toBe(true);
  });

  it('rejects an invalid IP association lookup', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
      byGpu: [],
      byBrowser: [],
      byOs: [],
      byScenario: [],
      worstGpuBuckets: [],
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
  });

  it('bans and disconnects an account', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
  });

  it('mutes account chat and sends a live warning without disconnecting', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
  });

  it('unsuspends without disconnecting the account', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
  });

  it('rejects suspending or banning admin accounts', async () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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

describe('admin api chat filter', () => {
  beforeEach(() => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(resetChatStrikes).mockResolvedValue(true);
    const res = fakeRes();

    await handleAdminApi(
      fakeReq({
        method: 'POST',
        token: VALID_TOKEN,
        url: '/admin/api/moderation/accounts/9/reset-strikes',
      }),
      res,
      fakeGame,
    );

    expect(res.statusCode).toBe(200);
    expect(resetChatStrikes).toHaveBeenCalledWith(9);
    expect(fakeGame.resetChatStrikesLive).toHaveBeenCalledWith(9);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(accountId);
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
    vi.mocked(accountForToken).mockResolvedValue(accountId);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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
    vi.mocked(accountForToken).mockResolvedValue(7);
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

describe('staff role change live effects', () => {
  const postRoles = (body: unknown) =>
    fakeReq({ method: 'POST', token: VALID_TOKEN, url: '/admin/api/staff/roles', body });

  const actorAndTarget = () => {
    vi.mocked(accountForToken).mockResolvedValue(7);
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
