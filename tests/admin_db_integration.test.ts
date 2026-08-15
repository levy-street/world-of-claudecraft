// Opt-in real-Postgres coverage for the admin Overview aggregate's
// active/returning-account subqueries. The default suite stays DB-free; set
// TEST_DATABASE_URL to exercise the production PostgreSQL 16 EXPLAIN plan at
// scale. Mirrors the daily_rewards_db_integration.test.ts and
// player_metrics_db_integration.test.ts template (bulk-load, ANALYZE, pin the
// plan with EXPLAIN ... FORMAT JSON).

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OVERVIEW_COUNTS_SQL } from '../server/admin_db';
import { ADMIN_OVERVIEW_ACTIVE_SESSIONS_INDEX_SQL } from '../server/admin_db_indexes';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'admin_overview_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

function planNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [node];
  const children = (node.Plans as Record<string, unknown>[] | undefined) ?? [];
  for (const child of children) {
    if (child && typeof child === 'object') nodes.push(...planNodes(child));
  }
  return nodes;
}

describeDb('admin overview active/returning-account subqueries (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      // Mirrors the columns overviewCounts's aggregate actually reads
      // (server/db.ts SCHEMA + server/play_session_retention_db.ts), not the
      // full production table shapes.
      await client.query(`
        CREATE TABLE accounts (
          id SERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX accounts_created_at ON accounts(created_at DESC);
        CREATE TABLE characters (
          id SERIAL PRIMARY KEY,
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
        );
        CREATE TABLE play_sessions (
          id SERIAL PRIMARY KEY,
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at TIMESTAMPTZ
        );
        CREATE INDEX play_sessions_account ON play_sessions(account_id);
        CREATE INDEX play_sessions_started ON play_sessions(started_at);
        CREATE TABLE play_session_totals (
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          character_id INT NOT NULL,
          playtime_seconds BIGINT NOT NULL,
          sessions INT NOT NULL,
          PRIMARY KEY (account_id, character_id)
        );
        CREATE TABLE admin_online_samples (
          id BIGSERIAL PRIMARY KEY,
          realm TEXT NOT NULL,
          sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          online_players INT NOT NULL,
          online_accounts INT NOT NULL
        );
        CREATE INDEX admin_online_samples_realm_sampled
          ON admin_online_samples(realm, sampled_at DESC);
        CREATE TABLE world_state (
          key TEXT PRIMARY KEY,
          data JSONB NOT NULL
        );
        CREATE TABLE site_presence_sessions (
          visitor_id TEXT PRIMARY KEY,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      // Built empty (as in production, ahead of the table's growth), then
      // maintained incrementally as the bulk load below inserts rows: the
      // same order the boot coordinator's post-commit CONCURRENTLY seam runs
      // it in against a live table.
      await client.query(ADMIN_OVERVIEW_ACTIVE_SESSIONS_INDEX_SQL);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('keeps the active and returning-account subqueries off a play_sessions sequential scan at 500k rows', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      await client.query(
        `INSERT INTO accounts (created_at)
           SELECT now() - interval '10 days' FROM generate_series(1, 5000)`,
      );
      // 500k play_sessions: the vast majority (98%) ended long ago and must
      // fall OUTSIDE every active/returning window; a small recent slice is
      // split between still-open (ended_at IS NULL) and ended-after-cutoff,
      // exercising both arms of the sargable OR.
      await client.query(
        `INSERT INTO play_sessions (account_id, started_at, ended_at)
           SELECT (n % 5000) + 1,
                  CASE WHEN n <= 490000
                       THEN now() - interval '400 days'
                       ELSE now() - interval '2 hours'
                  END,
                  CASE WHEN n <= 490000 THEN now() - interval '399 days'
                       WHEN n % 2 = 0 THEN NULL
                       ELSE now() - interval '30 minutes'
                  END
             FROM generate_series(1, 500000) AS n`,
      );
      await client.query('ANALYZE accounts');
      await client.query('ANALYZE play_sessions');

      const explained = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${OVERVIEW_COUNTS_SQL}`,
        ['eastbrook'],
      );
      const root = explained.rows[0]['QUERY PLAN'][0].Plan as Record<string, unknown>;
      const nodes = planNodes(root);
      const playSessionsScans = nodes.filter((node) => node['Relation Name'] === 'play_sessions');
      // The aggregate touches play_sessions six times: sessions_today, the
      // three active-account windows, the returning-accounts join, and the
      // unconditional avg_playtime_seconds sum. A rewrite that dropped a
      // subquery's play_sessions access entirely would silently pass an
      // empty-set check here.
      expect(playSessionsScans.length).toBe(6);

      // Only the four active/returning-account subqueries filter on
      // ended_at; avg_playtime_seconds sums every row with no WHERE clause
      // at all (correctly a full scan: there is nothing to be sargable
      // about) and sessions_today is fully served by its own started_at
      // Index Cond (no residual Filter). Scoping to nodes carrying a
      // Filter isolates exactly the four subqueries the bug affects.
      const filteredScans = playSessionsScans.filter((node) => 'Filter' in node);
      expect(filteredScans.length).toBe(4);

      // The decisive sargability signal, robust to whichever physical
      // operator the planner picks. The un-fixed COALESCE(ended_at, now())
      // > cutoff form embeds a volatile function in the filtered
      // expression, which Postgres can never turn into an Index Cond: on
      // this fixture it plans as a full unfiltered walk of the unrelated
      // play_sessions_account index (never even a literal Seq Scan node),
      // discarding ~98% of the table (490,000 of 500,000 rows) via a
      // residual Filter. The rewritten (ended_at IS NULL OR ended_at >
      // cutoff) form is sargable: the planner pushes it into a BitmapOr
      // over play_sessions_ended_account, so almost nothing reaches the
      // heap-level Filter, and it never resorts to a bare Seq Scan.
      for (const node of filteredScans) {
        expect(node['Node Type']).not.toBe('Seq Scan');
        expect(Number(node['Rows Removed by Filter'] ?? 0)).toBeLessThan(1000);
      }

      // Positively confirm the fix rides the new index, not just that the
      // heap-level symptom is gone.
      expect(nodes.some((node) => node['Index Name'] === 'play_sessions_ended_account')).toBe(true);
    } finally {
      client.release();
    }
  }, 120_000);
});
