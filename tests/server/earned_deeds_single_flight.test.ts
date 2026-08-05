// The earned-deeds roll-up feeds BOTH storefront mirrors' reconciles (D21
// keeps the observers independent), and on the login reconcile Steam and Epic
// read it back to back for the same account, so concurrent identical reads
// collapse into ONE query. Nothing is memoized past settle: sequential reads
// stay fresh, and a rejected flight is never cached.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_earned_deeds_sf';

import { afterEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ query: vi.fn() }));

// deeds_db pulls exactly these four names from the db module; mocking them all
// keeps the import free of the real pg pool.
vi.mock('../../server/db', () => ({
  DB_HEAVY_STATEMENT_TIMEOUT_MS: 5000,
  ELIGIBLE_ACCOUNT_SQL: 'TRUE',
  pool: { query: dbMocks.query },
  runWithStatementTimeout: vi.fn(),
}));

import { earnedDeedIdsForAccount } from '../../server/deeds_db';

afterEach(() => {
  dbMocks.query.mockReset();
});

describe('earnedDeedIdsForAccount single-flight', () => {
  it('collapses concurrent same-account reads into one query (the dual-mirror login reconcile)', async () => {
    let release: (v: { rows: { deed_id: string }[] }) => void = () => {};
    dbMocks.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const steamSide = earnedDeedIdsForAccount(7);
    const epicSide = earnedDeedIdsForAccount(7);
    release({ rows: [{ deed_id: 'prog_first_steps' }, { deed_id: 'cmb_slayer' }] });
    await expect(steamSide).resolves.toEqual(['prog_first_steps', 'cmb_slayer']);
    await expect(epicSide).resolves.toEqual(['prog_first_steps', 'cmb_slayer']);
    expect(dbMocks.query).toHaveBeenCalledTimes(1);
    // The one shared read is the real per-account roll-up.
    expect(dbMocks.query.mock.calls[0][0]).toBe(
      'SELECT DISTINCT deed_id FROM character_deeds WHERE account_id = $1',
    );
    expect(dbMocks.query.mock.calls[0][1]).toEqual([7]);
  });

  it('does not collapse across accounts, and a settled flight is never memoized', async () => {
    dbMocks.query.mockResolvedValue({ rows: [] });
    await Promise.all([earnedDeedIdsForAccount(1), earnedDeedIdsForAccount(2)]);
    expect(dbMocks.query).toHaveBeenCalledTimes(2);
    // Same account again, AFTER settle: a fresh read, not a stale memo.
    await earnedDeedIdsForAccount(1);
    expect(dbMocks.query).toHaveBeenCalledTimes(3);
  });

  it('a rejected flight is shared by its concurrent joiners but never cached', async () => {
    dbMocks.query.mockRejectedValueOnce(new Error('db down'));
    const first = earnedDeedIdsForAccount(9);
    const joiner = earnedDeedIdsForAccount(9);
    await expect(first).rejects.toThrow('db down');
    await expect(joiner).rejects.toThrow('db down');
    expect(dbMocks.query).toHaveBeenCalledTimes(1);
    dbMocks.query.mockResolvedValueOnce({ rows: [{ deed_id: 'a' }] });
    await expect(earnedDeedIdsForAccount(9)).resolves.toEqual(['a']);
    expect(dbMocks.query).toHaveBeenCalledTimes(2);
  });
});
