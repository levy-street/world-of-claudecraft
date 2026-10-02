// The Gunner's Mastery table (server/fire_and_fly_mastery_db.ts): the boot DDL, the
// only-rising upsert of a character's one row, and the ranked read. The SQL is pinned
// by literal against a recording queryable; the Postgres half runs only with
// TEST_DATABASE_URL, inside a scratch schema rolled back at the end.
import { Pool, type QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIRE_AND_FLY_MASTERY_SCHEMA,
  fireAndFlyMasteryRows,
  upsertFireAndFlyMastery,
} from '../../server/fire_and_fly_mastery_db';
import { WORLD_QUEST_SCORES_SCHEMA } from '../../server/world_quest_scores_db';
import {
  FIRE_AND_FLY_MASTERY_MAX_POINTS,
  FIRE_AND_FLY_MASTERY_MAX_STARS,
} from '../../src/sim/fire_and_fly_personal_records';
import { FIRE_AND_FLY_MASTERY_BOARD_ID } from '../../src/sim/fire_and_fly_scoreboards';
import { LEADERBOARD_MAX } from '../../src/sim/leaderboard_page';

const BOARD = FIRE_AND_FLY_MASTERY_BOARD_ID;

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

const row = (over: Partial<Parameters<typeof upsertFireAndFlyMastery>[1]> = {}) => ({
  realm: 'test',
  board: BOARD,
  characterId: 1,
  accountId: 2,
  stars: 7,
  points: 90_000,
  ...over,
});

describe('the Mastery table schema', () => {
  it('is additive boot DDL composed with the world quest scores, one row per character', () => {
    const ddl = flat(FIRE_AND_FLY_MASTERY_SCHEMA);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS fire_and_fly_mastery');
    expect(ddl).toContain('PRIMARY KEY (realm, board, character_id)');
    expect(ddl).toContain('REFERENCES characters(id) ON DELETE CASCADE');
    expect(ddl).toContain('REFERENCES accounts(id) ON DELETE CASCADE');
    expect(ddl).toContain('stars SMALLINT NOT NULL CHECK (stars >= 0)');
    expect(ddl).toContain('points INT NOT NULL CHECK (points >= 0)');
    expect(FIRE_AND_FLY_MASTERY_MAX_POINTS).toBeLessThanOrEqual(2_147_483_647);
    expect(ddl).toContain(
      'ON fire_and_fly_mastery (realm, board, stars DESC, points DESC, updated_at ASC, character_id ASC)',
    );
    expect(ddl).toContain('ON fire_and_fly_mastery (character_id)');
    expect(ddl).toContain('ON fire_and_fly_mastery (account_id)');
    expect(ddl).not.toMatch(/\bDROP\b|\bALTER\b|DELETE FROM|TRUNCATE/);
    expect(WORLD_QUEST_SCORES_SCHEMA).toContain(FIRE_AND_FLY_MASTERY_SCHEMA);
  });
});

describe('upsertFireAndFlyMastery', () => {
  it('pins the only-rising upsert by literal and reports a held row as unchanged', async () => {
    const db = recorder();
    expect(await upsertFireAndFlyMastery(db, row())).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(flat(db.calls[0].text)).toBe(
      flat(`INSERT INTO fire_and_fly_mastery (realm, board, character_id, account_id, stars, points)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (realm, board, character_id) DO UPDATE SET
       stars = EXCLUDED.stars, points = EXCLUDED.points, updated_at = now()
     WHERE (EXCLUDED.stars, EXCLUDED.points)
       > (fire_and_fly_mastery.stars, fire_and_fly_mastery.points)`),
    );
    expect(db.calls[0].values).toEqual(['test', BOARD, 1, 2, 7, 90_000]);
    const held = recorder(0);
    expect(await upsertFireAndFlyMastery(held, row({ stars: 6 }))).toBe(false);
  });

  it.each([
    ['another board', { board: 'fire_and_fly_pack_v1_lifetime' }],
    ['an older Mastery version', { board: 'fire_and_fly_mastery_v0_lifetime' }],
    ['fractional stars', { stars: 2.5 }],
    ['negative stars', { stars: -1 }],
    ['stars past a gold on every mission', { stars: FIRE_AND_FLY_MASTERY_MAX_STARS + 1 }],
    ['fractional points', { points: 1.5 }],
    ['negative points', { points: -1 }],
    ['points past the bound', { points: FIRE_AND_FLY_MASTERY_MAX_POINTS + 1 }],
  ] as const)('refuses %s without a query', async (_label, over) => {
    const db = recorder();
    expect(await upsertFireAndFlyMastery(db, row(over as never))).toBe(false);
    expect(db.calls).toEqual([]);
  });
});

