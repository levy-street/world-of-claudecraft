// Real-Postgres pins for the parse census loader (server/parse/census_db.ts).
//
// Plan class: the per-character session lateral must be an account-keyed
// index probe. play_sessions has no character_id index for ended sessions, so
// a lateral keyed on character_id alone scans the whole session table once
// per character, which is what timed the production census batch out. The
// EXPLAIN runs under SET LOCAL enable_seqscan = off: a cost penalty, not a
// prohibition, so a statement with no usable key still plans a Seq Scan (or a
// full walk of an unrelated index) and fails the pin on small fixture tables.
//
// Values: the REAL loadCensusRows end to end, so the account term is proven
// to drop no session while the clamp, open-session, folded-totals, deleted
// sibling and GM rules still hold.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { materialSourceConnection } from '../server/material_source_connection';
import { checkRelationUsesPartialIndex, rootPlanFromExplainRow } from './helpers/pg_plan';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
// Per-run name: a fixed name lets two runs against one server (two worktrees
// gating at once against one local db:up) terminate each other's database.
// VITEST_WORKER_ID alone repeats across vitest processes, so the pid leads.
const VERIFY_DB = `wocc_parse_census_verify_${process.pid}_${process.env.VITEST_WORKER_ID ?? 0}`;

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load and builds its pool from it.
// Nothing above is a static import of server/db, so this assignment runs first
// and points the census loader at the disposable database.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

// Both account-led session indexes are a keyed probe; which one the planner
// takes on fixture-sized tables is its call, not the contract.
const ACCOUNT_KEYED_SESSION_INDEXES = ['play_sessions_account', 'play_sessions_account_started_id'];

describeDb('parse census loader (REAL Postgres)', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let census: typeof import('../server/parse/census_db');
  let realm: string;
  const ids = { played: 0, idle: 0, gm: 0, other: 0 };

  async function makeAccount(username: string): Promise<number> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [username],
    );
    return Number(res.rows[0].id);
  }

  async function makeCharacter(accountId: number, name: string, isGm = false): Promise<number> {
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state, is_gm)
       VALUES ($1, $2, 'mage', $3, 20, '{}'::jsonb, $4) RETURNING id`,
      [accountId, name, realm, isGm],
    );
    return Number(res.rows[0].id);
  }

  /** One session of `seconds` length; `seconds` null leaves it open. A null
   *  character is a deleted one (play_sessions.character_id ON DELETE SET NULL). */
  async function addSession(accountId: number, characterId: number | null, seconds: number | null) {
    await pool.query(
      `INSERT INTO play_sessions (account_id, character_id, started_at, ended_at)
       VALUES ($1, $2, now() - interval '3 days',
               CASE WHEN $3::int IS NULL THEN NULL
                    ELSE now() - interval '3 days' + make_interval(secs => $3::int) END)`,
      [accountId, characterId, seconds],
    );
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    census = await import('../server/parse/census_db');
    realm = (await import('../server/realm')).REALM;
    // The REAL boot path, so every session index under test is the one
    // production gets.
    await db.ensureSchema();
    await db.runConcurrentIndexMigrations();
    pool = new Pool({ ...materialSourceConnection(verifyUrl(ADMIN_URL as string)), max: 4 });

    const accountA = await makeAccount('census_verify_a');
    const accountB = await makeAccount('census_verify_b');
    ids.played = await makeCharacter(accountA, 'CensusPlayed');
    ids.idle = await makeCharacter(accountA, 'CensusIdle');
    ids.gm = await makeCharacter(accountA, 'CensusGm', true);
    ids.other = await makeCharacter(accountB, 'CensusOther');
    await addSession(accountA, ids.played, 100);
    await addSession(accountA, ids.played, 200);
    await addSession(accountA, ids.played, 2 * 86_400); // clamped to one day
    await addSession(accountA, ids.played, null); // still open: not counted
    await addSession(accountA, null, 300); // a deleted sibling: never credited
    // Sessions the retention sweep already folded forward still count.
    await pool.query(
      `INSERT INTO play_session_totals (account_id, character_id, playtime_seconds, sessions)
       VALUES ($1, $2, 1000, 4)`,
      [accountA, ids.played],
    );
    await addSession(accountA, ids.gm, 500);
    await addSession(accountB, ids.other, 50);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    // Best effort: the next run's beforeAll DROPs IF EXISTS anyway.
    await admin?.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`).catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  it('probes play_sessions by account per character, never a whole-table scan', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const res = await client.query(`EXPLAIN (FORMAT JSON) ${census.CENSUS_SQL}`, [
        realm,
        0,
        census.CENSUS_BATCH_SIZE,
      ]);
      const plan = rootPlanFromExplainRow(res.rows[0]);
      const checks = ACCOUNT_KEYED_SESSION_INDEXES.map((index) =>
        checkRelationUsesPartialIndex(plan, 'play_sessions', index),
      );
      expect(
        checks.some((check) => check.ok),
        checks.map((check) => check.reason).join('; '),
      ).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('loads every ended session plus the folded totals, and still excludes GMs', async () => {
    const records = await census.loadCensusRows(realm, '2026-10-05');
    const byId = new Map(records.map((record) => [record.characterId, record]));

    expect([...byId.keys()].sort((a, b) => a - b)).toEqual(
      [ids.played, ids.idle, ids.other].sort((a, b) => a - b),
    );
    expect(byId.get(ids.played)).toMatchObject({
      playtimeSeconds: 100 + 200 + 86_400 + 1000,
      playSessions: 3 + 4,
    });
    expect(byId.get(ids.idle)).toMatchObject({ playtimeSeconds: 0, playSessions: 0 });
    expect(byId.get(ids.other)).toMatchObject({ playtimeSeconds: 50, playSessions: 1 });
  });
});
