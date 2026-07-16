import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => ({
  query: vi.fn<TestQuery>(),
  connect: vi.fn<() => Promise<PoolClient>>(),
}));

vi.mock('../server/db', () => ({
  pool: db,
}));

import {
  addAccountNote,
  cleanReportReason,
  cleanText,
  createPlayerReport,
  createSuspiciousRegistrationReport,
  forceCharacterRename,
  liftAccountChatMute,
  moderateAccount,
  moderationQueue,
  moderationReportsForAccount,
  muteAccountChat,
  recordInGameAction,
  setDailyRewardsBan,
  setDailyRewardsIpBan,
} from '../server/moderation_db';

const { query, connect } = db;

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return {
    command: '',
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

// A pooled-client stub whose query()/release() calls we can inspect. Pinning a
// single client for the whole transaction is what makes BEGIN/…/COMMIT atomic,
// so the tests assert every transactional statement runs through this stub.
function clientStub() {
  const cquery = vi.fn<TestQuery>().mockResolvedValue(queryResult([]));
  const release = vi.fn();
  return { query: cquery, release };
}

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe('moderation report helpers', () => {
  it('accepts only known report reasons and trims bounded text', () => {
    expect(cleanReportReason('spam')).toBe('spam');
    expect(cleanReportReason('bad')).toBeNull();
    expect(cleanText('  hello  ', 5)).toBe('hello');
    expect(cleanText('abcdef', 3)).toBe('abc');
  });

  it('rejects self reports before writing', async () => {
    await expect(
      createPlayerReport({
        reporterAccountId: 1,
        reporterCharacterId: 10,
        reporterCharacterName: 'Alice',
        target: { accountId: 1, characterId: 11, characterName: 'Alt' },
        reason: 'spam',
        details: 'same account',
      }),
    ).rejects.toThrow(/yourself/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects duplicate open reports in the recent window', async () => {
    query.mockResolvedValueOnce(queryResult([{ id: 99 }]));

    await expect(
      createPlayerReport({
        reporterAccountId: 1,
        reporterCharacterId: 10,
        reporterCharacterName: 'Alice',
        target: { accountId: 2, characterId: 20, characterName: 'Bob' },
        reason: 'harassment',
        details: 'duplicate',
      }),
    ).rejects.toThrow(/already reported/);
  });

  it('creates a system moderation report for suspicious sequential registration bursts', async () => {
    query
      .mockResolvedValueOnce(queryResult([{ n: 31 }])) // same numeric prefix
      .mockResolvedValueOnce(queryResult([{ n: 1 }])) // same IP
      .mockResolvedValueOnce(queryResult([{ n: 1 }])) // same /24
      .mockResolvedValueOnce(queryResult([{ n: 1 }])) // same UA
      .mockResolvedValueOnce(queryResult([])) // duplicate report check
      .mockResolvedValueOnce(queryResult([{ id: 123 }])); // insert

    const result = await createSuspiciousRegistrationReport({
      accountId: 42,
      username: 'aintgrave1031',
      ip: '203.0.113.44',
      userAgent: 'Mozilla/5.0',
    });

    expect(result.created).toBe(true);
    expect(result.signals).toContain('31 accounts with username prefix "aintgrave" in 10 minutes');
    expect(query.mock.calls[4][0]).toMatch(/FROM player_reports/);
    expect(query.mock.calls[5][0]).toMatch(/INSERT INTO player_reports/);
    expect(query.mock.calls[5][1]).toEqual([
      42,
      'spam',
      expect.stringContaining('Automated registration pattern'),
    ]);
  });

  it('does not create a system moderation report without a suspicious registration signal', async () => {
    query
      .mockResolvedValueOnce(queryResult([{ n: 1 }]))
      .mockResolvedValueOnce(queryResult([{ n: 1 }]))
      .mockResolvedValueOnce(queryResult([{ n: 1 }]))
      .mockResolvedValueOnce(queryResult([{ n: 1 }]));

    const result = await createSuspiciousRegistrationReport({
      accountId: 42,
      username: 'reuben',
      ip: '203.0.113.44',
      userAgent: 'Mozilla/5.0',
    });

    expect(result).toEqual({ created: false, signals: [] });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('sorts moderation queue by open report count, recency, then online status', async () => {
    query.mockResolvedValueOnce(
      queryResult([
        {
          account_id: 2,
          username: 'offline-two',
          is_admin: false,
          banned_at: null,
          suspended_until: null,
          open_reports: 2,
          latest_report_at: '2026-06-01T00:00:00Z',
          latest_reason: 'spam',
          character_names: ['B'],
        },
        {
          account_id: 3,
          username: 'online-two',
          is_admin: true,
          banned_at: null,
          suspended_until: null,
          open_reports: 2,
          latest_report_at: '2026-05-01T00:00:00Z',
          latest_reason: 'spam',
          character_names: ['C'],
        },
        {
          account_id: 4,
          username: 'one',
          is_admin: false,
          banned_at: null,
          suspended_until: null,
          open_reports: 1,
          latest_report_at: '2026-06-10T00:00:00Z',
          latest_reason: 'other',
          character_names: ['D'],
        },
      ]),
    );

    const rows = await moderationQueue(new Set([3]));

    expect(rows.map((r) => r.accountId)).toEqual([2, 3, 4]);
    expect(rows[1].online).toBe(true);
    expect(rows[1].isAdmin).toBe(true);
    expect(query.mock.calls[0][0]).toMatch(/a\.is_admin/);
  });

  it('loads per-report chat context before each report timestamp', async () => {
    query
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 7,
            reason: 'harassment',
            details: 'bad chat',
            status: 'open',
            created_at: '2026-06-13T00:00:00Z',
            reporter_account_id: 1,
            reporter_username: 'alice',
            reporter_character_id: 10,
            reporter_character_name: 'Alice',
            reported_account_id: 2,
            reported_username: 'bob',
            reported_character_id: 20,
            reported_character_name: 'Bob',
          },
        ]),
      )
      .mockResolvedValueOnce(
        queryResult([
          {
            id: 2,
            character_name: 'Bob',
            channel: 'say',
            message: 'second',
            created_at: '2026-06-12T23:59:00Z',
          },
          {
            id: 1,
            character_name: 'Bob',
            channel: 'say',
            message: 'first',
            created_at: '2026-06-12T23:58:00Z',
          },
        ]),
      );

    const reports = await moderationReportsForAccount(2);

    expect(reports).toHaveLength(1);
    expect(query.mock.calls[1][1]).toEqual([20, '2026-06-13T00:00:00Z']);
    expect(reports[0].chatContext.map((c) => c.message)).toEqual(['first', 'second']);
  });

  it('rejects suspension expiry values that are not in the future', async () => {
    await expect(
      moderateAccount({
        accountId: 2,
        adminAccountId: 1,
        action: 'suspend',
        reason: 'test',
        expiresAt: '2020-01-01T00:00:00Z',
      }),
    ).rejects.toThrow(/future/);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires a future chat mute expiry', async () => {
    await expect(
      muteAccountChat({
        accountId: 2,
        adminAccountId: 1,
        reason: 'cool down',
        expiresAt: '2020-01-01T00:00:00Z',
      }),
    ).rejects.toThrow(/future/);
    expect(query).not.toHaveBeenCalled();
  });

  it('mutes account chat and writes an audit action in one transaction', async () => {
    const client = clientStub();
    connect.mockResolvedValue(client as unknown as PoolClient);
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    await muteAccountChat({
      accountId: 2,
      adminAccountId: 1,
      reason: 'tone it down',
      expiresAt,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/chat_muted_until/);
    expect(client.query.mock.calls[1][1]).toEqual([2, new Date(expiresAt), 'tone it down']);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual([
      2,
      1,
      'chat_mute',
      'tone it down',
      new Date(expiresAt),
    ]);
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('lifts an active chat mute and writes a dedicated audit action', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([], 1))
      .mockResolvedValue(queryResult([]));
    connect.mockResolvedValue(client as unknown as PoolClient);

    await liftAccountChatMute({
      accountId: 2,
      adminAccountId: 1,
      reason: 'appeal accepted',
    });

    expect(client.query.mock.calls[1][0]).toMatch(/chat_muted_until = NULL/);
    expect(client.query.mock.calls[1][0]).toMatch(/chat_mute_reason = NULL/);
    expect(client.query.mock.calls[1][0]).toMatch(/chat_muted_until > now\(\)/);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual([2, 1, 'chat_unmute', 'appeal accepted', null]);
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
  });

  it('rejects lifting chat mute when no active mute exists', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([], 0))
      .mockResolvedValue(queryResult([]));
    connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      liftAccountChatMute({
        accountId: 2,
        adminAccountId: 1,
        reason: 'appeal accepted',
      }),
    ).rejects.toThrow(/not chat muted/);

    expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
  });

  it('requires a moderation reason for suspend and ban actions', async () => {
    await expect(
      moderateAccount({
        accountId: 2,
        adminAccountId: 1,
        action: 'ban',
        reason: '   ',
      }),
    ).rejects.toThrow(/reason/);
    expect(query).not.toHaveBeenCalled();
  });

  it('unbans accounts and writes an audit action in one transaction', async () => {
    const client = clientStub();
    connect.mockResolvedValue(client as unknown as PoolClient);

    await moderateAccount({
      accountId: 2,
      adminAccountId: 1,
      action: 'unban',
      reason: 'appeal accepted',
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/SET banned_at = NULL, suspended_until = NULL/);
    expect(client.query.mock.calls[1][1]).toEqual([2, 'appeal accepted']);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual([2, 1, 'unban', 'appeal accepted', null]);
    expect(client.query.mock.calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('unsuspends an active suspension and writes a dedicated audit action', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([], 1))
      .mockResolvedValue(queryResult([]));
    connect.mockResolvedValue(client as unknown as PoolClient);

    await moderateAccount({
      accountId: 2,
      adminAccountId: 1,
      action: 'unsuspend',
      reason: 'appeal accepted',
    });

    expect(client.query.mock.calls[1][0]).toMatch(/SET suspended_until = NULL/);
    expect(client.query.mock.calls[1][0]).toMatch(/suspended_until > now\(\)/);
    expect(client.query.mock.calls[1][1]).toEqual([2, 'appeal accepted']);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[2][1]).toEqual([2, 1, 'unsuspend', 'appeal accepted', null]);
    expect(client.query.mock.calls[3][0]).toBe('COMMIT');
  });

  it('rejects unsuspending an account without an active suspension', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([], 0))
      .mockResolvedValue(queryResult([]));
    connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      moderateAccount({
        accountId: 2,
        adminAccountId: 1,
        action: 'unsuspend',
        reason: 'appeal accepted',
      }),
    ).rejects.toThrow(/not suspended/);

    expect(client.query.mock.calls[2][0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('clears the opposing lock flag so a ban and a suspension never both stand', async () => {
    // Banning must clear any standing suspension; suspending must clear any
    // standing ban. The latter matters because moderationStatusForAccount reads
    // banned_at before suspended_until, so a leftover ban would silently mask a
    // downgrade-to-suspension and keep the account locked out forever.
    const banClient = clientStub();
    connect.mockResolvedValueOnce(banClient as unknown as PoolClient);
    await moderateAccount({ accountId: 2, adminAccountId: 1, action: 'ban', reason: 'cheating' });
    const banUpdateCall = banClient.query.mock.calls.find((call) =>
      /UPDATE accounts/.test(call[0]),
    );
    if (!banUpdateCall) throw new Error('ban update query not found');
    const banUpdate = banUpdateCall[0];
    expect(banUpdate).toMatch(/banned_at = now\(\)/);
    expect(banUpdate).toMatch(/suspended_until = NULL/);

    const suspendClient = clientStub();
    connect.mockResolvedValueOnce(suspendClient as unknown as PoolClient);
    await moderateAccount({
      accountId: 2,
      adminAccountId: 1,
      action: 'suspend',
      reason: 'cooling off',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const suspendUpdateCall = suspendClient.query.mock.calls.find((call) =>
      /UPDATE accounts/.test(call[0]),
    );
    if (!suspendUpdateCall) throw new Error('suspension update query not found');
    const suspendUpdate = suspendUpdateCall[0];
    expect(suspendUpdate).toMatch(/banned_at = NULL/);
    expect(suspendUpdate).toMatch(/suspended_until = \$2/);
  });

  it('requires note text and writes nothing for an empty note', async () => {
    await expect(addAccountNote({ accountId: 2, adminAccountId: 1, note: '   ' })).rejects.toThrow(
      /note/,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('appends a note as an audit-only action without touching account state or reports', async () => {
    query.mockResolvedValueOnce(queryResult([], 1));

    await addAccountNote({ accountId: 2, adminAccountId: 1, note: 'watching for repeat behavior' });

    expect(connect).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO account_moderation_actions/);
    expect(sql).not.toMatch(/UPDATE accounts/);
    expect(sql).not.toMatch(/player_reports/);
    expect(params).toEqual([2, 1, 'note', 'watching for repeat behavior', null]);
  });

  it('persists and audits a Daily Rewards ban atomically', async () => {
    const client = clientStub();
    connect.mockResolvedValue(client as unknown as PoolClient);

    await setDailyRewardsBan({
      accountId: 2,
      adminAccountId: 1,
      banned: true,
      reason: 'automated play',
    });

    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO daily_reward_bans'),
      expect.stringContaining('INSERT INTO account_moderation_actions'),
      'COMMIT',
    ]);
    expect(client.query.mock.calls[2][1]).toEqual([
      2,
      1,
      'daily_rewards_ban',
      'automated play',
      null,
    ]);
  });

  it('persists a timed Daily Rewards ban and its audited expiry', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ expires_at: '2026-07-16T06:00:00.000Z' }]))
      .mockResolvedValue(queryResult([]));
    connect.mockResolvedValue(client as unknown as PoolClient);

    await setDailyRewardsBan({
      accountId: 2,
      adminAccountId: 1,
      banned: true,
      reason: 'automated play',
      durationHours: 6,
    });

    expect(client.query.mock.calls[1][0]).toContain('expires_at');
    expect(client.query.mock.calls[1][1]).toEqual([2, 'automated play', 1, 6]);
    expect(client.query.mock.calls[2][1]).toEqual([
      2,
      1,
      'daily_rewards_ban',
      'automated play',
      '2026-07-16T06:00:00.000Z',
    ]);
  });

  it('rejects an invalid Daily Rewards ban duration before opening a transaction', async () => {
    await expect(
      setDailyRewardsBan({
        accountId: 2,
        adminAccountId: 1,
        banned: true,
        reason: 'automated play',
        durationHours: 0,
      }),
    ).rejects.toThrow('daily rewards ban duration must be between 1 and 8760 hours');
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([true, '12', [12]])(
    'rejects non-number Daily Rewards ban duration %j',
    async (durationHours) => {
      await expect(
        setDailyRewardsBan({
          accountId: 2,
          adminAccountId: 1,
          banned: true,
          reason: 'automated play',
          durationHours,
        }),
      ).rejects.toThrow('daily rewards ban duration must be between 1 and 8760 hours');
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('removes and audits a Daily Rewards ban atomically', async () => {
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([], 1))
      .mockResolvedValue(queryResult([]));
    connect.mockResolvedValue(client as unknown as PoolClient);

    await setDailyRewardsBan({
      accountId: 2,
      adminAccountId: 1,
      banned: false,
      reason: 'appeal accepted',
    });

    expect(client.query.mock.calls[1][0]).toContain('DELETE FROM daily_reward_bans');
    expect(client.query.mock.calls[2][1]).toEqual([
      2,
      1,
      'daily_rewards_unban',
      'appeal accepted',
      null,
    ]);
  });

  it('persists and audits a Daily Rewards IP ban atomically', async () => {
    const client = clientStub();
    connect.mockResolvedValue(client as unknown as PoolClient);

    await setDailyRewardsIpBan({
      accountId: 2,
      adminAccountId: 1,
      ip: '203.0.113.4',
      banned: true,
      reason: 'multi-account abuse',
    });

    expect(client.query.mock.calls[1][0]).toContain('INSERT INTO daily_reward_ip_bans');
    expect(client.query.mock.calls[1][1]).toEqual(['203.0.113.4', 'multi-account abuse', 1]);
    expect(client.query.mock.calls[2][1]).toEqual([
      2,
      1,
      'daily_rewards_ip_ban',
      'multi-account abuse (IP: 203.0.113.4)',
      null,
    ]);
  });

  it('records in-game kick and kill actions without changing account state', async () => {
    query.mockResolvedValue(queryResult([], 1));

    await recordInGameAction({
      action: 'kick',
      accountId: 2,
      adminAccountId: 1,
      reason: 'griefing',
    });
    await recordInGameAction({
      action: 'kill',
      accountId: 3,
      adminAccountId: 1,
      reason: 'spawn camping',
    });

    expect(connect).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual([2, 1, 'kick', 'griefing', null]);
    expect(query.mock.calls[1][1]).toEqual([3, 1, 'kill', 'spawn camping', null]);
  });

  it('marks a character for forced rename and action-resolves its reports', async () => {
    query.mockResolvedValueOnce(queryResult([{ account_id: 2 }]));
    const client = clientStub();
    connect.mockResolvedValue(client as unknown as PoolClient);

    const result = await forceCharacterRename({
      characterId: 20,
      adminAccountId: 1,
      reason: 'offensive name',
    });

    expect(result).toEqual({ accountId: 2 });
    // The whole transaction must run on one pinned client, not arbitrary pooled
    // connections, otherwise BEGIN/…/COMMIT are not actually atomic.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN');
    expect(client.query.mock.calls[1][0]).toMatch(/UPDATE characters SET force_rename = TRUE/);
    expect(client.query.mock.calls[2][0]).toMatch(/account_moderation_actions/);
    expect(client.query.mock.calls[3][0]).toMatch(/UPDATE player_reports/);
    expect(client.query.mock.calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back on the pinned client and releases it when a statement fails', async () => {
    query.mockResolvedValueOnce(queryResult([{ account_id: 2 }]));
    const client = clientStub();
    client.query
      .mockResolvedValueOnce(queryResult([])) // BEGIN
      .mockRejectedValueOnce(new Error('db down')) // first UPDATE fails
      .mockResolvedValue(queryResult([])); // ROLLBACK
    connect.mockResolvedValue(client as unknown as PoolClient);

    await expect(
      forceCharacterRename({ characterId: 20, adminAccountId: 1, reason: 'offensive name' }),
    ).rejects.toThrow(/db down/);

    const stmts = client.query.mock.calls.map((c) => c[0]);
    expect(stmts).toContain('ROLLBACK');
    expect(stmts).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
