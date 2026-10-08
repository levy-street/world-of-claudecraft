import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../server/db', () => ({
  runWithStatementTimeout: (_ms: number, run: (q: typeof bridge.query) => unknown) =>
    run(bridge.query),
}));

import { REALM } from '../server/realm';
import {
  claimReportRewardDelivery,
  createReportRewardsIn,
  dueReportRewards,
  REPORT_REWARDS_SCHEMA,
} from '../server/report_rewards_db';

const URL = process.env.TEST_DATABASE_URL;
const VERIFY_SCHEMA = `report_rewards_verify_${randomUUID().replaceAll('-', '')}`;
describe.skipIf(!URL)('report rewards (real PostgreSQL)', () => {
  let pool: Pool;
  let client: PoolClient;
  beforeAll(async () => {
    pool = new Pool({ connectionString: URL, max: 3 });
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${VERIFY_SCHEMA}`);
    await client.query(`SET search_path = ${VERIFY_SCHEMA}`);
    await client.query(`CREATE TABLE characters (id INTEGER PRIMARY KEY, account_id INTEGER, realm TEXT, name TEXT);
      CREATE TABLE player_reports (id INTEGER PRIMARY KEY, reporter_account_id INTEGER,
        reporter_character_id INTEGER, reported_account_id INTEGER, status TEXT);
      CREATE TABLE mail_custody_parcels (custody_ref TEXT PRIMARY KEY, realm TEXT,
        recipient_key TEXT, recipient_name TEXT, letter TEXT, items JSONB, copper BIGINT);
      ${REPORT_REWARDS_SCHEMA}`);
    await client.query(
      `INSERT INTO characters VALUES (10, 1, $1, 'Reporter'), (11, 1, 'other', 'Other'), (20, 2, 'other', 'Second');
      `,
      [REALM],
    );
    await client.query(`INSERT INTO player_reports VALUES
      (1, 1, 10, 9, 'open'), (2, 1, 10, 9, 'actioned'), (3, 2, 20, 9, 'actioned'),
      (4, NULL, NULL, 9, 'open'), (5, 9, NULL, 9, 'open'), (6, 3, NULL, 9, 'open')`);
    bridge.query.mockImplementation((text, values) => client.query(text, values));
  });
  afterAll(async () => {
    await client?.query('ROLLBACK');
    await client?.query(`DROP SCHEMA ${VERIFY_SCHEMA} CASCADE`);
    client?.release();
    await pool?.end();
  });

  it('deduplicates reporter accounts and uses actual character realms including historical reports', async () => {
    await createReportRewardsIn((text, values) => client.query(text, values), 9);
    await createReportRewardsIn((text, values) => client.query(text, values), 9);
    const rows = (
      await client.query(
        'SELECT reporter_account_id, character_id, realm FROM report_rewards ORDER BY reporter_account_id',
      )
    ).rows;
    expect(rows).toEqual([
      { reporter_account_id: 1, character_id: 10, realm: REALM },
      { reporter_account_id: 2, character_id: 20, realm: 'other' },
    ]);
    expect((await client.query('SELECT * FROM mail_custody_parcels')).rows).toHaveLength(0);
  });

  it('books once, keeps custody durable, and never recreates it after collection bake', async () => {
    const id = Number(
      (await client.query('SELECT id FROM report_rewards WHERE reporter_account_id = 1')).rows[0]
        .id,
    );
    expect(await claimReportRewardDelivery(id)).toBe(true);
    const parcel = (await client.query('SELECT * FROM mail_custody_parcels')).rows[0];
    expect(parcel.copper).toBe('0');
    expect(parcel.items).toEqual([]);
    expect(parcel.realm).toBe(REALM);
    await client.query('DELETE FROM mail_custody_parcels');
    expect(await claimReportRewardDelivery(id)).toBe(false);
    await createReportRewardsIn((text, values) => client.query(text, values), 9);
    expect((await client.query('SELECT * FROM mail_custody_parcels')).rows).toHaveLength(0);
  });

  it('rolls claims back with an unsuccessful ban transaction', async () => {
    await client.query('BEGIN');
    await client.query('SAVEPOINT failed_ban');
    await client.query("INSERT INTO player_reports VALUES (7, 1, 10, 10, 'open')");
    await createReportRewardsIn((text, values) => client.query(text, values), 10);
    expect(
      (await client.query('SELECT * FROM report_rewards WHERE reported_account_id = 10')).rows,
    ).toHaveLength(1);
    await client.query('ROLLBACK TO SAVEPOINT failed_ban');
    expect(
      (await client.query('SELECT * FROM report_rewards WHERE reported_account_id = 10')).rows,
    ).toHaveLength(0);
    await client.query('ROLLBACK');
  });

  it('concurrent claim transactions produce only one reward for the account pair', async () => {
    await client.query("INSERT INTO player_reports VALUES (8, 1, 10, 11, 'open')");
    const claim = async () => {
      const connection = await pool.connect();
      try {
        await connection.query(`SET search_path = ${VERIFY_SCHEMA}`);
        await connection.query('BEGIN');
        await createReportRewardsIn((text, values) => connection.query(text, values), 11);
        await connection.query('COMMIT');
      } catch (err) {
        await connection.query('ROLLBACK');
        throw err;
      } finally {
        connection.release();
      }
    };
    await Promise.all([claim(), claim()]);
    expect(
      (await client.query('SELECT * FROM report_rewards WHERE reported_account_id = 11')).rows,
    ).toHaveLength(1);
  });

  it('reroutes an unbooked reward after its selected character was deleted', async () => {
    await client.query('DELETE FROM characters WHERE id = 20');
    await client.query("INSERT INTO characters VALUES (21, 2, 'fallback-realm', 'Replacement')");
    await client.query('UPDATE report_rewards SET realm = $1 WHERE reporter_account_id = 2', [
      REALM,
    ]);
    const due = await dueReportRewards();
    expect(due.some((row) => row.accountId === 2)).toBe(false);
    const row = (
      await client.query(
        'SELECT character_id, realm, recipient_name, booked_at FROM report_rewards WHERE reporter_account_id = 2',
      )
    ).rows[0];
    expect(row).toEqual({
      character_id: 21,
      realm: 'fallback-realm',
      recipient_name: 'Replacement',
      booked_at: null,
    });
    const id = Number(
      (await client.query('SELECT id FROM report_rewards WHERE reporter_account_id = 2')).rows[0]
        .id,
    );
    expect(await claimReportRewardDelivery(id)).toBe(false); // Only its actual realm can book it.
  });

  it('prefers a valid reported character and falls back when the report character is missing', async () => {
    await client.query(`INSERT INTO characters VALUES
      (40, 5, 'first-realm', 'First'), (41, 5, 'preferred-realm', 'Preferred'),
      (50, 6, 'fallback-realm', 'Fallback')`);
    await client.query(`INSERT INTO player_reports VALUES
      (10, 5, 999, 12, 'open'), (11, 5, 41, 12, 'actioned'),
      (12, 6, 999, 12, 'open')`);
    await createReportRewardsIn((text, values) => client.query(text, values), 12);
    const rows = (
      await client.query(
        'SELECT reporter_account_id, character_id, realm FROM report_rewards WHERE reported_account_id = 12 ORDER BY reporter_account_id',
      )
    ).rows;
    expect(rows).toEqual([
      { reporter_account_id: 5, character_id: 41, realm: 'preferred-realm' },
      { reporter_account_id: 6, character_id: 50, realm: 'fallback-realm' },
    ]);
  });

  it("excludes ignored reports and never uses another account's reported character", async () => {
    await client.query(`INSERT INTO characters VALUES
      (70, 7, 'owner-realm', 'Owned'), (80, 8, 'ignored-realm', 'Ignored')`);
    await client.query(`INSERT INTO player_reports VALUES
      (13, 7, 10, 13, 'open'), (14, 8, 80, 13, 'ignored')`);
    await createReportRewardsIn((text, values) => client.query(text, values), 13);
    const rows = (
      await client.query(
        'SELECT reporter_account_id, character_id, realm FROM report_rewards WHERE reported_account_id = 13',
      )
    ).rows;
    expect(rows).toEqual([{ reporter_account_id: 7, character_id: 70, realm: 'owner-realm' }]);
  });
});
