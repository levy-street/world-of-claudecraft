// The Fire and Fly trial table (server/fire_and_fly_scores_db.ts): the boot DDL, the
// one-statement upsert onto both of a trial's periods (a mission's lifetime row alone)
// with its guard, and the ranked read. The SQL
// is pinned by literal against a recording queryable; the Postgres half runs only
// with TEST_DATABASE_URL, inside a scratch schema rolled back at the end.
import { Pool, type QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIRE_AND_FLY_SCORES_SCHEMA,
  fireAndFlyScoreRows,
  upsertFireAndFlyScore,
} from '../../server/fire_and_fly_scores_db';
import { WORLD_QUEST_SCORES_SCHEMA } from '../../server/world_quest_scores_db';
import { FIRE_AND_FLY_MAX_POINTS } from '../../src/sim/fire_and_fly_personal_records';
import { LEADERBOARD_MAX } from '../../src/sim/leaderboard_page';
import { WORLD_QUEST_MEDAL_RANK } from '../../src/sim/world_quest_scoreboards';

const LIFETIME = 'fire_and_fly_standard_v2_lifetime';
const DAILY = 'fire_and_fly_standard_v2_daily';

function recorder(rowCount = 1, rows: unknown[] = []) {
  const calls: { text: string; values?: unknown[] }[] = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rowCount, rows } as unknown as QueryResult;
    },
  };
}

const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const row = (over: Partial<Parameters<typeof upsertFireAndFlyScore>[1]> = {}) => ({
  realm: 'test',
  board: LIFETIME,
  characterId: 1,
  accountId: 2,
  medal: 'gold' as const,
  metric: 19_400,
  sortKey: 0,
  resetDay: '2026-09-23',
  ...over,
});

describe('the trial table schema', () => {
  it('is additive boot DDL composed with the world quest scores, bounded by its key', () => {
    const ddl = flat(FIRE_AND_FLY_SCORES_SCHEMA);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fire_and_fly_trial_bests');
    expect(ddl).toContain('PRIMARY KEY (realm, board, character_id)');
    expect(ddl).toContain('REFERENCES characters(id) ON DELETE CASCADE');
    expect(ddl).toContain('REFERENCES accounts(id) ON DELETE CASCADE');
    expect(ddl).toContain("CHECK (medal IN ('gold', 'silver', 'bronze'))");
    const { gold, silver, bronze } = WORLD_QUEST_MEDAL_RANK;
    expect(ddl).toContain(
      `CHECK (medal_rank = CASE medal WHEN 'gold' THEN ${gold} WHEN 'silver' THEN ${silver} WHEN 'bronze' THEN ${bronze} END)`,
    );
    expect(ddl).toContain('CHECK (points >= 0)');
    expect(ddl).toContain(
      'ON fire_and_fly_trial_bests (realm, board, reset_day, medal_rank DESC, points DESC, updated_at ASC, character_id ASC)',
    );
    expect(ddl).not.toMatch(/\bDROP\b|\bALTER\b|DELETE FROM|TRUNCATE/);
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain(FIRE_AND_FLY_SCORES_SCHEMA);
  });
});

