import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consumeAppearanceRerollOn } from '../server/appearance_redesign_db';
import { materialSourceConnection } from '../server/material_source_connection';
import { MATERIAL_SOURCE_WRITER_FUNCTION_SQL } from '../server/material_source_writer';
import {
  REDESIGN_GRANT_SCHEMA,
  type ReleaseGiftsOptions,
  runReleaseGifts,
} from '../server/release_gifts_db';

const url = process.env.TEST_DATABASE_URL;
const schema = `release_gifts_${randomBytes(8).toString('hex')}`;
const options: ReleaseGiftsOptions = {
  realm: 'Claudemoon',
  createdBefore: '2026-10-25T00:00:00Z',
  lockoutKeys: [
    'hollow_crypt',
    'hollow_crypt:heroic',
    'ignivar_raid_arena',
    'ignivar_inner_crucible:heroic',
  ],
  maxCharacters: 100,
  maxStateBytes: 1_000_000,
  apply: true,
  writersStopped: true,
};
const state = {
  copper: 123,
  membershipBag: [{ id: 'keep-me' }],
  raidLockouts: {
    hollow_crypt: 99,
    'hollow_crypt:heroic': 99,
    ignivar_raid_arena: 99,
    'ignivar_inner_crucible:heroic': 99,
    'worldboss:dragon': 88,
    'weeklyquest:weekly': 77,
    unknown: 66,
  },
};

