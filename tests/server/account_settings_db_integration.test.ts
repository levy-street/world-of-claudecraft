import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_SETTINGS_SCHEMA, createAccountSettingsDb } from '../../server/account_settings_db';
import {
  type AccountSettingsTransactionRunner,
  createAccountSettingsTransactionRunner,
} from '../../server/account_settings_transaction_db';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable account device preferences', () => {
  const pool = new Pool({ connectionString: url, max: 4 });
  const schema = `account_settings_test_${randomUUID().replaceAll('-', '')}`;
  const transaction = createAccountSettingsTransactionRunner(pool);
  const run: AccountSettingsTransactionRunner = (timeout, fn) =>
    transaction(timeout, async (query) => {
      await query(`SET LOCAL search_path TO ${schema}`);
      return fn(query);
    });
  const db = createAccountSettingsDb(run);
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await run(2_000, async (query) => {
      await query('CREATE TABLE accounts (id INT PRIMARY KEY)');
      await query(
        'CREATE TABLE characters (id INT PRIMARY KEY, account_id INT NOT NULL REFERENCES accounts(id))',
      );
      await query('INSERT INTO accounts VALUES (1), (2)');
      await query('INSERT INTO characters VALUES (10, 1), (11, 1), (20, 2)');
      await query(ACCOUNT_SETTINGS_SCHEMA);
      await query(ACCOUNT_SETTINGS_SCHEMA);
    });
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  it('requires acknowledgment and ownership before storing any profile', async () => {
    expect(await db.initialize(1, 'desktop', 10, {})).toBeNull();
    await db.acknowledge(1);
    expect(await db.initialize(1, 'desktop', 20, {})).toBeNull();
    expect(await db.save(1, 'desktop', {})).toBe(false);
  });
  it('racing first characters converge on one durable winner', async () => {
    const [a, b] = await Promise.all([
      db.initialize(1, 'desktop', 10, { woc_theme: 'first' }),
      db.initialize(1, 'desktop', 11, { woc_theme: 'second' }),
    ]);
    expect(a).toEqual(b);
    expect(['first', 'second']).toContain(a?.woc_theme);
    expect(await db.initialize(1, 'desktop', 11, { woc_theme: 'later' })).toEqual(a);
    expect(await db.initialize(1, 'phone', 10, { woc_theme: 'phone' })).toEqual({
      woc_theme: 'phone',
    });
    expect(await db.save(1, 'desktop', { woc_theme: 'saved' })).toBe(true);
    expect(await db.initialize(1, 'desktop', 10, {})).toEqual({ woc_theme: 'saved' });
  });
  it('refuses a held profile row lock and leaves the pooled client usable', async () => {
    const holder = await pool.connect();
    await holder.query('BEGIN');
    try {
      await holder.query(`SET LOCAL search_path TO ${schema}`);
      await holder.query(
        "SELECT 1 FROM account_device_settings WHERE account_id = 1 AND device_type = 'desktop' FOR UPDATE",
      );
      const start = Date.now();
      await expect(db.save(1, 'desktop', { woc_theme: 'blocked' })).rejects.toMatchObject({
        code: '55P03',
      });
      expect(Date.now() - start).toBeLessThan(3_000);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect(await db.save(1, 'desktop', { woc_theme: 'recovered' })).toBe(true);
    expect(pool.waitingCount).toBe(0);
  });
  it('wall deadline cancels a multi-statement transaction and destroys its client', async () => {
    const start = Date.now();
    await expect(
      run(2_000, async (query) => {
        await query('SELECT pg_sleep(1.8)');
        await query('SELECT pg_sleep(1.8)');
      }),
    ).rejects.toMatchObject({ name: 'DbTransactionDeadlineExceeded' });
    expect(Date.now() - start).toBeLessThan(4_500);
    expect(pool.waitingCount).toBe(0);
    expect(await db.acknowledged(1)).toBe(true);
  });
  it('closed device enum bounds rows and account deletion cascades preferences', async () => {
    await expect(
      run(2_000, (query) => query("INSERT INTO account_device_settings VALUES (1, 'tv', '{}')")),
    ).rejects.toMatchObject({ code: '23514' });
    await run(2_000, async (query) => {
      await query('DELETE FROM characters WHERE account_id = 1');
      await query('DELETE FROM accounts WHERE id = 1');
      expect((await query('SELECT count(*) AS n FROM account_device_settings')).rows[0].n).toBe(
        '0',
      );
      expect((await query('SELECT count(*) AS n FROM account_settings_ack')).rows[0].n).toBe('0');
    });
  });
});
