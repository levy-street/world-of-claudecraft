// Opt-in disposable PostgreSQL proof of the shipped three-key schema upgrade.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_BUDDIES_SCHEMA } from '../server/account_buddies_db';

const adminUrl = process.env.TEST_DATABASE_URL;
const database = `woc_account_buddies_${process.pid}_${process.env.VITEST_WORKER_ID ?? '0'}`;
const target = adminUrl ? new URL(adminUrl) : null;
if (target) target.pathname = `/${database}`;

(adminUrl ? describe : describe.skip)('account buddy schema upgrade (real Postgres)', () => {
  let admin: Pool;
  let pool: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl });
    await admin.query(`CREATE DATABASE "${database}"`);
    pool = new Pool({ connectionString: target!.toString(), max: 1 });
    await pool.query(`
      CREATE TABLE accounts (id INT PRIMARY KEY);
      INSERT INTO accounts VALUES (1);
      CREATE TABLE account_buddies (
        account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        owned TEXT[] NOT NULL DEFAULT '{}',
        CONSTRAINT account_buddies_active_keys CHECK (
          cardinality(owned) <= 3 AND owned <@ ARRAY['horse','crystal_lich','forgemaw']::text[])
      );
      INSERT INTO account_buddies VALUES (1, ARRAY['horse','crystal_lich','forgemaw']);
    `);
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  const grantSapling = () =>
    pool.query(
      "UPDATE account_buddies SET owned = ARRAY['horse','crystal_lich','forgemaw','sapling'] WHERE account_id=1",
    );

  it('upgrades the existing constraint atomically, remains idempotent and rejects invalid writes', async () => {
    await expect(grantSapling()).rejects.toMatchObject({ code: '23514' });
    await pool.query('BEGIN');
    try {
      await pool.query(ACCOUNT_BUDDIES_SCHEMA);
      await grantSapling();
    } finally {
      await pool.query('ROLLBACK');
    }
    // Schema replacement and grants roll back together if surrounding boot fails.
    await expect(grantSapling()).rejects.toMatchObject({ code: '23514' });

    await pool.query(ACCOUNT_BUDDIES_SCHEMA);
    expect((await pool.query('SELECT owned FROM account_buddies')).rows[0].owned).toEqual([
      'horse',
      'crystal_lich',
      'forgemaw',
    ]);
    await grantSapling();
    expect((await pool.query('SELECT owned FROM account_buddies')).rows[0].owned).toEqual([
      'horse',
      'crystal_lich',
      'forgemaw',
      'sapling',
    ]);
    const constraint = () =>
      pool.query(
        "SELECT oid, convalidated FROM pg_constraint WHERE conrelid='account_buddies'::regclass AND conname='account_buddies_active_keys'",
      );
    const upgraded = (await constraint()).rows[0];
    // The widening performs catalog-only work; it never scans the account book at boot.
    expect(upgraded.convalidated).toBe(false);
    await pool.query(ACCOUNT_BUDDIES_SCHEMA);
    expect((await constraint()).rows[0]).toEqual(upgraded);
    for (const owned of [['unknown'], ['horse', 'horse', 'horse', 'horse', 'horse']]) {
      await expect(
        pool.query('UPDATE account_buddies SET owned=$1 WHERE account_id=1', [owned]),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
});
