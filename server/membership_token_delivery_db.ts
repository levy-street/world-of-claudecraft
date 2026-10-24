// Keep paid receipts forever: deleting a receipt permits a settled payment to mint
// again after collection, character deletion, or restoration of an older save.
// Growth is one small row per paid token order or annual reward, with primary-key-only lookup.

import {
  MEMBERSHIP_ANNUAL_REINS,
  MEMBERSHIP_ANNUAL_REWARD_SKU,
} from '../src/membership_annual_contract';
import { MEMBERSHIP_TOKEN_SKU } from '../src/membership_token_contract';
import { pool } from './db';
import { type CustodyParcelRow, insertCustodyParcelRowIn } from './mail_custody_overlay';
import type { MembershipTokenRecipient } from './membership_token_store';
import { REALM } from './realm';

export const MEMBERSHIP_TOKEN_RECEIPTS_SCHEMA = `
-- Keep forever for paid receipt replay protection, including after character deletion.
CREATE TABLE IF NOT EXISTS membership_token_receipts (
  receipt_id TEXT PRIMARY KEY,
  account_id BIGINT NOT NULL,
  character_id BIGINT NOT NULL,
  realm TEXT NOT NULL,
  sku TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
export interface MembershipTokenDeliveryClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(): void;
}
export interface MembershipTokenDeliveryPool {
  connect(): Promise<MembershipTokenDeliveryClient>;
}

/** The transaction may be durable, but this caller has never live-booked it.
 * Only this fresh-insert COMMIT boundary provides safe process-local recovery proof. */
export class MembershipTokenCommitUncertain extends Error {
  constructor(
    readonly parcel: CustodyParcelRow,
    cause: unknown,
  ) {
    super('Membership token commit acknowledgement lost', { cause });
  }
}

/** Return a newly durable parcel for live booking, null for an already paid order.
 * Caller must serialize live booking with the realm's mail writer and call
 * confirmCustodyParcelBooked only after booking. A crash replays the overlay at boot. */
export async function persistMembershipTokenDelivery(
  accountId: number,
  recipient: MembershipTokenRecipient,
  receiptId: string,
  db: MembershipTokenDeliveryPool = pool,
): Promise<CustodyParcelRow | null> {
  return persistMembershipRewardDelivery(accountId, recipient, receiptId, 'token', db);
}

export async function persistMembershipAnnualDelivery(
  accountId: number,
  recipient: MembershipTokenRecipient,
  receiptId: string,
  db: MembershipTokenDeliveryPool = pool,
): Promise<CustodyParcelRow | null> {
  return persistMembershipRewardDelivery(accountId, recipient, receiptId, 'annual', db);
}

/** The two fixed server rewards share custody mechanics, never caller-selected items. */
async function persistMembershipRewardDelivery(
  accountId: number,
  recipient: MembershipTokenRecipient,
  receiptId: string,
  kind: 'token' | 'annual',
  db: MembershipTokenDeliveryPool,
): Promise<CustodyParcelRow | null> {
  if (
    !Number.isSafeInteger(accountId) ||
    accountId <= 0 ||
    !Number.isSafeInteger(recipient.characterId) ||
    recipient.characterId <= 0 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(receiptId)
  )
    throw new Error('Invalid membership receipt');
  const annual = kind === 'annual';
  const sku = annual ? MEMBERSHIP_ANNUAL_REWARD_SKU : MEMBERSHIP_TOKEN_SKU;
  const parcel: CustodyParcelRow = {
    custodyRef: `membership-${annual ? 'annual' : 'token'}:${receiptId}`,
    recipient: { key: String(recipient.characterId), name: recipient.name },
    letter: annual ? 'membership_annual' : 'membership_token',
    items: [{ itemId: annual ? MEMBERSHIP_ANNUAL_REINS : 'membership_token', count: 1 }],
  };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    const owner = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [
      accountId,
    ]);
    if (owner.rows.length !== 1) throw new Error('Membership account missing');
    const character = await client.query(
      'SELECT id FROM characters WHERE id = $1 AND account_id = $2 AND realm = $3 FOR UPDATE',
      [recipient.characterId, accountId, REALM],
    );
    if (character.rows.length !== 1) throw new Error('Membership character missing');
    const inserted = await client.query(
      `INSERT INTO membership_token_receipts (receipt_id, account_id, character_id, realm, sku)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (receipt_id) DO NOTHING`,
      [receiptId, accountId, recipient.characterId, REALM, sku],
    );
    if (inserted.rowCount === 0) {
      const previous = await client.query(
        `SELECT receipt_id FROM membership_token_receipts
         WHERE receipt_id = $1 AND account_id = $2 AND character_id = $3 AND realm = $4 AND sku = $5`,
        [receiptId, accountId, recipient.characterId, REALM, sku],
      );
      if (previous.rows.length !== 1) throw new Error('Membership receipt identity mismatch');
      await client.query('COMMIT');
      return null;
    }
    await insertCustodyParcelRowIn((sql, values) => client.query(sql, values), parcel);
    try {
      await client.query('COMMIT');
    } catch (error) {
      throw new MembershipTokenCommitUncertain(parcel, error);
    }
    return parcel;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
