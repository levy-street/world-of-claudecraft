import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ pool: {} }));

import {
  extendPrepaidMembershipOnClient,
  MEMBERSHIP_SCHEMA,
  membershipExpiresAtOnClient,
} from '../server/membership_db';
import { MEMBERSHIP_ITEM_DURATION_MS } from '../src/membership_contract';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('membership PostgreSQL transactions', () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const schema = `membership_entitlements_test_${process.pid}`;
  let client: PoolClient;
  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query('CREATE TABLE accounts (id INT PRIMARY KEY)');
    await client.query(
      'CREATE TABLE characters (id INT PRIMARY KEY, account_id INT REFERENCES accounts(id) ON DELETE CASCADE)',
    );
    await client.query('INSERT INTO accounts VALUES (1), (2), (3)');
    await client.query('INSERT INTO characters VALUES (1, 1)');
    await client.query(MEMBERSHIP_SCHEMA);
    await client.query(MEMBERSHIP_SCHEMA);
  });
  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
    await pool.end();
  });

  it('keeps existing characters as base slots and rolls entitlement back with its caller', async () => {
    expect(
      (await client.query('SELECT membership_slot FROM characters WHERE id = 1')).rows[0]
        .membership_slot,
    ).toBe(false);
    await client.query('BEGIN');
    await client.query('SELECT id FROM accounts WHERE id = 1 FOR UPDATE');
    await extendPrepaidMembershipOnClient(client, 1, null, 1000);
    await client.query('ROLLBACK');
    expect(await membershipExpiresAtOnClient(client, 1, null)).toBeNull();
  });

  it('serializes two simultaneous grants on the account lock without losing time', async () => {
    const second = await pool.connect();
    try {
      await second.query(`SET search_path TO ${schema}`);
      const grant = async (connection: PoolClient) => {
        await connection.query('BEGIN');
        await connection.query("SET LOCAL lock_timeout = '2s'; SET LOCAL statement_timeout = '5s'");
        await connection.query('SELECT id FROM accounts WHERE id = 2 FOR UPDATE');
        const expiry = await extendPrepaidMembershipOnClient(connection, 2, 5000, 1000);
        await connection.query('COMMIT');
        return expiry;
      };
      const expiries = await Promise.all([grant(client), grant(second)]);
      expect(expiries.sort((a, b) => a - b)).toEqual([
        5000 + MEMBERSHIP_ITEM_DURATION_MS,
        5000 + 2 * MEMBERSHIP_ITEM_DURATION_MS,
      ]);
      expect(await membershipExpiresAtOnClient(client, 2, null)).toBe(
        5000 + 2 * MEMBERSHIP_ITEM_DURATION_MS,
      );
      expect(
        (
          await client.query(
            'SELECT count(*)::int AS n FROM account_memberships WHERE account_id = 2',
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await second.query('ROLLBACK');
      second.release();
    }
  });

  it('uses the account primary key and cascades membership on account deletion', async () => {
    await client.query('INSERT INTO account_memberships VALUES (3, now())');
    await client.query('SET enable_seqscan = off');
    const plan = await client.query(
      'EXPLAIN (FORMAT JSON) SELECT prepaid_until FROM account_memberships WHERE account_id = 3',
    );
    expect(JSON.stringify(plan.rows)).toContain('account_memberships_pkey');
    await client.query('RESET enable_seqscan');
    await client.query('DELETE FROM accounts WHERE id = 3');
    expect(await membershipExpiresAtOnClient(client, 3, null)).toBeNull();
  });
});
