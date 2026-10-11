// Runs the production transfer, source save, and material journal against an
// isolated schema. No shared application row or table is read or modified.
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MembershipBankSave } from '../server/membership_bank_db';
import type { CharacterState } from '../src/sim/character_state';

const url = process.env.TEST_DATABASE_URL;
const schema = `membership_bank_verify_${process.pid}_${Date.now().toString(36)}`;
describe.skipIf(!url)('membership banks real PostgreSQL exclusion', () => {
  let admin: Pool;
  let db: typeof import('../server/db');
  let banks: typeof import('../server/membership_bank_db');
  let realm: string;
  let originalUrl: string | undefined;
  const item = {
    itemId: 'wolf_fang',
    count: 3,
    materialSources: [{ source: { signer: 'Mira' }, count: 3 }],
  };
  const actor = () =>
    ({
      level: 5,
      inventory: [structuredClone(item)],
      questLog: [],
      questsDone: [],
    }) as unknown as CharacterState;
  const target = () => ({
    level: 5,
    inventory: [],
    questLog: [],
    questsDone: [],
    futureField: { preserved: true },
    bank: { inventory: [], purchasedSlots: 0, bonusSlots: 0 },
  });
  const input = (): MembershipBankSave => ({
    accountId: 1,
    characterId: 20,
    targetCharacterId: 10,
    leaseNonce: 'source-nonce',
    state: actor(),
    membership: {
      active: true,
      expiresAt: Date.now() + 60_000,
      authorizedUntil: Date.now() + 30_000,
      recurringExpiresAt: null,
    },
    request: { direction: 'deposit', slotIndex: 0, expectedSlot: structuredClone(item) },
    stillAuthorized: () => true,
  });

  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 2 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    originalUrl = process.env.DATABASE_URL;
    const isolatedUrl = new URL(url as string);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    db = await import('../server/db');
    banks = await import('../server/membership_bank_db');
    realm = (await import('../server/realm')).REALM;
    await db.pool.query('CREATE TABLE accounts (id INT PRIMARY KEY)');
    await db.pool.query(`CREATE TABLE characters (
      id INT PRIMARY KEY, account_id INT REFERENCES accounts(id), realm TEXT NOT NULL,
      name TEXT NOT NULL, level INT, state JSONB, updated_at TIMESTAMPTZ DEFAULT now())`);
    await db.pool.query(`CREATE TABLE character_leases (
      character_id INT PRIMARY KEY REFERENCES characters(id), holder TEXT, nonce TEXT, expires_at TIMESTAMPTZ)`);
    await db.pool.query((await import('../server/membership_db')).MEMBERSHIP_SCHEMA);
    await db.pool.query(
      (await import('../server/material_source_journal_db')).MATERIAL_SOURCE_JOURNAL_SCHEMA,
    );
    await db.pool.query(`CREATE TABLE bank_ledger (
      realm TEXT, character_id INT, account_id INT, op TEXT, item_id TEXT, count INT,
      instance JSONB, copper_delta BIGINT, purchased_slots_after INT, container TEXT,
      container_id BIGINT, counterparty_count INT)`);
  });
  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE material_source_journal, material_source_containers, bank_ledger, character_leases, account_memberships, characters, accounts CASCADE',
    );
    await db.pool.query('INSERT INTO accounts VALUES (1), (2)');
    await db.pool.query("INSERT INTO account_memberships VALUES (1, now() + interval '1 day')");
    await db.pool.query(
      `INSERT INTO characters (id, account_id, realm, name, level, state)
      VALUES (10, 1, $1, 'Alt', 5, $2::jsonb), (20, 1, $1, 'Source', 5, $3::jsonb)`,
      [realm, JSON.stringify(target()), JSON.stringify(actor())],
    );
    await db.pool.query(
      `INSERT INTO character_leases VALUES (20, $1, 'source-nonce', now() + interval '1 minute')`,
      [db.PROCESS_LEASE_HOLDER],
    );
  });
  afterAll(async () => {
    await db?.pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
  });

  async function waitForLockWaiter(): Promise<void> {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const found = await admin.query(`SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%ORDER BY id FOR UPDATE%'`);
      if (found.rows.length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('bank transfer did not reach held character lock');
  }
  async function release(client: PoolClient): Promise<void> {
    await client.query('ROLLBACK');
    client.release();
  }

  it('commits both blobs, the bank ledger, and exact material source journal atomically', async () => {
    expect(await banks.transferMembershipBank(input())).toMatchObject({
      ok: true,
      value: { moved: 3 },
    });
    const states = await db.pool.query('SELECT id, state FROM characters ORDER BY id');
    expect(states.rows[0].state).toEqual({
      ...target(),
      bank: { inventory: [item], purchasedSlots: 0, bonusSlots: 0 },
    });
    expect(states.rows[1].state.inventory).toEqual([]);
    expect((await db.pool.query('SELECT character_id, op, count FROM bank_ledger')).rows).toEqual([
      { character_id: 10, op: 'deposit', count: 3 },
    ]);
    expect(
      (await db.pool.query('SELECT owner_id, movements FROM material_source_journal')).rows,
    ).toEqual([expect.objectContaining({ owner_id: '10', movements: expect.any(Array) })]);
  });

  it('refuses a login lease committed while the transfer waited for the target row', async () => {
    const blocker = await db.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM characters WHERE id = 10 FOR UPDATE');
      const transfer = banks.transferMembershipBank(input());
      await waitForLockWaiter();
      await blocker.query(
        `INSERT INTO character_leases VALUES (10, 'peer', 'login', now() + interval '1 minute')`,
      );
      await blocker.query('COMMIT');
      expect(await transfer).toEqual({ ok: false, error: 'online' });
      expect(
        (await db.pool.query('SELECT state FROM characters WHERE id = 20')).rows[0].state.inventory,
      ).toEqual([item]);
      expect((await db.pool.query('SELECT * FROM bank_ledger')).rows).toEqual([]);
    } finally {
      await release(blocker);
    }
  });

  it('retires an expired target nonce so heartbeat cannot revive stale loaded state', async () => {
    await db.pool.query(
      `INSERT INTO character_leases VALUES (10, 'stale', 'expired', now() - interval '1 second')`,
    );
    expect(await banks.transferMembershipBank(input())).toMatchObject({ ok: true });
    expect(
      (
        await db.pool.query(`UPDATE character_leases SET expires_at = now() + interval '1 minute'
      WHERE character_id = 10 AND holder = 'stale' RETURNING character_id`)
      ).rows,
    ).toEqual([]);
  });

  it('bounds a held account lock and leaves the pool usable after rollback', async () => {
    const blocker = await db.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM accounts WHERE id = 1 FOR UPDATE');
      const started = performance.now();
      await expect(banks.transferMembershipBank(input())).rejects.toMatchObject({ code: '55P03' });
      const elapsed = performance.now() - started;
      // The production 2s lock timeout must win over its 5s statement timeout
      // and 10s transaction deadline, while tolerating scheduling overhead.
      expect(elapsed).toBeGreaterThanOrEqual(1800);
      expect(elapsed).toBeLessThan(4500);
      expect((await db.pool.query('SELECT 1 AS usable')).rows).toEqual([{ usable: 1 }]);
      const states = await db.pool.query('SELECT state FROM characters ORDER BY id');
      expect(states.rows[0].state).toEqual(target());
      expect(states.rows[1].state.inventory).toEqual([item]);
      expect((await db.pool.query('SELECT * FROM bank_ledger')).rows).toEqual([]);
      expect((await db.pool.query('SELECT * FROM material_source_journal')).rows).toEqual([]);
    } finally {
      await release(blocker);
    }
    // Reusing the production path also proves that rollback released all
    // transfer locks and did not strand a connection in an aborted transaction.
    expect(await banks.transferMembershipBank(input())).toMatchObject({ ok: true });
  }, 10_000);

  it('fences an actor whose nonce rotated while the transfer waited on character rows', async () => {
    const blocker = await db.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM characters WHERE id = 20 FOR UPDATE');
      const transfer = banks.transferMembershipBank(input());
      await waitForLockWaiter();
      await blocker.query(
        `UPDATE character_leases SET nonce = 'new-session' WHERE character_id = 20`,
      );
      await blocker.query('COMMIT');
      expect(await transfer).toEqual({ ok: false, error: 'lease_lost' });
      expect((await db.pool.query('SELECT * FROM bank_ledger')).rows).toEqual([]);
    } finally {
      await release(blocker);
    }
  });

  it('rolls the actor back when the transactional bank ledger refuses its insert', async () => {
    await db.pool.query(
      'ALTER TABLE bank_ledger ADD CONSTRAINT refuse_bank_transfer CHECK (false)',
    );
    try {
      await expect(banks.transferMembershipBank(input())).rejects.toMatchObject({ code: '23514' });
      const states = await db.pool.query('SELECT state FROM characters ORDER BY id');
      expect(states.rows[0].state).toEqual(target());
      expect(states.rows[1].state.inventory).toEqual([item]);
      expect((await db.pool.query('SELECT * FROM material_source_journal')).rows).toEqual([]);
    } finally {
      await db.pool.query('ALTER TABLE bank_ledger DROP CONSTRAINT refuse_bank_transfer');
    }
  });
});
