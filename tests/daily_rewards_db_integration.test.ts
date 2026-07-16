// Opt-in real-Postgres coverage for timed-ban semantics and the account/day
// event-ledger plan. The default suite stays DB-free; set TEST_DATABASE_URL to
// exercise the production PostgreSQL 16 SQL.

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL } from '../server/daily_rewards_schema';

const DB_URL = process.env.TEST_DATABASE_URL;
const SCHEMA = 'daily_rewards_integration_test';
const describeDb = DB_URL ? describe : describe.skip;

function planNodeNames(plan: Record<string, unknown>): string[] {
  const names: string[] = [];
  const visit = (node: Record<string, unknown>): void => {
    if (typeof node['Index Name'] === 'string') names.push(node['Index Name']);
    const children = Array.isArray(node.Plans) ? node.Plans : [];
    for (const child of children) {
      if (child && typeof child === 'object') visit(child as Record<string, unknown>);
    }
  };
  visit(plan);
  return names;
}

describeDb('Daily Rewards timed bans and event ledger (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      await client.query(`
        CREATE TABLE accounts (id INT PRIMARY KEY);
        CREATE TABLE daily_reward_bans (
          account_id INT PRIMARY KEY REFERENCES accounts(id),
          reason TEXT NOT NULL,
          expires_at TIMESTAMPTZ
        );
        CREATE VIEW daily_reward_excluded_accounts AS
        SELECT account_id, reason
          FROM daily_reward_bans
         WHERE expires_at IS NULL OR expires_at > now();
        CREATE TABLE daily_reward_events (
          id BIGSERIAL PRIMARY KEY,
          day TEXT NOT NULL,
          realm TEXT NOT NULL,
          account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          points INT NOT NULL,
          idempotency_key TEXT NOT NULL,
          meta JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (day, realm, account_id, idempotency_key)
        );
        INSERT INTO accounts VALUES (1), (2), (3);
        INSERT INTO daily_reward_events (
          day, realm, account_id, kind, points, idempotency_key, created_at
        )
        SELECT '2026-07-16', 'eastbrook',
               CASE WHEN n <= 10000 THEN 1 ELSE 2 END,
               'task', 10, 'event:' || n,
               '2026-07-16T00:00:00Z'::timestamptz + (n * interval '1 second')
          FROM generate_series(1, 20000) AS n;
      `);
      await client.query(DAILY_REWARD_EVENTS_CONCURRENT_INDEX_SQL);
      await client.query('ANALYZE daily_reward_events');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('selects the account-leading index for a bounded point-event read', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      const explained = await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT id, created_at, kind, points, meta
           FROM daily_reward_events
          WHERE account_id = $1
            AND day = $2
            AND realm = $3
            AND points > 0
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        [1, '2026-07-16', 'eastbrook'],
      );
      const root = explained.rows[0]['QUERY PLAN'][0].Plan as Record<string, unknown>;
      expect(planNodeNames(root)).toContain('daily_reward_events_account_day_created_id');
      expect(Number(root['Actual Rows'])).toBe(100);
    } finally {
      client.release();
    }
  });

  it('excludes permanent and active timed bans but releases expired bans', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}`);
      await client.query(
        `INSERT INTO daily_reward_bans (account_id, reason, expires_at) VALUES
           (1, 'permanent', NULL),
           (2, 'active', now() + interval '1 hour'),
           (3, 'expired', now() - interval '1 hour')`,
      );
      const active = await client.query(
        'SELECT account_id, reason FROM daily_reward_excluded_accounts ORDER BY account_id',
      );
      expect(active.rows).toEqual([
        { account_id: 1, reason: 'permanent' },
        { account_id: 2, reason: 'active' },
      ]);
    } finally {
      client.release();
    }
  });
});
