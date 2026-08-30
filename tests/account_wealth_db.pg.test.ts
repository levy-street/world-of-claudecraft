// Opt-in PostgreSQL planner proof for the admin large-gold reader and its
// shipped broad-index predecessor. This suite boots a disposable database
// through the real ensureSchema plus runConcurrentIndexMigrations path. The
// mocked SQL-shape suite proves the literal, parameter list, and append-only
// registry order; only PostgreSQL can prove that a fresh boot creates both
// indexes, a generic prepared plan selects the partial reader, and a full FK
// child probe selects the broad index. Set TEST_DATABASE_URL to run it.
// Without that variable this file skips cleanly.

import type { Pool as PgPool } from 'pg';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BANK_LEDGER_ACCOUNT_FK_INDEX_SQL } from '../server/bank_ledger_indexes';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_account_wealth_planner_verify';

function verifyUrl(admin: string): string {
  const url = new URL(admin);
  url.pathname = `/${VERIFY_DB}`;
  return url.toString();
}

// server/db.ts reads DATABASE_URL at module load. Nothing above imports it, so
// this assignment points the later dynamic import at the disposable database.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('account wealth large-movement planner (real PostgreSQL)', () => {
  let admin: PgPool;
  let pool: PgPool;
  let db: typeof import('../server/db');
  let accountId: number;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    const ownDatabase = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    expect(ownDatabase).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    await db.ensureSchema();
    // This is the production fresh-boot path under review. Directly executing
    // the two index constants would not prove that both registry entries are
    // reachable in their shipped order.
    await db.runConcurrentIndexMigrations();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 1 });
    const accounts = await pool.query(
      `INSERT INTO accounts (username, password_hash)
       SELECT 'account_wealth_planner_' || g, 'x'
         FROM generate_series(1, 100) AS g
       RETURNING id`,
    );
    accountId = Math.min(...accounts.rows.map((row: { id: number }) => Number(row.id)));
    await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       SELECT id, 'AccountWealthPlanner' || id, 'warrior', 'planner-realm', 1, '{}'::jsonb
         FROM accounts
        WHERE username LIKE 'account_wealth_planner_%'`,
    );
    await pool.query(
      `WITH targets AS (
         SELECT a.id AS account_id,
                c.id AS character_id,
                row_number() OVER (ORDER BY a.id)::int AS rn
           FROM accounts a
           JOIN characters c ON c.account_id = a.id
          WHERE a.username LIKE 'account_wealth_planner_%'
       )
       INSERT INTO bank_ledger
         (realm, account_id, character_id, op, container, copper_delta,
          purchased_slots_after)
       SELECT 'planner-realm',
              targets.account_id,
              targets.character_id,
              'deposit_gold',
              'personal',
              CASE WHEN g % 101 = 0 THEN 100000 ELSE 1 END,
              24
         FROM generate_series(1, 100000) AS g
         JOIN targets ON targets.rn = ((g - 1) % 100) + 1`,
    );
    await pool.query('ANALYZE bank_ledger');
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool.end().catch(() => {});
    if (admin) {
      await admin
        .query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [VERIFY_DB],
        )
        .catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`).catch(() => {});
      await admin.end().catch(() => {});
    }
  }, 30_000);

  it('uses the partial account index under a forced generic prepared plan', async () => {
    await pool.query(`SET plan_cache_mode = force_generic_plan`);
    await pool.query(`PREPARE account_large_movements(int, int) AS
      SELECT l.id, l.character_id, c.name, l.op, l.container,
             l.copper_delta, l.created_at
        FROM bank_ledger l
        LEFT JOIN characters c ON c.id = l.character_id
       WHERE l.account_id = $1 AND abs(copper_delta) >= 100000
       ORDER BY l.id DESC
       LIMIT $2`);
    try {
      const explained = await pool.query(
        `EXPLAIN (COSTS OFF) EXECUTE account_large_movements(${accountId}, 25)`,
      );
      const plan = explained.rows
        .map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN'])
        .join('\n');
      expect(plan).toContain('bank_ledger_account_large_recent');
    } finally {
      await pool.query('DEALLOCATE account_large_movements');
    }
  });

  it('keeps the shipped broad index valid and usable for full FK child lookups', async () => {
    const index = await pool.query(
      `SELECT i.indisvalid,
              i.indpred IS NULL AS full_index,
              pg_get_indexdef(i.indexrelid) AS definition
         FROM pg_index i
        WHERE i.indexrelid = to_regclass('bank_ledger_account_recent')`,
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]).toMatchObject({ indisvalid: true, full_index: true });
    expect(index.rows[0].definition).toContain('bank_ledger_account_recent');
    expect(index.rows[0].definition).toContain('(account_id, id DESC)');

    // This is the child-row probe shape PostgreSQL's ON DELETE CASCADE trigger
    // needs. The partial large-movement index cannot answer it because the
    // probe has no copper predicate, so a fresh database must select the broad
    // predecessor rather than fall back to a full table scan.
    await pool.query('SET plan_cache_mode = force_generic_plan');
    await pool.query(`PREPARE account_fk_children(int) AS
      SELECT 1
        FROM ONLY bank_ledger AS child
       WHERE child.account_id = $1
       FOR KEY SHARE OF child`);
    try {
      const explained = await pool.query(
        `EXPLAIN (COSTS OFF) EXECUTE account_fk_children(${accountId})`,
      );
      const plan = explained.rows
        .map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN'])
        .join('\n');
      expect(plan).toContain('bank_ledger_account_recent');
      expect(plan).not.toContain('bank_ledger_account_large_recent');
    } finally {
      await pool.query('DEALLOCATE account_fk_children');
    }
  });

  it('defines the phase-two compact index as another full FK lookup path', async () => {
    // Phase-two DDL executes independently before its catalog shape is pinned.
    await pool.query(BANK_LEDGER_ACCOUNT_FK_INDEX_SQL);
    const index = await pool.query(
      `SELECT i.indisvalid, i.indpred IS NULL AS full_index
         FROM pg_index i
        WHERE i.indexrelid = to_regclass('bank_ledger_account_fk')`,
    );
    expect(index.rows).toEqual([{ indisvalid: true, full_index: true }]);
  });
});
