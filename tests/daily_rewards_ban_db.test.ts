import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));

vi.mock('../server/db', () => ({ pool: mocks }));
vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import { PgDailyRewardDb } from '../server/daily_rewards_db';

describe('Daily Rewards ban query enforcement', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.connect.mockReset();
  });

  it('resolves account and IP restrictions through the exclusion view', async () => {
    mocks.query.mockResolvedValue({ rows: [{ reason: 'shared IP abuse' }] });
    await expect(new PgDailyRewardDb().banForAccount(9)).resolves.toEqual({
      reason: 'shared IP abuse',
    });
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_excluded_accounts');
  });

  it('filters banned accounts from current leaderboard reads and pending payouts', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const db = new PgDailyRewardDb();

    await db.leaderboard('2026-07-11', 1, 10);
    await db.pendingPayouts(20);

    expect(mocks.query.mock.calls[0][0]).toContain('NOT EXISTS');
    expect(mocks.query.mock.calls[0][0]).toContain('daily_reward_excluded_accounts');
    expect(mocks.query.mock.calls[1][0]).toContain('NOT EXISTS');
    expect(mocks.query.mock.calls[1][0]).toContain('daily_reward_excluded_accounts');
  });

  it('filters banned accounts while selecting end-of-day winners', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });

    await new PgDailyRewardDb().finalizeDay('2026-07-11', 150, [1]);

    const winnerQuery = query.mock.calls.find(([sql]) =>
      String(sql).includes('FROM daily_reward_scores s'),
    );
    expect(winnerQuery?.[0]).toContain('NOT EXISTS');
    expect(winnerQuery?.[0]).toContain('daily_reward_excluded_accounts');
    expect(release).toHaveBeenCalledOnce();
  });

  it('prevents point and spin writes after a ban races an eligibility check', async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const transactionQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue({ query: transactionQuery, release: vi.fn() });
    const db = new PgDailyRewardDb();

    await db.recordSpin('2026-07-11', 9, 's20', 20);
    await db.addPoints('2026-07-11', 9, 'task', 10, 'task:1');

    expect(mocks.query.mock.calls[0][0]).toContain('WHERE NOT EXISTS');
    expect(transactionQuery.mock.calls[1][0]).toContain('WHERE NOT EXISTS');
  });
});
