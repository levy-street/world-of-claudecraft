import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const binding = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock('../../server/db', () => ({
  pool: { query: (sql: string, values?: unknown[]) => binding.pool!.query(sql, values) },
}));

import {
  REFERRAL_ARMOUR_SCHEMA,
  recordReferral,
  referralArmourForAccount,
  referralInviterForSlug,
} from '../../server/referral_armour_db';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('permanent referral entitlement PostgreSQL migration', () => {
  const schema = `referral_armour_test_${process.pid}`;
  const admin = new Pool({ connectionString: url, max: 1 });
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    binding.pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
    await binding.pool.query(`CREATE TABLE referrals (
      referee_account_id INT PRIMARY KEY, referrer_account_id INT NOT NULL,
      slug TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await binding.pool.query("INSERT INTO referrals VALUES (1, 10, 'legacy')");
    await binding.pool.query(REFERRAL_ARMOUR_SCHEMA);
    await binding.pool.query(REFERRAL_ARMOUR_SCHEMA);
  });
  afterAll(async () => {
    await binding.pool?.end();
    binding.pool = null;
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it('never retroactively awards old rows, including retried attribution', async () => {
    await recordReferral(1, 20, 'new-member', true, 'New Member');
    expect(await referralArmourForAccount(1)).toBeNull();
    const row = (await binding.pool!.query('SELECT * FROM referrals WHERE referee_account_id = 1'))
      .rows[0];
    expect(row).toMatchObject({
      referrer_account_id: 10,
      slug: 'legacy',
      member_eligible: false,
      inviter_name: '',
    });
  });

  it('keeps the first membership/name snapshot after later conflicting captures', async () => {
    await recordReferral(2, 10, 'aldric', true, 'Aldric');
    await recordReferral(2, 20, 'other', false, 'Other');
    await recordReferral(2, 10, 'aldric-renamed', false, 'Renamed');
    expect(await referralArmourForAccount(2)).toEqual({
      inviterAccountId: 10,
      inviterName: 'Aldric',
    });
  });

  it('keeps the stored name within the schema bound', async () => {
    await recordReferral(3, 10, 'long', true, 'x'.repeat(80));
    expect((await referralArmourForAccount(3))?.inviterName).toHaveLength(32);
  });

  it('keeps an old writer first attribution when a new writer races behind its transaction', async () => {
    const oldWriter = await binding.pool!.connect();
    try {
      await oldWriter.query('BEGIN');
      await oldWriter.query(
        "INSERT INTO referrals (referee_account_id, referrer_account_id, slug) VALUES (4, 10, 'old')",
      );
      const newer = recordReferral(4, 20, 'new', true, 'New Member');
      await oldWriter.query('COMMIT');
      await newer;
      expect(await referralArmourForAccount(4)).toBeNull();
      const row = (
        await binding.pool!.query('SELECT * FROM referrals WHERE referee_account_id = 4')
      ).rows[0];
      expect(row).toMatchObject({
        referrer_account_id: 10,
        slug: 'old',
        member_eligible: false,
        inviter_name: '',
      });
    } finally {
      oldWriter.release();
    }
  });

  it('retains a new writer grant against later old-binary inserts', async () => {
    await recordReferral(5, 10, 'new', true, 'Aldric');
    await binding.pool!.query(`INSERT INTO referrals (referee_account_id, referrer_account_id, slug)
      VALUES (5, 20, 'old') ON CONFLICT (referee_account_id) DO NOTHING`);
    expect(await referralArmourForAccount(5)).toEqual({
      inviterAccountId: 10,
      inviterName: 'Aldric',
    });
  });

  it('uses the primary key with the normal planner on a grown referral table', async () => {
    await binding.pool!.query(`INSERT INTO referrals (referee_account_id, referrer_account_id, slug, member_eligible, inviter_name)
      SELECT id, 10, 'seed', true, 'Aldric' FROM generate_series(100, 10100) AS id`);
    await binding.pool!.query('ANALYZE referrals');
    const result = await binding.pool!.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT referrer_account_id, inviter_name FROM referrals
      WHERE referee_account_id = $1 AND member_eligible = true`,
      [5000],
    );
    const plan = result.rows[0]['QUERY PLAN'][0].Plan;
    expect(plan['Node Type']).toBe('Index Scan');
    expect(plan['Index Name']).toBe('referrals_pkey');
    expect(plan['Actual Rows']).toBe(1);
    expect(plan['Shared Hit Blocks']).toBeLessThan(10);
  });

  it('resolves a slug through unique card and character indexes without reading image or state blobs', async () => {
    await binding.pool!.query(`CREATE TABLE characters (id INT PRIMARY KEY, account_id INT NOT NULL, name TEXT NOT NULL, state JSONB);
      CREATE TABLE player_cards (slug TEXT PRIMARY KEY, account_id INT NOT NULL, character_id INT NOT NULL, png BYTEA);
      INSERT INTO characters SELECT id, id, 'Inviter', '{}'::jsonb FROM generate_series(1,10001) id;
      INSERT INTO player_cards SELECT 'card-' || id, id, id, NULL FROM generate_series(1,10001) id;
      ANALYZE characters; ANALYZE player_cards;`);
    expect(await referralInviterForSlug('card-5000')).toEqual({
      inviterAccountId: 5000,
      inviterName: 'Inviter',
    });
    const result = await binding.pool!.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT p.account_id, c.name FROM player_cards p
      JOIN characters c ON c.id = p.character_id AND c.account_id = p.account_id
      WHERE p.slug = $1`,
      ['card-5000'],
    );
    const plan = result.rows[0]['QUERY PLAN'][0].Plan;
    expect(plan['Node Type']).toBe('Nested Loop');
    expect(plan['Actual Rows']).toBe(1);
    expect(plan.Plans.map((child: Record<string, unknown>) => child['Index Name']).sort()).toEqual([
      'characters_pkey',
      'player_cards_pkey',
    ]);
    expect(plan['Shared Hit Blocks']).toBeLessThan(12);
  });
});
