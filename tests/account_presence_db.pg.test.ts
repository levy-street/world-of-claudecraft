// Opt-in SQL proof using session-local tables; never mutates application tables.
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_FRIENDS_SCHEMA, PgAccountFriendsDb } from '../server/account_friends_db';

const url = process.env.WOC_PRESENCE_TEST_DATABASE_URL;
describe.skipIf(!url)('account presence edges on PostgreSQL', () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = new PgAccountFriendsDb(pool);
  const statements: { sql: string; args: unknown[] }[] = [];

  beforeAll(async () => {
    await pool.query(
      'CREATE TEMP TABLE accounts (id INT PRIMARY KEY); CREATE TEMP TABLE characters (id INT PRIMARY KEY)',
    );
    await pool.query(
      ACCOUNT_FRIENDS_SCHEMA.replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE'),
    );
    const schema = readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8');
    const referrals = schema.slice(
      schema.indexOf('CREATE TABLE IF NOT EXISTS referrals ('),
      schema.indexOf('-- Append-only audit ledger'),
    );
    await pool.query(referrals.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE'));
    await pool.query('INSERT INTO accounts SELECT generate_series(1, 5000)');
    await pool.query(
      'INSERT INTO account_friendships (account_id, friend_account_id) VALUES (1, 2), (4, 5), (2, 4999)',
    );
    await pool.query(
      "INSERT INTO referrals (referee_account_id, referrer_account_id, slug) VALUES (3, 1, 'test'), (5, 4, 'test')",
    );
    const query = pool.query.bind(pool);
    // Capture only the production reader calls, for an eligibility EXPLAIN below.
    const reader = pool as unknown as { query: (sql: string, args: unknown[]) => Promise<unknown> };
    reader.query = async (sql, args) => {
      statements.push({ sql, args });
      return query(sql, args);
    };
  });
  afterAll(async () => {
    await pool.end();
  });

  it('keeps ordinary directionality and makes referral relationships mutual', async () => {
    expect(await db.presenceEdgesForAccount(1, [2, 3, 4])).toEqual([
      { accountId: 2, outgoing: true, incoming: false },
      { accountId: 3, outgoing: true, incoming: true },
    ]);
    expect(await db.presenceEdgesForAccount(2, [1])).toEqual([
      { accountId: 1, outgoing: false, incoming: true },
    ]);
    expect(
      (await db.presenceEdgesForLiveAccounts([1, 2, 3, 4])).sort(
        (a, b) => a.ownerId - b.ownerId || a.friendId - b.friendId,
      ),
    ).toEqual([
      { ownerId: 1, friendId: 2 },
      { ownerId: 1, friendId: 3 },
      { ownerId: 3, friendId: 1 },
    ]);
  });

  it('can execute pair and bulk readers through the shipped leading-key indexes', async () => {
    const reads = [...statements];
    await pool.query('SET enable_seqscan = off');
    for (const read of reads) {
      const result = await pool.query(`EXPLAIN (FORMAT JSON) ${read.sql}`, read.args);
      const plan = JSON.stringify(result.rows);
      expect(plan).toMatch(/account_friendships_(pkey|reverse)/);
      expect(plan).toMatch(/referrals_(pkey|referrer)/);
      expect(plan).not.toContain('Seq Scan');
    }
  });
});
