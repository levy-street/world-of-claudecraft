// Provision quotes (#475): the short-lived authorization that ties a
// stake-to-provision flow together. A quote is issued for an authed account with
// a linked wallet after name, cap, and supply/tier validation. It pins the realm
// (already created in 'provisioning'), the exact stake amount, the tier, the
// mint, and the owner wallet. The client locks exactly that amount into the
// escrow PDA for the quote's realm, then redeems the quote at /confirm, which
// verifies the finalized lock on chain and brings the realm online. Confirming
// deletes the quote; an unconfirmed quote expires and its provisioning realm is
// reclaimed (the name and the per-account slot are freed).
//
// SQL lives only in *_db.ts (see server/CLAUDE.md). amount_base is bigint base
// units, read as bigint, never coerced to a JS number.

import type { Pool, PoolClient } from 'pg';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export const REALM_QUOTE_SCHEMA = `
CREATE TABLE IF NOT EXISTS realm_quotes (
  quote_id TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm_id BIGINT NOT NULL REFERENCES realms(realm_id) ON DELETE CASCADE,
  owner_wallet TEXT NOT NULL,
  amount_base BIGINT NOT NULL,
  tier SMALLINT NOT NULL,
  mint TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realm_quotes_account ON realm_quotes(account_id);
CREATE INDEX IF NOT EXISTS realm_quotes_expires ON realm_quotes(expires_at);
`;

export interface RealmQuoteRow {
  quoteId: string;
  accountId: number;
  realmId: number;
  ownerWallet: string;
  amountBase: bigint;
  tier: number;
  mint: string;
  expiresAt: Date;
}

const COLS = `quote_id, account_id, realm_id, owner_wallet, amount_base, tier, mint, expires_at`;

function toRow(r: Record<string, unknown>): RealmQuoteRow {
  return {
    quoteId: String(r.quote_id),
    accountId: Number(r.account_id),
    realmId: Number(r.realm_id),
    ownerWallet: String(r.owner_wallet),
    amountBase: BigInt(r.amount_base as string),
    tier: Number(r.tier),
    mint: String(r.mint),
    expiresAt: r.expires_at as Date,
  };
}

export async function createRealmQuote(
  db: Queryable,
  q: {
    quoteId: string;
    accountId: number;
    realmId: number;
    ownerWallet: string;
    amountBase: bigint;
    tier: number;
    mint: string;
    expiresAt: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO realm_quotes (quote_id, account_id, realm_id, owner_wallet, amount_base, tier, mint, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [q.quoteId, q.accountId, q.realmId, q.ownerWallet, q.amountBase.toString(), q.tier, q.mint, q.expiresAt],
  );
}

export async function getRealmQuote(db: Queryable, quoteId: string): Promise<RealmQuoteRow | null> {
  const res = await db.query(`SELECT ${COLS} FROM realm_quotes WHERE quote_id = $1`, [quoteId]);
  return res.rows[0] ? toRow(res.rows[0]) : null;
}

export async function deleteRealmQuote(db: Queryable, quoteId: string): Promise<void> {
  await db.query('DELETE FROM realm_quotes WHERE quote_id = $1', [quoteId]);
}

// Open (unexpired) quotes for an account: counted toward the provisioning cap so
// a flurry of unconfirmed quotes cannot reserve more realms than allowed.
export async function countOpenQuotesForAccount(db: Queryable, accountId: number): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM realm_quotes WHERE account_id = $1 AND expires_at > now()`,
    [accountId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

// Reclaim abandoned provisioning: close any provisioning realm whose quote has
// expired (the lock never confirmed), then delete expired quotes. Frees the name
// and the per-account cap slot. Called opportunistically before issuing a quote.
export async function reclaimExpiredProvisioning(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE realms SET status = 'closed'
      WHERE status = 'provisioning'
        AND realm_id IN (SELECT realm_id FROM realm_quotes WHERE expires_at <= now())`,
  );
  await db.query('DELETE FROM realm_quotes WHERE expires_at <= now()');
}