describe('upsertFireAndFlyScore', () => {
  it('writes the daily and the lifetime row in one statement, ranked by medal then points', async () => {
    const db = recorder();
    expect(await upsertFireAndFlyScore(db, row())).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(flat(db.calls[0].text)).toBe(
      flat(`INSERT INTO fire_and_fly_trial_bests
      (realm, board, character_id, account_id, reset_day, medal, medal_rank, points)
     VALUES ($1,$2,$4,$5,$6,$7,$8,$9), ($1,$3,$4,$5,'',$7,$8,$9)
     ON CONFLICT (realm, board, character_id) DO UPDATE SET
       reset_day = EXCLUDED.reset_day, medal = EXCLUDED.medal,
       medal_rank = EXCLUDED.medal_rank, points = EXCLUDED.points, updated_at = now()
     WHERE EXCLUDED.reset_day > fire_and_fly_trial_bests.reset_day
        OR (EXCLUDED.reset_day = fire_and_fly_trial_bests.reset_day
            AND (EXCLUDED.medal_rank, EXCLUDED.points)
              > (fire_and_fly_trial_bests.medal_rank, fire_and_fly_trial_bests.points))`),
    );
    expect(db.calls[0].values).toEqual([
      'test',
      DAILY,
      LIFETIME,
      1,
      2,
      '2026-09-23',
      'gold',
      3,
      19_400,
    ]);
    const bronze = recorder(0);
    expect(await upsertFireAndFlyScore(bronze, row({ medal: 'bronze' }))).toBe(false);
    expect(bronze.calls[0].values?.[7]).toBe(1);
  });

  it("writes a mission's one lifetime row, the same better-run rule", async () => {
    const db = recorder();
    const board = 'fire_and_fly_pack_v1_lifetime';
    expect(await upsertFireAndFlyScore(db, row({ board }))).toBe(true);
    expect(flat(db.calls[0].text)).toBe(
      flat(`INSERT INTO fire_and_fly_trial_bests
      (realm, board, character_id, account_id, reset_day, medal, medal_rank, points)
     VALUES ($1,$2,$3,$4,'',$5,$6,$7)
     ON CONFLICT (realm, board, character_id) DO UPDATE SET
       reset_day = EXCLUDED.reset_day, medal = EXCLUDED.medal,
       medal_rank = EXCLUDED.medal_rank, points = EXCLUDED.points, updated_at = now()
     WHERE EXCLUDED.reset_day > fire_and_fly_trial_bests.reset_day
        OR (EXCLUDED.reset_day = fire_and_fly_trial_bests.reset_day
            AND (EXCLUDED.medal_rank, EXCLUDED.points)
              > (fire_and_fly_trial_bests.medal_rank, fire_and_fly_trial_bests.points))`),
    );
    expect(db.calls[0].values).toEqual(['test', board, 1, 2, 'gold', 3, 19_400]);
  });

  it.each([
    ['the daily board', { board: DAILY }],
    ['an unknown board', { board: 'glider_downs_v2_lifetime' }],
    ['a malformed day', { resetDay: '2026-9-23' }],
    ['no medal', { medal: null }],
    ['fractional points', { metric: 1.5 }],
    ['negative points', { metric: -1 }],
    ['points past the bound', { metric: FIRE_AND_FLY_MAX_POINTS + 1 }],
  ] as const)('refuses %s without a query', async (_label, over) => {
    const db = recorder();
    expect(await upsertFireAndFlyScore(db, row(over as never))).toBe(false);
    expect(db.calls).toEqual([]);
  });
});

