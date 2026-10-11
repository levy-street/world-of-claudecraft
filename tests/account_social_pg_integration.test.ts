// Disposable database only; opt in with TEST_DATABASE_URL to prove the actual SQL.
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_FRIENDS_SCHEMA, PgAccountFriendsDb } from '../server/account_friends_db';
import { migrateLegacyAccountSocial } from '../server/account_social_migration';
import { REALM } from '../server/realm';
import { REFERRAL_FRIEND_PAGE_INDEX_SQL } from '../server/referral_indexes';

const adminUrl = process.env.TEST_DATABASE_URL;
const database = `woc_account_social_${process.pid}_${process.env.VITEST_WORKER_ID ?? '0'}`;
const target = adminUrl ? new URL(adminUrl) : null;
if (target) target.pathname = `/${database}`;

(adminUrl ? describe : describe.skip)('account social migration (real Postgres)', () => {
  let admin: Pool;
  let pool: Pool;
  let client: Client;
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new Pool({ connectionString: target!.toString() });
    client = new Client({ connectionString: target!.toString() });
    await client.connect();
    await client.query(`
      CREATE TABLE accounts (id INT PRIMARY KEY);
      CREATE TABLE characters (id INT PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL, class TEXT NOT NULL DEFAULT 'mage', level INT NOT NULL DEFAULT 1,
        realm TEXT NOT NULL, state JSONB NOT NULL DEFAULT '{}');
      CREATE INDEX characters_account ON characters(account_id);
      CREATE TABLE friendships (character_id INT NOT NULL, friend_id INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(character_id, friend_id));
      CREATE TABLE blocks (character_id INT NOT NULL, blocked_id INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(character_id, blocked_id));
      CREATE TABLE referrals (referee_account_id INT PRIMARY KEY, referrer_account_id INT NOT NULL);
      ${ACCOUNT_FRIENDS_SCHEMA}
      INSERT INTO accounts SELECT generate_series(1, 601);
    `);
    await client.query(
      "INSERT INTO characters (id, account_id, name, realm) SELECT id, id, 'Char' || id, $1 FROM accounts",
      [REALM],
    );
    await client.query(
      "INSERT INTO characters (id,account_id,name,realm) VALUES (602,1,'AltOwner',$1),(603,2,'AltTarget',$1)",
      [REALM],
    );
    await client.query(`
      INSERT INTO friendships SELECT 1, id, '2026-01-02T00:00:00Z' FROM accounts WHERE id > 1;
      INSERT INTO friendships VALUES (602,603,'2026-01-01T00:00:00Z');
      INSERT INTO blocks SELECT character_id, friend_id, created_at FROM friendships;
    `);
  }, 30_000);
  afterAll(async () => {
    await client?.end();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  it('resumes committed pages, preserves oversized unions, and never resurrects removals', async () => {
    let starts = 0;
    const interrupted = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' && ++starts === 2) throw new Error('restart');
        return client.query(sql, values);
      },
    };
    await expect(migrateLegacyAccountSocial(interrupted as never)).rejects.toThrow('restart');
    expect(
      (await client.query('SELECT count(*)::int AS n FROM account_friendships')).rows[0].n,
    ).toBe(500);
    expect((await client.query('SELECT * FROM account_social_migrations')).rows).toHaveLength(0);
    await migrateLegacyAccountSocial(client);
    expect(
      (await client.query('SELECT count(*)::int AS n FROM account_friendships')).rows[0].n,
    ).toBe(600);
    expect((await client.query('SELECT count(*)::int AS n FROM account_blocks')).rows[0].n).toBe(
      600,
    );
    const pair = (
      await client.query(
        'SELECT * FROM account_friendships WHERE account_id=1 AND friend_account_id=2',
      )
    ).rows[0];
    expect(pair.display_character_id).toBe(2);
    expect(pair.created_at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    await client.query(
      'DELETE FROM account_friendships WHERE account_id=1 AND friend_account_id=2',
    );
    await migrateLegacyAccountSocial(client);
    expect(
      (await client.query('SELECT count(*)::int AS n FROM account_friendships')).rows[0].n,
    ).toBe(599);
  });

  it('refuses pages before the index exists and reads bounded pages after concurrent creation', async () => {
    await expect(new PgAccountFriendsDb(pool).listFriendPage(1)).rejects.toThrow('not ready');
    await client.query(REFERRAL_FRIEND_PAGE_INDEX_SQL);
    const page = await new PgAccountFriendsDb(pool).listFriendPage(1);
    expect(page.friends).toHaveLength(50);
    expect(page.nextCursor).toBe(52);
  });

  it('bounds inherited privacy reads without deleting overflow edges or hiding their display pages', async () => {
    await client.query('INSERT INTO accounts SELECT generate_series(602,4698)');
    await client.query(
      'INSERT INTO account_blocks(account_id,blocked_account_id) SELECT 1,id FROM accounts WHERE id>=602',
    );
    const db = new PgAccountFriendsDb(pool);
    expect(await db.blockedAccountIds(1)).toHaveLength(4097);
    const batch = await db.blockedAccountIdsForAccounts([1, 2]);
    expect(batch.get(1)).toHaveLength(4097);
    expect(batch.get(2)).toEqual([]);
    expect(
      (await client.query('SELECT count(*)::int AS n FROM account_blocks WHERE account_id=1'))
        .rows[0].n,
    ).toBe(4697);
    const first = await db.listBlockPage(1);
    expect(first.blocks).toHaveLength(50);
    expect(first.nextCursor).toBe(51);
    const next = await db.listBlockPage(1, first.nextCursor ?? 0);
    expect(next.blocks).toHaveLength(50);
    expect(next.nextCursor).toBe(101);
    const missingRealmCharacters = await db.listBlockPage(1, 601);
    expect(missingRealmCharacters.blocks).toEqual([]);
    expect(missingRealmCharacters.nextCursor).toBe(651);
  });
  it('uses the block primary key for a full 25-account privacy cohort', async () => {
    await client.query(`INSERT INTO account_blocks(account_id,blocked_account_id)
      SELECT owner, target FROM generate_series(2,26) owner CROSS JOIN generate_series(100,4195) target`);
    await client.query('ANALYZE account_blocks');
    const ids = Array.from({ length: 25 }, (_, i) => i + 2);
    const start = performance.now();
    const cohort = await new PgAccountFriendsDb(pool).blockedAccountIdsForAccounts(ids);
    const queried = performance.now();
    const cached = new Map([...cohort].map(([id, blocked]) => [id, new Set(blocked)]));
    const hydrated = performance.now();
    expect([...cached.values()].every((blocked) => blocked.size === 4096)).toBe(true);
    const plan = await client.query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
      SELECT owner.account_id, b.blocked_account_id FROM unnest($1::int[]) owner(account_id)
      CROSS JOIN LATERAL (SELECT blocked_account_id FROM account_blocks WHERE account_id = owner.account_id
        ORDER BY blocked_account_id LIMIT $2) b`,
      [ids, 4097],
    );
    expect(JSON.stringify(plan.rows)).toContain('account_blocks_pkey');
    const rowCount = [...cohort.values()].reduce((sum, rows) => sum + rows.length, 0);
    expect(rowCount).toBe(102400);
    console.info('account block cohort proof', {
      accounts: 25,
      rows: rowCount,
      queryMs: Math.round(queried - start),
      hydrateMs: Math.round(hydrated - queried),
      postgresExecutionMs: plan.rows[0]['QUERY PLAN'][0]['Execution Time'],
      index: 'account_blocks_pkey',
    });
  });
});