describe.skipIf(!url)('release gifts PostgreSQL transaction', () => {
  let client: Client;
  async function connection(): Promise<Client> {
    if (!url) throw new Error('TEST_DATABASE_URL required');
    const c = new Client({ ...materialSourceConnection(url), connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query(`SET search_path TO ${schema}`);
    await c.query("SET TIME ZONE 'UTC'");
    return c;
  }
  beforeAll(async () => {
    client = await connection();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE characters (
      id serial PRIMARY KEY, account_id int NOT NULL DEFAULT 7,
      realm text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz DEFAULT now(),
      appearance jsonb DEFAULT '{}', appearance_reroll_used boolean NOT NULL DEFAULT true, state jsonb);
      CREATE TABLE world_state (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz DEFAULT now());
      CREATE TABLE character_leases (character_id int PRIMARY KEY, realm text, expires_at timestamptz)`);
    await client.query(REDESIGN_GRANT_SCHEMA);
    await client.query(REDESIGN_GRANT_SCHEMA);
    await client.query(MATERIAL_SOURCE_WRITER_FUNCTION_SQL);
    for (const table of ['characters', 'world_state']) {
      await client.query(`CREATE TRIGGER guard BEFORE INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION woc_material_source_writer_guard()`);
    }
  });
  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });
  beforeEach(async () => {
    await client.query('TRUNCATE characters, world_state, character_leases RESTART IDENTITY');
    await client.query(
      `INSERT INTO characters (realm, created_at, state) VALUES
      ('Claudemoon', '2026-10-24', $1), ('Other', '2026-10-24', $1),
      ('Claudemoon', '2026-10-25', $1), ('Claudemoon', '2026-10-24', NULL)`,
      [state],
    );
  });

  it('previews without changes, grants the cohort once, and preserves unrelated state', async () => {
    const dry = await runReleaseGifts(client, { ...options, apply: false });
    expect(dry).toMatchObject({
      characters: 2,
      redesigns: 2,
      lockoutCharacters: 1,
      applied: false,
    });
    expect((await client.query('SELECT count(*) FROM world_state')).rows[0].count).toBe('0');
    expect(
      (await client.query('SELECT appearance_reroll_granted FROM characters WHERE id = 1')).rows[0]
        .appearance_reroll_granted,
    ).toBe(false);
    expect(await runReleaseGifts(client, options)).toMatchObject({ updated: 2, applied: true });
    const rows = (await client.query('SELECT * FROM characters ORDER BY id')).rows;
    expect(rows[0].appearance_reroll_granted).toBe(true);
    expect(rows[0].state).toEqual({
      ...state,
      raidLockouts: { 'worldboss:dragon': 88, 'weeklyquest:weekly': 77, unknown: 66 },
    });
    expect(rows[1].state).toEqual(state);
    expect(rows[2].state).toEqual(state);
    expect(rows[1].appearance_reroll_granted).toBe(false);
    expect(rows[2].appearance_reroll_granted).toBe(false);
    expect(rows[3].state).toBeNull();
    await expect(runReleaseGifts(client, options)).rejects.toThrow('already applied');
  });

  it('allows exactly one concurrent redesign, with ownership and realm enforced', async () => {
    await runReleaseGifts(client, options);
    const other = await connection();
    const spend = (db: Client, realm = 'Claudemoon', owner = 7) =>
      consumeAppearanceRerollOn(
        db,
        realm,
        owner,
        1,
        { gender: 'female' },
        null,
        new Date('2026-08-24'),
      );
    try {
      expect(await spend(client, 'Other')).toBe(false);
      expect(await spend(client, 'Claudemoon', 8)).toBe(false);
      expect((await Promise.all([spend(client), spend(other)])).sort()).toEqual([false, true]);
      expect(await spend(client)).toBe(false);
      const row = (await client.query('SELECT * FROM characters WHERE id = 1')).rows[0];
      expect(row.appearance_reroll_granted).toBe(false);
      expect(row.appearance_reroll_used).toBe(true);
    } finally {
      await other.end();
    }
  });

  it('refuses active leases and workload overruns without writing a marker or grant', async () => {
    await expect(runReleaseGifts(client, { ...options, writersStopped: false })).rejects.toThrow(
      'Stop',
    );
    await expect(runReleaseGifts(client, { ...options, maxCharacters: 1 })).rejects.toThrow(
      'limits',
    );
    await expect(runReleaseGifts(client, { ...options, maxStateBytes: 1 })).rejects.toThrow(
      'limits',
    );
    await client.query(
      "INSERT INTO character_leases VALUES (1, 'Claudemoon', now() + interval '1 hour')",
    );
    await expect(runReleaseGifts(client, options)).rejects.toThrow('active leases');
    expect((await client.query('SELECT count(*) FROM world_state')).rows[0].count).toBe('0');
    expect(
      (await client.query('SELECT bool_or(appearance_reroll_granted) AS granted FROM characters'))
        .rows[0].granted,
    ).toBe(false);
  });

  it('rolls back grants if marker persistence fails, then releases the operation lock', async () => {
    await client.query(
      "ALTER TABLE world_state ADD CONSTRAINT reject_marker CHECK (key = 'impossible')",
    );
    await expect(runReleaseGifts(client, options)).rejects.toThrow('reject_marker');
    expect((await client.query('SELECT state FROM characters WHERE id = 1')).rows[0].state).toEqual(
      state,
    );
    expect(
      (await client.query('SELECT appearance_reroll_granted FROM characters WHERE id = 1')).rows[0]
        .appearance_reroll_granted,
    ).toBe(false);
    await client.query('ALTER TABLE world_state DROP CONSTRAINT reject_marker');
    expect((await runReleaseGifts(client, options)).applied).toBe(true);
  });

  it('releases row locks after the maintenance lock timeout', async () => {
    const other = await connection();
    try {
      await other.query('BEGIN');
      await other.query('SELECT id FROM characters WHERE id = 1 FOR UPDATE');
      await expect(runReleaseGifts(client, options)).rejects.toMatchObject({ code: '55P03' });
      await other.query('ROLLBACK');
      expect((await runReleaseGifts(client, options)).applied).toBe(true);
    } finally {
      await other.end();
    }
  }, 15_000);

  it('preserves legacy eligibility and consumes an unspent grant without stacking', async () => {
    await client.query(
      "UPDATE characters SET created_at = '2026-08-01Z', appearance_reroll_used = false WHERE id = 1",
    );
    const spend = () =>
      consumeAppearanceRerollOn(client, 'Claudemoon', 7, 1, {}, true, new Date('2026-08-24Z'));
    expect(await spend()).toBe(true);
    expect(await spend()).toBe(false);
    await client.query('UPDATE characters SET appearance_reroll_used = false WHERE id = 1');
    await runReleaseGifts(client, options);
    // An older consumer cannot spend the legacy arm while leaving the new grant.
    const legacy = await client.query(`UPDATE characters SET appearance_reroll_used = true
      WHERE id = 1 AND appearance_reroll_used = false
        AND (created_at < '2026-08-24T00:00:00Z' OR appearance IS NULL)`);
    expect(legacy.rowCount).toBe(0);
    expect(await spend()).toBe(true);
    expect(await spend()).toBe(false);
  });

  it('refuses overlapping operators and malformed state', async () => {
    const other = await connection();
    try {
      await other.query('BEGIN');
      await other.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        'v0.45.0-release-gifts:Claudemoon',
      ]);
      await expect(runReleaseGifts(client, options)).rejects.toThrow('already running');
      await other.query('ROLLBACK');
    } finally {
      await other.end();
    }
    await client.query(`UPDATE characters SET state = '{"raidLockouts": []}' WHERE id = 1`);
    await expect(runReleaseGifts(client, options)).rejects.toThrow('Malformed');
  });
});
