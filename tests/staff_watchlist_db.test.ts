import type { QueryResult, QueryResultRow } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResult<Record<string, unknown>>>;

const db = vi.hoisted(() => ({
  query: vi.fn<TestQuery>(),
  findCharacterReportTargetByName: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: { query: db.query },
  findCharacterReportTargetByName: db.findCharacterReportTargetByName,
}));

import {
  addStaffWatch,
  listStaffWatches,
  pgStaffWatchlist,
  removeStaffWatch,
  resetStaffWatchlistCacheForTests,
  STAFF_WATCHLIST_LIST_MAX,
  STAFF_WATCHLIST_SCHEMA,
  staffWatchForAccount,
} from '../server/staff_watchlist_db';

function queryResult<T extends QueryResultRow>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { command: '', rowCount, oid: 0, fields: [], rows };
}

beforeEach(() => {
  db.query.mockReset();
  db.findCharacterReportTargetByName.mockReset();
  resetStaffWatchlistCacheForTests();
});

describe('staff watchlist storage', () => {
  it('keys the table by account and cascades with the account', () => {
    expect(STAFF_WATCHLIST_SCHEMA).toContain('account_id INT PRIMARY KEY REFERENCES accounts(id)');
    expect(STAFF_WATCHLIST_SCHEMA).toContain('ON DELETE CASCADE');
    expect(STAFF_WATCHLIST_SCHEMA).toMatch(
      /CREATE INDEX IF NOT EXISTS staff_watchlist_added_by ON staff_watchlist\(added_by_account_id\)\s+WHERE added_by_account_id IS NOT NULL/,
    );
  });

  it('upserts so re-watching refreshes the note and author', async () => {
    db.query.mockResolvedValueOnce(queryResult([]));
    await addStaffWatch({ accountId: 7, characterName: 'Mira', note: 'alt', addedByAccountId: 1 });
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (account_id) DO UPDATE');
    expect(values).toEqual([7, 'Mira', 'alt', 1]);
  });

  it('reports whether a removal deleted a row', async () => {
    db.query.mockResolvedValueOnce(queryResult([], 1));
    expect(await removeStaffWatch(7)).toBe(true);
    db.query.mockResolvedValueOnce(queryResult([], 0));
    expect(await removeStaffWatch(7)).toBe(false);
  });

  it('maps rows, folding an empty note to null', async () => {
    db.query.mockResolvedValueOnce(
      queryResult([
        {
          account_id: '7',
          character_name: 'Mira',
          note: '',
          added_by: 'gm_fury',
          created_at: new Date('2026-10-15T00:00:00Z'),
        },
      ]),
    );
    expect(await staffWatchForAccount(7)).toEqual({
      accountId: 7,
      characterName: 'Mira',
      note: null,
      addedBy: 'gm_fury',
      createdAt: '2026-10-15T00:00:00.000Z',
    });
    db.query.mockResolvedValueOnce(queryResult([]));
    expect(await staffWatchForAccount(8)).toBeNull();
  });

  it('bounds the list and reports the full total', async () => {
    db.query.mockResolvedValueOnce(
      queryResult([
        {
          account_id: 1,
          character_name: 'A',
          note: 'x',
          added_by: null,
          created_at: '2026-10-15T00:00:00Z',
          total: '40',
        },
      ]),
    );
    const { entries, total } = await listStaffWatches();
    expect(db.query.mock.calls[0][1]).toEqual([STAFF_WATCHLIST_LIST_MAX]);
    expect(entries).toHaveLength(1);
    expect(total).toBe(40);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('(SELECT count(*) FROM staff_watchlist) AS total');
    expect(sql).not.toContain('OVER ()');
    expect(sql.indexOf('LIMIT $1')).toBeLessThan(sql.indexOf('LEFT JOIN accounts'));
    expect(await listStaffWatches()).toEqual({ entries, total });
    expect(db.query).toHaveBeenCalledTimes(1);
    resetStaffWatchlistCacheForTests();
    db.query.mockResolvedValueOnce(queryResult([]));
    expect(await listStaffWatches()).toEqual({ entries: [], total: 0 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it.each(['watch', 'unwatch'] as const)('busts the list immediately after %s', async (action) => {
    const row = {
      account_id: 7,
      character_name: 'Mira',
      note: null,
      added_by: null,
      created_at: '2026-10-15T00:00:00Z',
      total: '1',
    };
    db.query.mockResolvedValueOnce(queryResult([row]));
    expect((await listStaffWatches()).total).toBe(1);
    db.query.mockResolvedValueOnce(queryResult([], 1));
    if (action === 'watch') {
      await addStaffWatch({
        accountId: 7,
        characterName: 'Mira',
        note: 'new',
        addedByAccountId: 1,
      });
    } else {
      await removeStaffWatch(7);
    }
    db.query.mockResolvedValueOnce(
      queryResult(action === 'watch' ? [{ ...row, note: 'new' }] : []),
    );
    const fresh = await listStaffWatches();
    expect(fresh.entries).toEqual(
      action === 'watch' ? [expect.objectContaining({ accountId: 7, note: 'new' })] : [],
    );
    expect(db.query).toHaveBeenCalledTimes(3); // initial list, write, post-write list
  });

  it('always rereads the account key on fresh-login checks, independently of list cache', async () => {
    db.query.mockResolvedValueOnce(queryResult([]));
    await listStaffWatches();
    db.query.mockResolvedValueOnce(queryResult([]));
    await expect(staffWatchForAccount(7)).resolves.toBeNull();
    db.query.mockResolvedValueOnce(queryResult([]));
    await expect(staffWatchForAccount(7)).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledTimes(3);
    for (const [sql, values] of db.query.mock.calls.slice(1)) {
      expect(sql).toContain('WHERE w.account_id = $1');
      expect(values).toEqual([7]);
    }
  });

  it('resolves names through the realm-scoped character lookup', async () => {
    db.findCharacterReportTargetByName.mockResolvedValueOnce({
      accountId: 7,
      characterId: 70,
      characterName: 'Mira',
    });
    expect(await pgStaffWatchlist.findCharacter('mira')).toEqual({
      accountId: 7,
      characterName: 'Mira',
    });
    db.findCharacterReportTargetByName.mockResolvedValueOnce(null);
    expect(await pgStaffWatchlist.findCharacter('nobody')).toBeNull();
  });
});
