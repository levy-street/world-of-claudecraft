import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the real modules load and every query goes through a spy (the
// bank_ledger_db idiom). This pins the actual SQL the deeds boundary issues,
// not a mock of it.
const dbMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    // deedRarityCounts runs inside runWithStatementTimeout (server/db.ts): a
    // dedicated pooled client issues BEGIN, SET LOCAL statement_timeout, the two
    // real reads, then COMMIT. Model connect() as a client that answers the
    // control statements itself and forwards the real queries back through the
    // pool's own query, so the dbMock spy records exactly the two reads in order.
    const poolObj = {
      query: dbMock.query,
      connect: async () => ({
        query: (text: string, values?: unknown[]) =>
          text === 'BEGIN' ||
          text === 'COMMIT' ||
          text === 'ROLLBACK' ||
          text.startsWith('SET LOCAL')
            ? Promise.resolve({ rows: [] })
            : poolObj.query(text, values),
        release() {},
      }),
    };
    return poolObj;
  },
}));

import { ELIGIBLE_ACCOUNT_SQL } from '../server/db';
import {
  DEED_RARITY_MIN_LEVEL,
  deedRarityCounts,
  getDeedBroadcasts,
  insertCharacterDeed,
  insertCharacterDeeds,
  recentDeedsForCharacter,
  setDeedBroadcasts,
} from '../server/deeds_db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('insertCharacterDeed', () => {
  it('issues one parameterized conflict-swallowing INSERT with explicit realm', async () => {
    await insertCharacterDeed({
      realm: REALM,
      characterId: 42,
      accountId: 7,
      deedId: 'prog_veteran',
    });
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO character_deeds');
    expect(sql).toContain('(realm, character_id, account_id, deed_id)');
    // The idempotence backbone: a replayed (character, deed) pair is a no-op.
    expect(sql).toContain('ON CONFLICT (character_id, deed_id) DO NOTHING');
    // Four bind params, no interpolation.
    expect(sql).toContain('$4');
    expect(sql).not.toContain('$5');
    expect(params).toEqual([REALM, 42, 7, 'prog_veteran']);
  });
});

describe('insertCharacterDeeds (batched login reconcile)', () => {
  it('inserts the whole set in ONE conflict-swallowing statement with explicit realm', async () => {
    await insertCharacterDeeds({ realm: REALM, characterId: 42, accountId: 7 }, [
      'prog_veteran',
      'prog_first_steps',
    ]);
    expect(dbMock.query).toHaveBeenCalledTimes(1);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO character_deeds (realm, character_id, account_id, deed_id)');
    // One statement over the whole set: the ids ride a single text[] bind
    // (never interpolated), fanned to rows by unnest.
    expect(sql).toContain('unnest($4::text[])');
    // The same idempotence backbone as insertCharacterDeed, so a row that
    // already landed collapses to a no-op and only a drifted row is re-created.
    expect(sql).toContain('ON CONFLICT (character_id, deed_id) DO NOTHING');
    // Four binds, no fifth (realm/character/account scalars plus the id array).
    expect(sql).toContain('$4');
    expect(sql).not.toContain('$5');
    expect(params).toEqual([REALM, 42, 7, ['prog_veteran', 'prog_first_steps']]);
  });

  it('an empty set is a no-op that never issues SQL', async () => {
    await insertCharacterDeeds({ realm: REALM, characterId: 42, accountId: 7 }, []);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('deedRarityCounts', () => {
  it('groups earns by deed id and counts the eligible denominator with the level floor', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          { deed_id: 'prog_veteran', earned: 30 },
          { deed_id: 'cmb_thunzharr', earned: 2 },
        ],
      } as never)
      .mockResolvedValueOnce({ rows: [{ eligible: 120 }] } as never);
    const result = await deedRarityCounts();
    expect(result).toEqual({
      totalEligible: 120,
      earned: { prog_veteran: 30, cmb_thunzharr: 2 },
    });
    // Numerator and denominator must draw from the SAME eligible population on
    // BOTH axes. Without the level floor, a sub-floor earner pushes a deed's
    // count past totalEligible and the card renders over 100 percent; without
    // the accounts join + ELIGIBLE_ACCOUNT_SQL (the board-read contract), a
    // banned or suspended account feeds one arm but not the other and desyncs
    // them the same way. So both arms embed the fragment VERBATIM.
    const [countsSql, countsParams] = dbMock.query.mock.calls[0];
    expect(countsSql).toContain('FROM character_deeds cd');
    expect(countsSql).toContain('JOIN characters c ON c.id = cd.character_id');
    expect(countsSql).toContain('JOIN accounts a ON a.id = cd.account_id');
    expect(countsSql).toContain('WHERE c.level >= $1 AND c.state IS NOT NULL');
    expect(countsSql).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(countsSql).toContain('GROUP BY cd.deed_id');
    expect(countsParams).toEqual([DEED_RARITY_MIN_LEVEL]);
    const [eligibleSql, eligibleParams] = dbMock.query.mock.calls[1];
    expect(eligibleSql).toContain('FROM characters c');
    expect(eligibleSql).toContain('JOIN accounts a ON a.id = c.account_id');
    expect(eligibleSql).toContain('WHERE c.level >= $1 AND c.state IS NOT NULL');
    expect(eligibleSql).toContain(ELIGIBLE_ACCOUNT_SQL);
    expect(eligibleParams).toEqual([DEED_RARITY_MIN_LEVEL]);
    expect(DEED_RARITY_MIN_LEVEL).toBe(5);
  });

  it('an empty table reads as a zero aggregate, never undefined', async () => {
    expect(await deedRarityCounts()).toEqual({ totalEligible: 0, earned: {} });
  });
});

describe('recentDeedsForCharacter', () => {
  it('reads newest-first with the id tiebreak and a bound LIMIT', async () => {
    const earned = new Date('2026-07-08T10:00:00.000Z');
    dbMock.query.mockResolvedValueOnce({
      rows: [{ deed_id: 'prog_veteran', earned_at: earned }],
    } as never);
    const rows = await recentDeedsForCharacter(42, 5);
    expect(rows).toEqual([{ deedId: 'prog_veteran', earnedAt: '2026-07-08T10:00:00.000Z' }]);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('WHERE character_id = $1');
    expect(sql).toContain('ORDER BY earned_at DESC, id DESC');
    expect(sql).toContain('LIMIT $2');
    expect(params).toEqual([42, 5]);
  });

  it('a non-Date earned_at (driver drift) still serializes as a string', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [{ deed_id: 'prog_veteran', earned_at: '2026-07-08 10:00:00+00' }],
    } as never);
    const rows = await recentDeedsForCharacter(42, 5);
    expect(rows).toEqual([{ deedId: 'prog_veteran', earnedAt: '2026-07-08 10:00:00+00' }]);
  });
});

describe('deed_broadcasts flag', () => {
  it('reads the flag by account id and defaults a missing row to TRUE', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ deed_broadcasts: false }] } as never);
    expect(await getDeedBroadcasts(7)).toBe(false);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('SELECT deed_broadcasts FROM accounts WHERE id = $1');
    expect(params).toEqual([7]);
    // Missing account: the column default (TRUE) is mirrored.
    dbMock.query.mockResolvedValueOnce({ rows: [] } as never);
    expect(await getDeedBroadcasts(999)).toBe(true);
  });

  it('writes the flag with a parameterized UPDATE', async () => {
    await setDeedBroadcasts(7, false);
    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('UPDATE accounts SET deed_broadcasts = $2 WHERE id = $1');
    expect(params).toEqual([7, false]);
  });
});
