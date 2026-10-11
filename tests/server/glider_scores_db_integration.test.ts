import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GLIDER_SCORES_SCHEMA,
  gliderScoreRows,
  upsertGliderScore,
} from '../../server/glider_scores_db';
import { gliderScoreboardId } from '../../src/sim/glider_scoreboards';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable glider course records', () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const course = 'galecrest_windrider_slalom';
  const lifetime = gliderScoreboardId(course, 'lifetime')!;
  const daily = gliderScoreboardId(course, 'daily')!;
  const write = (metric: number, resetDay: string, characterId = 1, board = lifetime) =>
    upsertGliderScore(pool, {
      realm: 'test',
      board,
      characterId,
      accountId: characterId,
      metric,
      resetDay,
      medal: 'gold',
      sortKey: 0,
    });
  const read = (board: string, day = '2026-09-23') =>
    gliderScoreRows(pool, 'test', board, day, 'NOT a.banned');

  beforeAll(async () => {
    await pool.query('BEGIN');
    await pool.query('CREATE SCHEMA glider_bests_test');
    await pool.query('SET LOCAL search_path TO glider_bests_test');
    await pool.query(
      'CREATE TABLE accounts (id INT PRIMARY KEY, banned BOOLEAN NOT NULL DEFAULT false)',
    );
    await pool.query('CREATE TABLE characters (id INT PRIMARY KEY, name TEXT NOT NULL)');
    await pool.query('INSERT INTO accounts(id) VALUES (1), (2)');
    await pool.query("INSERT INTO characters VALUES (1, 'Pilot'), (2, 'Rival')");
    await pool.query(GLIDER_SCORES_SCHEMA);
  });
  afterAll(async () => {
    await pool.query('ROLLBACK');
    await pool.end();
  });

  it('stores one best per period, rolls daily records forward, and rejects delayed older days', async () => {
    expect(await write(30, '2026-09-23')).toBe(true);
    expect(await write(35, '2026-09-23')).toBe(false);
    expect(await write(30, '2026-09-23')).toBe(false);
    expect(await write(25, '2026-09-23')).toBe(true);
    expect((await read(lifetime))[0].metric).toBe(25);
    expect((await read(daily))[0].metric).toBe(25);
    expect(await read(daily, '2026-09-24')).toEqual([]);
    expect(await write(40, '2026-09-24')).toBe(true);
    expect((await read(daily, '2026-09-24'))[0].metric).toBe(40);
    expect((await read(lifetime))[0].metric).toBe(25);
    await write(20, '2026-09-23');
    expect((await read(daily, '2026-09-24'))[0].metric).toBe(40);
    expect((await read(lifetime))[0].metric).toBe(20);
    expect((await pool.query('SELECT count(*) AS n FROM glider_course_bests')).rows[0].n).toBe('2');
  });

  it('separates courses and realms, ranks fastest first, and excludes moderated accounts', async () => {
    await write(18, '2026-09-24', 2);
    await write(10, '2026-09-24', 1, gliderScoreboardId('galecrest_practice_valleys', 'lifetime')!);
    expect((await read(lifetime)).map((r) => r.name)).toEqual(['Rival', 'Pilot']);
    expect(await gliderScoreRows(pool, 'other', lifetime, '', 'true')).toEqual([]);
    await pool.query('UPDATE accounts SET banned = true WHERE id = 2');
    expect((await read(lifetime)).map((r) => r.name)).toEqual(['Pilot']);
    await pool.query("UPDATE glider_course_bests SET updated_at = '2000-01-01'");
    expect((await read(lifetime))[0].metric).toBe(20);
  });

  it('uses bounded ordered indexes and cascades deleted identities', async () => {
    const indexes = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'glider_bests_test'",
    );
    expect(indexes.rows.map((r) => r.indexdef).join('\n')).toContain(
      'realm, board, reset_day, metric, updated_at, character_id',
    );
    await pool.query('DELETE FROM characters WHERE id = 1');
    expect(await read(lifetime)).toEqual([]);
    await pool.query('DELETE FROM accounts WHERE id = 2');
    expect((await pool.query('SELECT count(*) AS n FROM glider_course_bests')).rows[0].n).toBe('0');
  });
});
