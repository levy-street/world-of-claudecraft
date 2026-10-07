import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterSaveArgs } from '../../server/woc_market_character_save';
import type { CharacterState } from '../../src/sim/character_state';

const binding = vi.hoisted(() => ({ pool: null as Pool | null }));
function testPool(): Pool {
  if (!binding.pool) throw new Error('membership integration pool is not initialized');
  return binding.pool;
}

// Use an isolated schema and the production character UPDATE builder. The broad
// db.ts save coordinator's ledger/storage journals have their own integration
// suites; this fixture exercises redemption's real transaction and lease SQL.
vi.mock('../../server/db', () => ({
  pool: {
    connect: () => testPool().connect(),
    query: (sql: string, values?: unknown[]) => testPool().query(sql, values),
  },
  saveCharacterStateOnClient: async (
    client: PoolClient,
    id: number,
    level: number,
    state: CharacterState,
    nonce: string,
  ) => {
    const { characterUpdateStatement } = await import('../../server/character_save_statement');
    const { PROCESS_LEASE_HOLDER } = await import('../../server/character_lease_db');
    const statement = characterUpdateStatement(id, level, JSON.stringify(state), {
      kind: 'nonce',
      nonce,
      holder: PROCESS_LEASE_HOLDER,
    });
    return ((await client.query(statement.text, statement.values)).rowCount ?? 0) > 0;
  },
}));

import { PROCESS_LEASE_HOLDER } from '../../server/character_lease_db';
import { MEMBERSHIP_SCHEMA } from '../../server/membership_db';
import { redeemMembershipTokenAtomic } from '../../server/membership_redemption_db';
import { REALM } from '../../server/realm';
import { MEMBERSHIP_ITEM_DURATION_MS } from '../../src/membership_contract';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('membership redemption PostgreSQL atomicity', () => {
  const schema = `membership_redemption_test_${process.pid}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  const captured = (id = 13): CharacterSaveArgs => ({
    characterId: id,
    level: 3,
    leaseNonce: `nonce-${id}`,
    state: { level: 3, inventory: [{ itemId: 'membership_token', count: 1 }] } as CharacterState,
  });

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    binding.pool = new Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
    await binding.pool.query('CREATE TABLE accounts (id INT PRIMARY KEY)');
    await binding.pool.query(
      'CREATE TABLE characters (id INT PRIMARY KEY, account_id INT REFERENCES accounts(id), realm TEXT, level INT, state JSONB, updated_at TIMESTAMPTZ DEFAULT now())',
    );
    await binding.pool.query(
      'CREATE TABLE character_leases (character_id INT PRIMARY KEY REFERENCES characters(id), nonce TEXT, holder TEXT, expires_at TIMESTAMPTZ)',
    );
    await binding.pool.query(MEMBERSHIP_SCHEMA);
  });
  beforeEach(async () => {
    await testPool().query(
      'TRUNCATE accounts, characters, character_leases, account_memberships CASCADE',
    );
    await testPool().query('INSERT INTO accounts VALUES (7), (8)');
    for (const id of [13, 14]) {
      await testPool().query(
        'INSERT INTO characters (id, account_id, realm, level, state) VALUES ($1, 7, $2, 3, $3)',
        [id, REALM, JSON.stringify(captured(id).state)],
      );
      await testPool().query(
        "INSERT INTO character_leases VALUES ($1, $2, $3, now() + interval '1 hour')",
        [id, `nonce-${id}`, PROCESS_LEASE_HOLDER],
      );
    }
  });
  afterAll(async () => {
    await binding.pool?.end();
    binding.pool = null;
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it('serializes redemptions from two characters and commits exactly two tokens for 60 days', async () => {
    const recurring = Date.now() + 100_000;
    const results = await Promise.all([
      redeemMembershipTokenAtomic(7, captured(13), 0, recurring),
      redeemMembershipTokenAtomic(7, captured(14), 0, recurring),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const chars = await testPool().query('SELECT state FROM characters ORDER BY id');
    expect(chars.rows.map((row) => row.state.inventory)).toEqual([[], []]);
    const membership = await testPool().query(
      'SELECT prepaid_until FROM account_memberships WHERE account_id = 7',
    );
    expect(membership.rows[0].prepaid_until.getTime()).toBe(
      recurring + 2 * MEMBERSHIP_ITEM_DURATION_MS,
    );
  });

  it('rolls back token removal when PostgreSQL rejects the membership grant', async () => {
    await testPool().query(
      "ALTER TABLE account_memberships ADD CONSTRAINT reject_grant CHECK (prepaid_until < '2000-01-01')",
    );
    try {
      expect(await redeemMembershipTokenAtomic(7, captured(), 0, null)).toEqual({
        ok: false,
        reason: 'retry',
      });
      expect(
        (await testPool().query('SELECT state FROM characters WHERE id = 13')).rows[0].state
          .inventory,
      ).toEqual(captured().state.inventory);
      expect((await testPool().query('SELECT * FROM account_memberships')).rowCount).toBe(0);
    } finally {
      await testPool().query('ALTER TABLE account_memberships DROP CONSTRAINT reject_grant');
    }
  });

  it('rejects another account, expired leases, and a different process holder', async () => {
    expect(await redeemMembershipTokenAtomic(8, captured(), 0, null)).toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    await testPool().query(
      "UPDATE character_leases SET expires_at = now() - interval '1 second' WHERE character_id = 13",
    );
    expect(await redeemMembershipTokenAtomic(7, captured(), 0, null)).toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    await testPool().query(
      "UPDATE character_leases SET holder = 'another-process' WHERE character_id = 14",
    );
    expect(await redeemMembershipTokenAtomic(7, captured(14), 0, null)).toEqual({
      ok: false,
      reason: 'lease_lost',
    });
    expect((await testPool().query('SELECT * FROM account_memberships')).rowCount).toBe(0);
  });
});
