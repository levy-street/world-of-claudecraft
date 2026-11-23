import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAIL_CUSTODY_PARCELS_SCHEMA } from '../server/mail_custody_overlay';
import { createMembershipTokenDelivery } from '../server/membership_token_delivery';
import {
  MEMBERSHIP_TOKEN_RECEIPTS_SCHEMA,
  persistMembershipAnnualDelivery,
  persistMembershipTokenDelivery,
} from '../server/membership_token_delivery_db';
import { REALM } from '../server/realm';

const url = process.env.TEST_DATABASE_URL;
const schema = `membership_token_verify_${process.pid}`;
describe.skipIf(!url)('membership token delivery (real Postgres)', () => {
  let admin: Pool;
  let db: Pool;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, max: 3, options: `-c search_path=${schema}` });
    await db.query('CREATE TABLE accounts (id BIGINT PRIMARY KEY)');
    await db.query(
      'CREATE TABLE characters (id BIGINT PRIMARY KEY, account_id BIGINT NOT NULL, realm TEXT NOT NULL)',
    );
    await db.query(
      `CREATE TABLE account_mount_cosmetics (
         account_id BIGINT PRIMARY KEY,
         skin_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
    );
    await db.query(MEMBERSHIP_TOKEN_RECEIPTS_SCHEMA);
    await db.query(MAIL_CUSTODY_PARCELS_SCHEMA);
    await db.query('INSERT INTO accounts VALUES (7), (8)');
    await db.query('INSERT INTO characters VALUES (13, 7, $1), (14, 8, $1)', [REALM]);
  });
  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  it('concurrent paid receipt retries mint one parcel and never remint after collection', async () => {
    const input = { characterId: 13, name: 'Alice' };
    const results = await Promise.all([
      persistMembershipTokenDelivery(7, input, 'receipt-race-123456', db),
      persistMembershipTokenDelivery(7, input, 'receipt-race-123456', db),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.query('SELECT items FROM mail_custody_parcels')).rows).toEqual([
      { items: [{ itemId: 'membership_token', count: 1 }] },
    ]);
    await db.query('DELETE FROM mail_custody_parcels');
    expect(await persistMembershipTokenDelivery(7, input, 'receipt-race-123456', db)).toBeNull();
    expect((await db.query('SELECT count(*) AS n FROM mail_custody_parcels')).rows[0].n).toBe('0');
    await expect(
      persistMembershipTokenDelivery(
        8,
        { characterId: 14, name: 'Bob' },
        'receipt-race-123456',
        db,
      ),
    ).rejects.toThrow('identity mismatch');
  });
  it('rolls the paid receipt back if its custody parcel cannot be committed', async () => {
    const receipt = 'receipt-conflict-123456';
    await db.query(
      `INSERT INTO mail_custody_parcels
      (custody_ref, realm, recipient_key, recipient_name, letter, items)
      VALUES ($1, $2, 'wrong', 'Wrong', 'delivery', '[]'::jsonb)`,
      [`membership-token:${receipt}`, REALM],
    );
    await expect(
      persistMembershipTokenDelivery(7, { characterId: 13, name: 'Alice' }, receipt, db),
    ).rejects.toThrow('Conflicting');
    expect(
      (
        await db.query('SELECT receipt_id FROM membership_token_receipts WHERE receipt_id = $1', [
          receipt,
        ])
      ).rows,
    ).toEqual([]);
  });
  it('refuses a non-owned character before minting a paid receipt', async () => {
    await expect(
      persistMembershipTokenDelivery(
        7,
        { characterId: 14, name: 'Bob' },
        'receipt-bola-123456',
        db,
      ),
    ).rejects.toThrow('character missing');
  });
  it('annual reward retries create one permanent soulbound Chimaera parcel and cannot cross token identity', async () => {
    const recipient = { characterId: 13, name: 'Alice' };
    const receipt = 'annual-receipt-race-123456';
    const result = await Promise.all([
      persistMembershipAnnualDelivery(7, recipient, receipt, db),
      persistMembershipAnnualDelivery(7, recipient, receipt, db),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect(result.find(Boolean)).toMatchObject({
      letter: 'membership_annual',
      items: [{ itemId: 'reins_nightwing_chimera', count: 1 }],
    });
    await expect(persistMembershipTokenDelivery(7, recipient, receipt, db)).rejects.toThrow(
      'identity mismatch',
    );
    await expect(
      persistMembershipAnnualDelivery(8, { characterId: 14, name: 'Bob' }, receipt, db),
    ).rejects.toThrow('identity mismatch');
    await db.query('DELETE FROM mail_custody_parcels WHERE custody_ref = $1', [
      `membership-annual:${receipt}`,
    ]);
    expect(await persistMembershipAnnualDelivery(7, recipient, receipt, db)).toBeNull();
    expect(
      (
        await db.query('SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = $1', [
          `membership-annual:${receipt}`,
        ])
      ).rows,
    ).toEqual([]);
  });
  it('unlocks the annual mount account-wide and mails the reins only for the first receipt', async () => {
    const recipient = { characterId: 14, name: 'Bob' };
    const mounts = async () =>
      (await db.query('SELECT skin_ids FROM account_mount_cosmetics WHERE account_id = 8')).rows[0]
        ?.skin_ids;
    expect(
      await persistMembershipAnnualDelivery(8, recipient, 'annual-receipt-first-123456', db),
    ).toMatchObject({ items: [{ itemId: 'reins_nightwing_chimera', count: 1 }] });
    expect(await mounts()).toEqual(['nightwing_chimera']);
    // A stacked annual purchase adds time only: no second reins, no duplicate unlock.
    expect(
      await persistMembershipAnnualDelivery(8, recipient, 'annual-receipt-stack-123456', db),
    ).toBeNull();
    expect(await mounts()).toEqual(['nightwing_chimera']);
    expect(
      (
        await db.query('SELECT custody_ref FROM mail_custody_parcels WHERE custody_ref = $1', [
          'membership-annual:annual-receipt-stack-123456',
        ])
      ).rows,
    ).toEqual([]);
  });
  it('backfills the mount entitlement idempotently for every account with an annual receipt', async () => {
    await db.query('DELETE FROM account_mount_cosmetics');
    await db.query(
      `INSERT INTO account_mount_cosmetics (account_id, skin_ids) VALUES (8, '["rickshaw_mount"]')`,
    );
    await db.query(MEMBERSHIP_TOKEN_RECEIPTS_SCHEMA);
    await db.query(MEMBERSHIP_TOKEN_RECEIPTS_SCHEMA);
    expect(
      (await db.query('SELECT account_id, skin_ids FROM account_mount_cosmetics ORDER BY 1')).rows,
    ).toEqual([
      { account_id: '7', skin_ids: ['nightwing_chimera'] },
      { account_id: '8', skin_ids: ['rickshaw_mount', 'nightwing_chimera'] },
    ]);
  });
  it('recovers live delivery after PostgreSQL commits but the acknowledgement is lost', async () => {
    let loseCommit = true;
    const transport = {
      connect: async () => {
        const client = await db.connect();
        return {
          release: () => client.release(),
          query: async (sql: string, values?: unknown[]) => {
            const result = await client.query(sql, values);
            if (sql === 'COMMIT' && loseCommit) {
              loseCommit = false;
              throw new Error('connection lost after commit');
            }
            return result;
          },
        };
      },
    };
    const book = vi.fn(() => true);
    const immediate = <T>(job: () => Promise<T>) => job();
    const deliver = createMembershipTokenDelivery({
      mailWrite: immediate,
      database: immediate,
      book,
      persist: (account, recipient, receipt) =>
        persistMembershipTokenDelivery(account, recipient, receipt, transport),
    });
    const receipt = 'receipt-commit-loss-123456';
    const recipient = { characterId: 13, name: 'Alice' };
    expect(await deliver(7, recipient, receipt)).toBe(false);
    expect(book).not.toHaveBeenCalled();
    expect(
      (
        await db.query('SELECT receipt_id FROM membership_token_receipts WHERE receipt_id = $1', [
          receipt,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(await deliver(7, recipient, receipt)).toBe(true);
    expect(book).toHaveBeenCalledTimes(1);
    await db.query('DELETE FROM mail_custody_parcels WHERE custody_ref = $1', [
      `membership-token:${receipt}`,
    ]);
    expect(await deliver(7, recipient, receipt)).toBe(true);
    expect(book).toHaveBeenCalledTimes(1);
  });
});
