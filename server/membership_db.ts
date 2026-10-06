import type { PoolClient } from 'pg';
import { MEMBERSHIP_ITEM_DURATION_MS } from '../src/membership_contract';
import { pool } from './db';

// Bounded lifetime state: one row per account, removed on account deletion. No event ledger.
export const MEMBERSHIP_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_memberships (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  prepaid_until TIMESTAMPTZ NOT NULL
);
ALTER TABLE characters ADD COLUMN IF NOT EXISTS membership_slot BOOLEAN NOT NULL DEFAULT false;
`;

type MembershipReader = Pick<PoolClient, 'query'>;

function expiryMs(value: unknown): number | null {
  const expiry = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(expiry) ? expiry : null;
}

export async function prepaidMembershipExpiresAt(accountId: number): Promise<number | null> {
  const result = await pool.query(
    'SELECT prepaid_until FROM account_memberships WHERE account_id = $1',
    [accountId],
  );
  return expiryMs(result.rows[0]?.prepaid_until);
}

/** Caller holds the account row FOR UPDATE first. Never calls a remote service. */
export async function membershipExpiresAtOnClient(
  client: MembershipReader,
  accountId: number,
  trustedRecurringExpiresAt: number | null,
): Promise<number | null> {
  const result = await client.query(
    'SELECT prepaid_until FROM account_memberships WHERE account_id = $1',
    [accountId],
  );
  const prepaid = expiryMs(result.rows[0]?.prepaid_until);
  const recurring = Number.isFinite(trustedRecurringExpiresAt) ? trustedRecurringExpiresAt : null;
  return prepaid === null && recurring === null ? null : Math.max(prepaid ?? 0, recurring ?? 0);
}

/** Part of the caller's inventory-consumption transaction; account lock must already be held. */
export async function extendPrepaidMembershipOnClient(
  client: MembershipReader,
  accountId: number,
  trustedRecurringExpiresAt: number | null,
  nowMs: number,
): Promise<number> {
  if (!Number.isFinite(nowMs)) throw new Error('invalid membership clock');
  const current = await membershipExpiresAtOnClient(client, accountId, trustedRecurringExpiresAt);
  const expiresAt = Math.max(nowMs, current ?? 0) + MEMBERSHIP_ITEM_DURATION_MS;
  await client.query(
    `INSERT INTO account_memberships (account_id, prepaid_until) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET prepaid_until = EXCLUDED.prepaid_until`,
    [accountId, new Date(expiresAt)],
  );
  return expiresAt;
}
