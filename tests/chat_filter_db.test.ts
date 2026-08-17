import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pruneChatViolationsBatch } from '../server/chat_filter_db';
import { pool } from '../server/db';

const query = vi.mocked(pool.query);

beforeEach(() => {
  query.mockReset();
});

describe('pruneChatViolationsBatch (the retention-sweep primitive)', () => {
  // Mirrors tests/unstuck_db.test.ts's pruneUnstuckReportsBatch suite: the
  // sweep owns cadence, budget, and batching, this primitive owns exactly
  // one bounded delete on the shared pool.
  it('runs one sibling-shaped bounded delete on the shared pool', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 5 } as any);

    await expect(pruneChatViolationsBatch(90, 1000)).resolves.toBe(5);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('DELETE FROM chat_violations');
    expect(sql).toContain("created_at < now() - ($1::int * INTERVAL '1 day')");
    expect(sql).toContain('ORDER BY created_at ASC, id ASC');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([90, 1000]);
  });

  it('keeps forever on zero and negative retention (the destructive-delete safe side)', async () => {
    await expect(pruneChatViolationsBatch(0, 1000)).resolves.toBe(0);
    await expect(pruneChatViolationsBatch(-3, 1000)).resolves.toBe(0);
    await expect(pruneChatViolationsBatch(Number.NaN, 1000)).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('normalizes fractional retention days up to one full day, never to zero', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await pruneChatViolationsBatch(0.5, 1000);
    expect(query.mock.calls[0][1]).toEqual([1, 1000]);
  });

  it('floors the batch size at one row (no LIMIT 0 infinite no-op)', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await pruneChatViolationsBatch(90, 0);
    expect(query.mock.calls[0][1]).toEqual([90, 1]);
  });

  it('a driver null rowCount reads as zero deleted, not a crash or NaN', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: null } as any);
    await expect(pruneChatViolationsBatch(90, 1000)).resolves.toBe(0);
  });
});
