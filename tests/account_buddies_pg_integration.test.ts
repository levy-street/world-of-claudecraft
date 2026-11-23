// Opt-in disposable PostgreSQL proof of buddy schema retirement and repeat-boot locks.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_BUDDIES_SCHEMA } from '../server/account_buddies_db';
import { BUDDY_KEYS } from '../src/sim/content/buddies';

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
    pool = new Pool({ connectionString: target!.toString(), max: 3 });
    await pool.query('CREATE TABLE accounts (id INT PRIMARY KEY); INSERT INTO accounts VALUES (1)');
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  });

  it.each(['fresh', 'three-key', 'five-key'] as const)(
    '%s schema preserves ownership, retires the old CHECK once and leaves repeat boots unlocked',
    async (fixture) => {
      await pool.query('DROP TABLE IF EXISTS account_buddies');
      if (fixture !== 'fresh') {
        const keys =
          fixture === 'three-key'
            ? ['horse', 'crystal_lich', 'forgemaw']
            : ['horse', 'crystal_lich', 'forgemaw', 'sapling', 'sprites'];
        // Fixture-only identifiers from a closed local catalog, never request data.
        const literals = keys.map((key) => `'${key}'`).join(',');
        await pool.query(`CREATE TABLE account_buddies (
          account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          owned TEXT[] NOT NULL DEFAULT '{}',
          CONSTRAINT account_buddies_active_keys CHECK (
            cardinality(owned) <= ${keys.length} AND owned <@ ARRAY[${literals}]::text[])
        )`);
        await pool.query('INSERT INTO account_buddies VALUES (1, $1::text[])', [keys]);
        const upgrade = await pool.connect();
        try {
          await upgrade.query('BEGIN');
          await upgrade.query(ACCOUNT_BUDDIES_SCHEMA);
          await upgrade.query('ROLLBACK');
        } finally {
          upgrade.release();
        }
        // A later boot failure rolls back retirement, without losing ownership.
        expect(
          (
            await pool.query(
              "SELECT 1 FROM pg_constraint WHERE conrelid='account_buddies'::regclass AND conname='account_buddies_active_keys'",
            )
          ).rowCount,
        ).toBe(1);
        expect((await pool.query('SELECT owned FROM account_buddies')).rows[0].owned).toEqual(keys);
      }

      await pool.query(ACCOUNT_BUDDIES_SCHEMA);
      expect(
        (
          await pool.query(
            "SELECT 1 FROM pg_constraint WHERE conrelid='account_buddies'::regclass AND conname='account_buddies_active_keys'",
          )
        ).rowCount,
      ).toBe(0);
      await pool.query(
        'INSERT INTO account_buddies VALUES (1, $1::text[]) ON CONFLICT (account_id) DO UPDATE SET owned=EXCLUDED.owned',
        [BUDDY_KEYS],
      );

      const boot = await pool.connect();
      const writer = await pool.connect();
      try {
        await boot.query('BEGIN');
        await boot.query(ACCOUNT_BUDDIES_SCHEMA);
        const locks = await boot.query(
          "SELECT mode FROM pg_locks WHERE pid=pg_backend_pid() AND relation='account_buddies'::regclass AND granted",
        );
        expect(locks.rows.map((row) => row.mode)).not.toContain('AccessExclusiveLock');
        await writer.query("SET statement_timeout='2s'");
        // These must finish before the boot transaction commits.
        expect((await writer.query('SELECT owned FROM account_buddies')).rows[0].owned).toEqual(
          BUDDY_KEYS,
        );
        expect(
          (
            await writer.query('UPDATE account_buddies SET owned=$1::text[] WHERE account_id=1', [
              BUDDY_KEYS,
            ])
          ).rowCount,
        ).toBe(1);
      } finally {
        await boot.query('ROLLBACK');
        await writer.query('RESET statement_timeout');
        boot.release();
        writer.release();
      }
    },
  );
});
