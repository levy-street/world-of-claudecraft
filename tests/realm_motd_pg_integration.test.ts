// Real-Postgres coverage for the realm message of the day store: the DDL's
// additive idempotence (ensureSchema re-applies it at every boot), the
// data-modifying CTE that writes the live row and its change trail in one
// statement, realm isolation, and the FK to accounts. A fake pool can only pin
// the SQL text; this proves the statements actually run.
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/market_sold_volume_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALM_MOTD_SCHEMA, realmMotdStore } from '../server/realm_motd_db';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_realm_motd_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

const describeDb = ADMIN_URL ? describe : describe.skip;

describeDb('realm_motd against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let accountId: number;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);
    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 4 });
    // The minimal accounts table the FKs reference; the real one comes from
    // db.ts SCHEMA, applied before REALM_MOTD_SCHEMA (pinned in schema_wiring).
    await pool.query('CREATE TABLE accounts (id SERIAL PRIMARY KEY)');
    accountId = (
      await pool.query<{ id: number }>('INSERT INTO accounts DEFAULT VALUES RETURNING id')
    ).rows[0].id;
    await pool.query(REALM_MOTD_SCHEMA);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  async function trail(realm: string) {
    const { rows } = await pool.query<{ message: string | null; changed_by: number | null }>(
      'SELECT message, changed_by FROM realm_motd_changes WHERE realm = $1 ORDER BY id',
      [realm],
    );
    return rows;
  }

  it('sets, overwrites and clears the live row, trailing every change', async () => {
    const store = realmMotdStore(() => pool, 'eu-1');

    await expect(store.load()).resolves.toBeNull();
    await store.save('First', accountId);
    await expect(store.load()).resolves.toBe('First');
    await store.save('Second', accountId);
    await expect(store.load()).resolves.toBe('Second');
    await store.save(null, accountId);
    await expect(store.load()).resolves.toBeNull();

    expect(await trail('eu-1')).toEqual([
      { message: 'First', changed_by: accountId },
      { message: 'Second', changed_by: accountId },
      { message: null, changed_by: accountId },
    ]);
    const live = await pool.query('SELECT count(*)::int AS n FROM realm_motd WHERE realm = $1', [
      'eu-1',
    ]);
    expect(live.rows[0].n).toBe(0);
  });

  it('keeps each realm on its own row', async () => {
    await realmMotdStore(() => pool, 'na-1').save('North', accountId);
    await realmMotdStore(() => pool, 'as-1').save('East', accountId);

    await expect(realmMotdStore(() => pool, 'na-1').load()).resolves.toBe('North');
    await expect(realmMotdStore(() => pool, 'as-1').load()).resolves.toBe('East');
  });

  it('re-applies cleanly over populated tables (the boot contract)', async () => {
    await realmMotdStore(() => pool, 'boot-1').save('Survives boots', accountId);

    await pool.query(REALM_MOTD_SCHEMA);
    await pool.query(REALM_MOTD_SCHEMA);

    await expect(realmMotdStore(() => pool, 'boot-1').load()).resolves.toBe('Survives boots');
    expect(await trail('boot-1')).toHaveLength(1);
  });

  it('keeps the message and its trail when the setting account is deleted', async () => {
    const gone = (
      await pool.query<{ id: number }>('INSERT INTO accounts DEFAULT VALUES RETURNING id')
    ).rows[0].id;
    await realmMotdStore(() => pool, 'fk-1').save('Orphaned', gone);

    await pool.query('DELETE FROM accounts WHERE id = $1', [gone]);

    await expect(realmMotdStore(() => pool, 'fk-1').load()).resolves.toBe('Orphaned');
    expect(await trail('fk-1')).toEqual([{ message: 'Orphaned', changed_by: null }]);
  });
});
