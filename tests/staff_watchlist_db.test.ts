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
});

describe('staff watchlist storage', () => {
  it('keys the table by account and cascades with the account', () => {
    expect(STAFF_WATCHLIST_SCHEMA).toContain('account_id INT PRIMARY KEY REFERENCES accounts(id)');
    expect(STAFF_WATCHLIST_SCHEMA).toContain('ON DELETE CASCADE');
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
    db.query.mockResolvedValueOnce(queryResult([]));
    expect(await listStaffWatches()).toEqual({ entries: [], total: 0 });
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