describe('fireAndFlyScoreRows', () => {
  it('reads one trial board best medal first, then most points, earlier holder first', async () => {
    const db = recorder(2, [
      { character_id: '4', name: 'Ari', medal: 'gold', points: '19400' },
      { character_id: '5', name: 'Bo', medal: 'silver', points: '22000' },
    ]);
    const rows = await fireAndFlyScoreRows(db, 'test', DAILY, '2026-09-23', 'NOT a.banned');
    expect(rows).toEqual([
      { characterId: 4, name: 'Ari', medal: 'gold', metric: 19_400 },
      { characterId: 5, name: 'Bo', medal: 'silver', metric: 22_000 },
    ]);
    expect(flat(db.calls[0].text)).toBe(
      flat(`SELECT s.character_id, c.name, s.medal, s.points
     FROM fire_and_fly_trial_bests s JOIN characters c ON c.id = s.character_id
     JOIN accounts a ON a.id = s.account_id
     WHERE s.realm = $1 AND s.board = $2 AND s.reset_day = $3 AND NOT a.banned
     ORDER BY s.medal_rank DESC, s.points DESC, s.updated_at ASC, s.character_id ASC
     LIMIT $4`),
    );
    expect(db.calls[0].values).toEqual(['test', DAILY, '2026-09-23', LEADERBOARD_MAX]);
    await fireAndFlyScoreRows(db, 'test', LIFETIME, '2026-09-23', 'true');
    expect(db.calls[1].values?.[2]).toBe('');
    expect(await fireAndFlyScoreRows(db, 'test', 'forge', '2026-09-23', 'true')).toEqual([]);
    expect(db.calls).toHaveLength(2);
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable Fire and Fly trial records', () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const write = (medal: 'gold' | 'silver' | 'bronze', metric: number, resetDay: string, id = 1) =>
    upsertFireAndFlyScore(pool, row({ characterId: id, accountId: id, medal, metric, resetDay }));
  const read = (board: string, day = '2026-09-23') =>
    fireAndFlyScoreRows(pool, 'test', board, day, 'NOT a.banned');
  const count = async () =>
    (await pool.query('SELECT count(*) AS n FROM fire_and_fly_trial_bests')).rows[0].n;

  beforeAll(async () => {
    await pool.query('BEGIN');
    await pool.query('CREATE SCHEMA fire_and_fly_bests_test');
    await pool.query('SET LOCAL search_path TO fire_and_fly_bests_test');
    await pool.query(
      'CREATE TABLE accounts (id INT PRIMARY KEY, banned BOOLEAN NOT NULL DEFAULT false)',
    );
    await pool.query('CREATE TABLE characters (id INT PRIMARY KEY, name TEXT NOT NULL)');
    await pool.query('INSERT INTO accounts(id) VALUES (1), (2), (3)');
    await pool.query("INSERT INTO characters VALUES (1, 'Gunner'), (2, 'Rival'), (3, 'Third')");
    await pool.query(FIRE_AND_FLY_SCORES_SCHEMA);
  });
  afterAll(async () => {
    await pool.query('ROLLBACK');
    await pool.end();
  });

  it('keeps one best per period, replaces the daily row with a newer day, never an older one', async () => {
    expect(await write('silver', 20_000, '2026-09-23')).toBe(true);
    expect(await write('bronze', 30_000, '2026-09-23')).toBe(false);
    expect(await write('silver', 20_000, '2026-09-23')).toBe(false);
    expect(await write('gold', 19_000, '2026-09-23')).toBe(true);
    expect((await read(LIFETIME))[0]).toMatchObject({ medal: 'gold', metric: 19_000 });
    expect((await read(DAILY))[0]).toMatchObject({ medal: 'gold', metric: 19_000 });
    expect(await read(DAILY, '2026-09-24')).toEqual([]);
    expect(await write('bronze', 5_000, '2026-09-24')).toBe(true);
    expect((await read(DAILY, '2026-09-24'))[0]).toMatchObject({ medal: 'bronze', metric: 5_000 });
    expect((await read(LIFETIME))[0]).toMatchObject({ medal: 'gold', metric: 19_000 });
    await write('gold', 25_000, '2026-09-23');
    expect((await read(DAILY, '2026-09-24'))[0].metric).toBe(5_000);
    expect((await read(LIFETIME))[0].metric).toBe(25_000);
    expect(await count()).toBe('2');
    await pool.query(FIRE_AND_FLY_SCORES_SCHEMA);
    expect(await count()).toBe('2');
  });

  it('refuses a medal rank that disagrees with its medal', async () => {
    // A failed pool.query destroys the pooled client and with it the open transaction.
    const client = await pool.connect();
    try {
      await client.query('SAVEPOINT mismatched_rank');
      await expect(
        client.query(
          `INSERT INTO fire_and_fly_trial_bests
            (realm, board, character_id, account_id, reset_day, medal, medal_rank, points)
           VALUES ('test', 'rank_probe', 1, 1, '', 'bronze', 3, 10)`,
        ),
      ).rejects.toThrow(/check constraint/);
      await client.query('ROLLBACK TO SAVEPOINT mismatched_rank');
    } finally {
      client.release();
    }
  });

  it('ranks medal first, then points, and drops moderated accounts', async () => {
    await write('silver', 40_000, '2026-09-24', 2);
    await write('gold', 1_000, '2026-09-24', 3);
    expect((await read(LIFETIME)).map((r) => r.name)).toEqual(['Gunner', 'Third', 'Rival']);
    await pool.query('UPDATE accounts SET banned = true WHERE id = 3');
    expect((await read(LIFETIME)).map((r) => r.name)).toEqual(['Gunner', 'Rival']);
    expect(await count()).toBe('6');
  });

  it('serves the read from its ordered index and cascades deleted identities', async () => {
    const indexes = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'fire_and_fly_bests_test'",
    );
    expect(indexes.rows.map((r) => r.indexdef).join('\n')).toContain(
      'realm, board, reset_day, medal_rank DESC, points DESC, updated_at, character_id',
    );
    await pool.query('DELETE FROM characters WHERE id = 1');
    await pool.query('DELETE FROM accounts WHERE id IN (2, 3)');
    expect(await count()).toBe('0');
  });
});
