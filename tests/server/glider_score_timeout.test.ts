import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { GLIDER_SCORES_SCHEMA, upsertGliderScore } from '../../server/glider_scores_db';

const url = process.env.TEST_DATABASE_URL;
it.skipIf(!url)(
  'releases a contended glider write at the production timeout and reuses the pool',
  async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    const db = await import('../../server/db');
    const setup = new Pool({ connectionString: url, max: 1 });
    const lock = await setup.connect();
    try {
      await lock.query('CREATE SCHEMA glider_timeout_test');
      await lock.query('SET search_path TO glider_timeout_test');
      await lock.query('CREATE TABLE accounts (id INT PRIMARY KEY)');
      await lock.query('CREATE TABLE characters (id INT PRIMARY KEY)');
      await lock.query('INSERT INTO accounts VALUES (1)');
      await lock.query('INSERT INTO characters VALUES (1)');
      await lock.query(GLIDER_SCORES_SCHEMA);
      const row = {
        realm: 'test',
        board: 'glider_downs_v2_lifetime',
        characterId: 1,
        accountId: 1,
        resetDay: '2026-09-23',
        medal: 'gold' as const,
        metric: 60,
        sortKey: 0,
      };
      await upsertGliderScore(lock, row);
      await lock.query('BEGIN');
      await lock.query(
        "SELECT * FROM glider_course_bests WHERE board = 'glider_downs_v2_daily' FOR UPDATE",
      );
      const start = Date.now();
      await expect(
        db.runWithStatementTimeout(2000, async (query) => {
          await query('SET LOCAL search_path TO glider_timeout_test');
          return upsertGliderScore({ query }, { ...row, metric: 50 });
        }),
      ).rejects.toMatchObject({ code: '57014' });
      expect(Date.now() - start).toBeGreaterThanOrEqual(1900);
      expect(Date.now() - start).toBeLessThan(8000);
      await lock.query('ROLLBACK');
      expect(
        await db.runWithStatementTimeout(2000, async (query) => {
          await query('SET LOCAL search_path TO glider_timeout_test');
          return upsertGliderScore({ query }, { ...row, metric: 50 });
        }),
      ).toBe(true);
      expect(db.pool.waitingCount).toBe(0);
    } finally {
      await lock.query('ROLLBACK');
      await lock.query('DROP SCHEMA IF EXISTS glider_timeout_test CASCADE');
      lock.release();
      await setup.end();
      await db.pool.end();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  },
  30000,
);