describe('fireAndFlyMasteryRows', () => {
  it('reads the board most stars first, then most points, earlier holder first', async () => {
    const db = recorder(2, [
      { character_id: '4', name: 'Ari', stars: 12, points: '150000' },
      { character_id: '5', name: 'Bo', stars: 11, points: '210000' },
    ]);
    const rows = await fireAndFlyMasteryRows(db, 'test', BOARD, '2026-09-23', 'NOT a.banned');
    expect(rows).toEqual([
      { characterId: 4, name: 'Ari', medal: null, metric: 150_000, stars: 12 },
      { characterId: 5, name: 'Bo', medal: null, metric: 210_000, stars: 11 },
    ]);
    expect(flat(db.calls[0].text)).toBe(
      flat(`SELECT s.character_id, c.name, s.stars, s.points
     FROM fire_and_fly_mastery s JOIN characters c ON c.id = s.character_id
     JOIN accounts a ON a.id = s.account_id
     WHERE s.realm = $1 AND s.board = $2 AND NOT a.banned
     ORDER BY s.stars DESC, s.points DESC, s.updated_at ASC, s.character_id ASC
     LIMIT $3`),
    );
    expect(db.calls[0].values).toEqual(['test', BOARD, LEADERBOARD_MAX]);
    expect(
      await fireAndFlyMasteryRows(db, 'test', 'fire_and_fly_pack_v1_lifetime', '', 'true'),
    ).toEqual([]);
    expect(db.calls).toHaveLength(1);
  });
});

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable Gunner Mastery rows', () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const write = (stars: number, points: number, id = 1) =>
    upsertFireAndFlyMastery(pool, row({ characterId: id, accountId: id, stars, points }));
  const read = () => fireAndFlyMasteryRows(pool, 'test', BOARD, '', 'NOT a.banned');
  const count = async () =>
    (await pool.query('SELECT count(*) AS n FROM fire_and_fly_mastery')).rows[0].n;

  beforeAll(async () => {
    await pool.query('BEGIN');
    await pool.query('CREATE SCHEMA fire_and_fly_mastery_test');
    await pool.query('SET LOCAL search_path TO fire_and_fly_mastery_test');
    await pool.query(
      'CREATE TABLE accounts (id INT PRIMARY KEY, banned BOOLEAN NOT NULL DEFAULT false)',
    );
    await pool.query('CREATE TABLE characters (id INT PRIMARY KEY, name TEXT NOT NULL)');
    await pool.query('INSERT INTO accounts(id) VALUES (1), (2), (3)');
    await pool.query("INSERT INTO characters VALUES (1, 'Gunner'), (2, 'Rival'), (3, 'Third')");
    await pool.query(FIRE_AND_FLY_MASTERY_SCHEMA);
  });
  afterAll(async () => {
    await pool.query('ROLLBACK');
    await pool.end();
  });

  it('only ever rises: a lower or equal row never replaces a higher one', async () => {
    expect(await write(6, 50_000)).toBe(true);
    expect(await write(5, 900_000)).toBe(false);
    expect(await write(6, 50_000)).toBe(false);
    expect(await write(6, 49_999)).toBe(false);
    expect((await read())[0]).toMatchObject({ stars: 6, metric: 50_000 });
    expect(await write(6, 50_001)).toBe(true);
    expect(await write(7, 10)).toBe(true);
    expect((await read())[0]).toMatchObject({ stars: 7, metric: 10 });
    expect(await count()).toBe('1');
    await pool.query(FIRE_AND_FLY_MASTERY_SCHEMA);
    expect(await count()).toBe('1');
  });

  it('ranks stars first, then points, and drops moderated accounts', async () => {
    await write(7, 40_000, 2);
    await write(9, 1, 3);
    expect((await read()).map((r) => [r.name, r.stars])).toEqual([
      ['Third', 9],
      ['Rival', 7],
      ['Gunner', 7],
    ]);
    await pool.query('UPDATE accounts SET banned = true WHERE id = 3');
    expect((await read()).map((r) => r.name)).toEqual(['Rival', 'Gunner']);
  });

  it('cascades deleted identities', async () => {
    await pool.query('DELETE FROM characters WHERE id = 1');
    await pool.query('DELETE FROM accounts WHERE id IN (2, 3)');
    expect(await count()).toBe('0');
  });
});
