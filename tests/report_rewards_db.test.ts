import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/db', () => ({
  pool: { query: fake.query },
  runWithStatementTimeout: (_ms: number, run: (q: typeof fake.query) => unknown) => run(fake.query),
}));

import { REALM } from '../server/realm';
import {
  claimReportRewardDelivery,
  createReportRewardsIn,
  dueReportRewards,
  pendingReportRewardNotices,
  REPORT_REWARDS_SCHEMA,
  retryReportRewardBatch,
} from '../server/report_rewards_db';

beforeEach(() => {
  fake.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});
describe('report reward persistence boundary', () => {
  it('chooses owned current realm characters set-wise and keeps a permanent unique account pair', async () => {
    await createReportRewardsIn(fake.query, 8);
    const [sql, args] = fake.query.mock.calls[0];
    expect(args).toEqual([8]);
    expect(sql).toContain('c.account_id = r.reporter_account_id');
    expect(sql).toContain('c.id = r.reporter_character_id');
    expect(sql).toContain('FROM reporters r JOIN LATERAL');
    expect(sql).toContain('ORDER BY (id = r.preferred_character_id) DESC NULLS LAST, id LIMIT 1');
    expect(sql).toContain("r.status IN ('open', 'actioned')");
    expect(sql).toContain('id, realm, name FROM recipients');
    expect(sql).toContain('ON CONFLICT (reporter_account_id, reported_account_id) DO NOTHING');
    expect(sql).not.toContain('mail_custody_parcels');
    expect(REPORT_REWARDS_SCHEMA).toContain('UNIQUE (reporter_account_id, reported_account_id)');
  });
  it('books the ledger and its attachment-free custody parcel in the same CAS statement', async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ custody_ref: 'report_reward:3' }], rowCount: 1 });
    expect(await claimReportRewardDelivery(3)).toBe(true);
    const [sql, args] = fake.query.mock.calls[0];
    expect(sql).toContain('booked_at IS NULL');
    expect(sql).toContain('INSERT INTO mail_custody_parcels');
    expect(sql).toContain("'report_reward', '[]'::jsonb, 0");
    expect(args).toEqual([3, REALM]);
    expect(await claimReportRewardDelivery(3)).toBe(false);
  });
  it('uses bounded realm queries and skips offline notice reads', async () => {
    await dueReportRewards();
    expect(fake.query.mock.calls[0][1]).toEqual([REALM, 100]);
    expect(fake.query.mock.calls[0][0]).toContain('booked_at IS NULL');
    await pendingReportRewardNotices([]);
    expect(fake.query).toHaveBeenCalledTimes(1);
    await pendingReportRewardNotices([2]);
    expect(fake.query.mock.calls[1][1]).toEqual([[2], 100]);
    expect(fake.query.mock.calls[1][0]).not.toContain('realm =');
  });
  it('backs off full recipients for sixty seconds on the partial due index', async () => {
    await retryReportRewardBatch([2]);
    expect(fake.query.mock.calls[0][0]).toContain("interval '60 seconds'");
    expect(fake.query.mock.calls[0][1]).toEqual([REALM, [2]]);
  });
});
