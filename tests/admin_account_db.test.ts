import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: { query: mocks.query },
  DB_HEAVY_STATEMENT_TIMEOUT_MS: 60_000,
  // accountDetail runs its unbounded play_sessions aggregate on the raised
  // allowance (server/admin_db.ts); pass the wrapped read straight through to
  // the same spy so each test's mockResolvedValueOnce chain keeps its order.
  runWithStatementTimeout: (_timeoutMs: number, fn: (q: typeof mocks.query) => unknown) =>
    fn(mocks.query),
}));

vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
}));

import { accountDetail, dailyRewardPointEvents, listModerationActions } from '../server/admin_db';

describe('admin account detail query', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('returns recent moderation actions with their current admin identity', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 7,
            username: 'alice',
            created_at: '2026-01-01T00:00:00Z',
            last_login: '2026-06-01T00:00:00Z',
            is_admin: false,
            banned_at: null,
            suspended_until: null,
            moderation_reason: '',
            chat_muted_until: null,
            chat_mute_reason: '',
            chat_strikes: 0,
            daily_rewards_ban_reason: 'leaderboard manipulation',
            daily_rewards_banned_at: '2026-06-01T01:00:00Z',
            daily_rewards_ban_expires_at: '2026-06-01T07:00:00Z',
            last_login_ip: '203.0.113.7',
            playtime_seconds: 3600,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: '12',
            action: 'suspend',
            reason: 'harassment',
            created_at: '2026-06-01T02:00:00Z',
            expires_at: '2026-06-02T02:00:00Z',
            admin_account_id: 3,
            admin_username: 'moderator',
          },
        ],
      });

    const detail = await accountDetail(7);

    expect(detail?.moderationHistory).toEqual([
      {
        id: 12,
        action: 'suspend',
        reason: 'harassment',
        createdAt: '2026-06-01T02:00:00Z',
        expiresAt: '2026-06-02T02:00:00Z',
        adminAccountId: 3,
        adminUsername: 'moderator',
      },
    ]);
    expect(detail?.dailyRewardsBan).toEqual({
      reason: 'leaderboard manipulation',
      createdAt: '2026-06-01T01:00:00Z',
      expiresAt: '2026-06-01T07:00:00Z',
    });
    expect(mocks.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM account_moderation_actions action_log'),
      [7],
    );
    expect(mocks.query.mock.calls[3][0]).toContain(
      'ORDER BY action_log.created_at DESC, action_log.id DESC',
    );
    expect(mocks.query.mock.calls[3][0]).toContain('LIMIT 50');
    expect(mocks.query.mock.calls[0][0]).toContain('LEFT JOIN LATERAL');
    expect(mocks.query.mock.calls[0][0]).toContain('expires_at > now()');
  });

  it('returns positive point events for one account, reward day, and realm', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: '12',
          created_at: '2026-07-16T03:00:00Z',
          kind: 'task',
          points: 20,
          total_points: '35',
          total_events: '2',
          meta: { taskType: 'quest_completion', multiplier: 2, characterId: 99 },
        },
        {
          id: '10',
          created_at: '2026-07-16T01:00:00Z',
          kind: 'spin',
          points: 15,
          total_points: '15',
          total_events: '2',
          meta: { outcome: 's15', completionId: 'private-id' },
        },
      ],
    });

    const events = await dailyRewardPointEvents(7, '2026-07-16', 100);

    expect(events).toEqual({
      day: '2026-07-16',
      rows: [
        {
          id: 12,
          createdAt: '2026-07-16T03:00:00Z',
          kind: 'task',
          points: 20,
          totalPoints: 35,
          meta: { taskType: 'quest_completion', multiplier: 2 },
        },
        {
          id: 10,
          createdAt: '2026-07-16T01:00:00Z',
          kind: 'spin',
          points: 15,
          totalPoints: 15,
          meta: { outcome: 's15' },
        },
      ],
      total: 2,
      truncated: false,
    });
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain('account_id = $1');
    expect(sql).toContain('day = $2');
    expect(sql).toContain('realm = $3');
    expect(sql).toContain('points > 0');
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(sql).toContain('ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING');
    expect(params).toEqual([7, '2026-07-16', 'test-realm', 100]);
  });

  it('caps the point event log at 250 rows', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await dailyRewardPointEvents(7, '2026-07-16', 5000);

    expect(mocks.query.mock.calls[0][1]).toEqual([7, '2026-07-16', 'test-realm', 250]);
  });

  it('lists moderation actions newest first, mapping both account and ip sources', async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            source: 'ip',
            id: '31',
            account_id: null,
            username: null,
            ip: '203.0.113.7',
            action: 'block',
            reason: 'proxy abuse',
            created_at: '2026-06-03T03:00:00Z',
            expires_at: null,
            admin_account_id: 7,
            admin_username: 'moderator',
          },
          {
            source: 'account',
            id: '20',
            account_id: 9,
            username: 'target',
            ip: null,
            action: 'note',
            reason: 'follow up',
            created_at: '2026-06-03T02:00:00Z',
            expires_at: null,
            admin_account_id: 7,
            admin_username: 'moderator',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: 2 }] });

    const history = await listModerationActions('all', 7, 1, 100);

    expect(history).toEqual({
      rows: [
        {
          source: 'ip',
          id: 31,
          accountId: null,
          username: null,
          ip: '203.0.113.7',
          action: 'block',
          reason: 'proxy abuse',
          createdAt: '2026-06-03T03:00:00Z',
          expiresAt: null,
          adminAccountId: 7,
          adminUsername: 'moderator',
        },
        {
          source: 'account',
          id: 20,
          accountId: 9,
          username: 'target',
          ip: null,
          action: 'note',
          reason: 'follow up',
          createdAt: '2026-06-03T02:00:00Z',
          expiresAt: null,
          adminAccountId: 7,
          adminUsername: 'moderator',
        },
      ],
      total: 2,
      page: 1,
      limit: 100,
    });
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('ORDER BY created_at DESC, id DESC, source'),
      [100, 0],
    );
    expect(mocks.query.mock.calls[0][0]).toContain('UNION ALL');
    expect(mocks.query.mock.calls[0][0]).toContain('FROM blocked_ip_actions ip_action');
    // 'all' has no tab filter, so the page params start at $1: LIMIT $1 OFFSET $2.
    expect(mocks.query.mock.calls[0][0]).toContain('LIMIT $1 OFFSET $2');
    // The count query wraps the same union with no paging params.
    expect(mocks.query.mock.calls[1][1]).toEqual([]);
  });

  it('scopes the mine tab to the current moderator across both sources', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listModerationActions('mine', 7, 1, 100);

    expect(mocks.query.mock.calls[0][0]).toContain('WHERE action_log.admin_account_id = $1');
    // The ip branch is scoped to the moderator, NOT pruned with WHERE false (that is notes).
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE ip_action.admin_account_id = $1');
    expect(mocks.query.mock.calls[0][0]).not.toContain('WHERE false');
    expect(mocks.query.mock.calls[0][0]).not.toContain("action = 'note'");
    // params = [adminAccountId], so paging shifts to LIMIT $2 OFFSET $3.
    expect(mocks.query.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
    expect(mocks.query.mock.calls[0][1]).toEqual([7, 100, 0]);
    expect(mocks.query.mock.calls[1][1]).toEqual([7]);
  });

  it('scopes the notes tab to notes created by the current moderator', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await listModerationActions('notes', 7, 2, 100);

    expect(mocks.query.mock.calls[0][0]).toContain(
      "WHERE action_log.admin_account_id = $1 AND action_log.action = 'note'",
    );
    expect(mocks.query.mock.calls[0][0]).toContain('FROM blocked_ip_actions ip_action');
    expect(mocks.query.mock.calls[0][0]).toContain('WHERE false');
    // params = [adminAccountId], so paging shifts to LIMIT $2 OFFSET $3.
    expect(mocks.query.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
    expect(mocks.query.mock.calls[0][1]).toEqual([7, 100, 100]);
    expect(mocks.query.mock.calls[1][1]).toEqual([7]);
  });
});
