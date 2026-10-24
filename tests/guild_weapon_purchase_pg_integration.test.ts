// Real transactions in a private schema; never touch the developer game schema.
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PaidGuildCreateDeps } from '../server/guild_create_db';
import type { GuildWeaponPurchaseSave } from '../server/guild_weapon_purchase_db';
import type { CharacterState } from '../src/sim/character_state';
import {
  LANTERN_HALL_SWORD_SKIN_ID,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';

const url = process.env.TEST_DATABASE_URL;
const schema = 'guild_weapon_purchase_verify';
const d = url ? describe : describe.skip;
d('guild weapon atomic purchase on PostgreSQL', () => {
  let pool: Pool;
  let purchase: typeof import('../server/guild_weapon_purchase_db').purchaseGuildWeaponAtomic;
  let holder: string;
  let realm: string;
  const state = (seals: number) =>
    ({
      level: 1,
      xp: 0,
      copper: 0,
      hp: 100,
      resource: 100,
      pos: { x: 1, z: 2 },
      facing: 0,
      equipment: {},
      inventory: [{ itemId: LANTERN_SEAL_ITEM_ID, count: seals }],
      questLog: [],
      questsDone: [],
    }) as CharacterState;
  const args = (id = 41): GuildWeaponPurchaseSave => ({
    accountId: 7,
    characterId: id,
    level: 1,
    state: state(20),
    leaseNonce: `lease-${id}`,
    skinId: LANTERN_HALL_SWORD_SKIN_ID,
    storageEffects: [],
  });
  const deps = (): PaidGuildCreateDeps => ({ pool, bustGuildRoster: () => {} });
  const buy = (id = 41, signal = new AbortController().signal) =>
    purchase(args(id), signal, deps());
  const balance = async (id = 41) =>
    Number(
      (
        await pool.query(
          "SELECT state->'inventory'->0->>'count' AS seals FROM characters WHERE id=$1",
          [id],
        )
      ).rows[0].seals,
    );
  const skins = async () =>
    (await pool.query('SELECT skin_ids FROM account_weapon_cosmetics WHERE account_id=7')).rows[0]
      ?.skin_ids ?? [];
  beforeAll(async () => {
    const pg = await import('pg');
    const db = await import('../server/db');
    holder = db.PROCESS_LEASE_HOLDER;
    realm = (await import('../server/realm')).REALM;
    purchase = (await import('../server/guild_weapon_purchase_db')).purchaseGuildWeaponAtomic;
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, max: 4, options: `-c search_path=${schema}` });
    expect((await pool.query('SELECT current_schema() AS name')).rows[0].name).toBe(schema);
    await pool.query(`CREATE TABLE accounts(id INT PRIMARY KEY,cosmetics JSONB DEFAULT '{}');
      CREATE TABLE characters(id INT PRIMARY KEY,account_id INT REFERENCES accounts(id),
        level INT,realm TEXT,state JSONB,updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE character_leases(character_id INT PRIMARY KEY REFERENCES characters(id),
        realm TEXT,holder TEXT,nonce TEXT,account_id INT,expires_at TIMESTAMPTZ);
      CREATE TABLE account_weapon_cosmetics(account_id INT PRIMARY KEY REFERENCES accounts(id),
        skin_ids JSONB NOT NULL DEFAULT '[]',loadout JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now());`);
    const { MATERIAL_SOURCE_JOURNAL_SCHEMA } = await import('../server/material_source_journal_db');
    await pool.query(MATERIAL_SOURCE_JOURNAL_SCHEMA);
  }, 30_000);
  beforeEach(async () => {
    await pool.query('TRUNCATE accounts CASCADE');
    await pool.query('INSERT INTO accounts(id) VALUES(7)');
    for (const id of [41, 42]) {
      await pool.query(
        'INSERT INTO characters(id,account_id,level,realm,state) VALUES($1,7,1,$2,$3::jsonb)',
        [id, realm, JSON.stringify(state(40))],
      );
      await pool.query(
        "INSERT INTO character_leases VALUES($1,$2,$3,$4,7,now()+interval '1 hour')",
        [id, realm, holder, `lease-${id}`],
      );
    }
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });
  it('commits the charge and account grant together', async () => {
    expect(await buy()).toEqual([LANTERN_HALL_SWORD_SKIN_ID]);
    expect(await balance()).toBe(20);
    expect(await skins()).toEqual([LANTERN_HALL_SWORD_SKIN_ID]);
  });
  it('rolls back the character charge when the grant fails', async () => {
    await pool.query(
      `ALTER TABLE account_weapon_cosmetics ADD CONSTRAINT reject_grant CHECK(skin_ids='[]'::jsonb)`,
    );
    try {
      await expect(buy()).rejects.toThrow();
    } finally {
      await pool.query('ALTER TABLE account_weapon_cosmetics DROP CONSTRAINT reject_grant');
    }
    expect(await balance()).toBe(40);
    expect(await skins()).toEqual([]);
  });
  it('serializes first purchases from two sessions and charges only one', async () => {
    const outcomes = await Promise.allSettled([buy(41), buy(42)]);
    expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect([await balance(41), await balance(42)].sort()).toEqual([20, 40]);
    expect(await skins()).toEqual([LANTERN_HALL_SWORD_SKIN_ID]);
  });
  it('refuses existing durable ownership despite a stale live cache', async () => {
    await pool.query(
      'INSERT INTO account_weapon_cosmetics(account_id,skin_ids) VALUES(7,$1::jsonb)',
      [JSON.stringify([LANTERN_HALL_SWORD_SKIN_ID])],
    );
    await expect(buy()).rejects.toThrow('already owned');
    expect(await balance()).toBe(40);
  });
  it('preserves legacy ownership when creating the account row', async () => {
    await pool.query('UPDATE accounts SET cosmetics=$1::jsonb', [
      JSON.stringify({ weaponSkinIds: [LANTERN_HALL_SWORD_SKIN_ID] }),
    ]);
    await expect(buy()).rejects.toThrow('already owned');
    expect(await balance()).toBe(40);
  });
  it('a replaced lease rolls back both writes', async () => {
    await pool.query("UPDATE character_leases SET nonce='replacement' WHERE character_id=41");
    await expect(buy()).rejects.toThrow('lease lost');
    expect(await balance()).toBe(40);
    expect(await skins()).toEqual([]);
  });
  it('bounds an account lock wait and rolls back without granting', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT id FROM accounts WHERE id=7 FOR UPDATE');
    try {
      await expect(buy()).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await balance()).toBe(40);
    expect(await skins()).toEqual([]);
  });
  it('an ambiguous COMMIT can persist both halves without retrying', async () => {
    let commits = 0;
    const ambiguous: PaidGuildCreateDeps = {
      ...deps(),
      pool: {
        connect: async () => {
          const client = await pool.connect();
          return {
            query: async (text: string, values?: unknown[]) => {
              const result = await client.query(text, values);
              if (text === 'COMMIT') {
                commits++;
                throw new Error('lost COMMIT response');
              }
              return result;
            },
            release: (error?: Error | boolean) => client.release(error),
            on: (event: 'error', listener: (e: Error) => void) => client.on(event, listener),
            removeListener: (event: 'error', listener: (e: Error) => void) =>
              client.removeListener(event, listener),
          };
        },
      },
    };
    await expect(purchase(args(), new AbortController().signal, ambiguous)).rejects.toThrow(
      'lost COMMIT',
    );
    expect(commits).toBe(1);
    expect(await balance()).toBe(20);
    expect(await skins()).toEqual([LANTERN_HALL_SWORD_SKIN_ID]);
  });
});
