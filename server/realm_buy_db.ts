// Buy-a-realm persistence (#475): the SOL/USDC purchase path's two tables. A
// `realm_buy_quotes` row is the short-lived authorization (parallel to the stake
// path's realm_quotes): it pins the provisioning realm, the currency, the exact
// total, the 70/30 leg amounts, and the treasury + buyback recipient addresses.
// The client pays exactly those legs in one transaction tagged with the quoteId,
// then redeems it at /buy/confirm, which verifies the finalized split on chain and
// records a permanent `realm_purchases` row (pay_tx_sig UNIQUE = replay guard)
// while bringing the realm online. Unlike a stake there is nothing to return: a
// purchase is final, so there is no escrow/quarantine here.
//
// SQL lives only in *_db.ts (server/CLAUDE.md). All amounts are base-unit bigint
// (lamports for SOL, 1e-6 USDC), read as bigint, never coerced to a JS number.

import type { Pool, PoolClient } from 'pg';
import type { BuyCurrency } from './realm_price';

type Queryable = Pick<Pool, 'query'> | PoolClient;

export const REALM_BUY_SCHEMA = `
CREATE TABLE IF NOT EXISTS realm_buy_quotes (
  quote_id TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  realm_id BIGINT NOT NULL REFERENCES realms(realm_id) ON DELETE CASCADE,
  buyer_wallet TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_base BIGINT NOT NULL,
  treasury_base BIGINT NOT NULL,
  buyback_base BIGINT NOT NULL,
  treasury_addr TEXT NOT NULL,
  buyback_addr TEXT NOT NULL,
  tier SMALLINT NOT NULL,
  woc_base BIGINT NOT NULL,
  -- The ongoing $WOC bond the owner must keep holding for the realm's life (skin in
  -- the game on the buy path). Pinned at quote, copied to realm_bonds on confirm.
  bond_base BIGINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realm_buy_quotes_account ON realm_buy_quotes(account_id);
CREATE INDEX IF NOT EXISTS realm_buy_quotes_expires ON realm_buy_quotes(expires_at);

CREATE TABLE IF NOT EXISTS realm_purchases (
  purchase_id BIGSERIAL PRIMARY KEY,
  -- A realm is bought exactly once: UNIQUE(realm_id) makes a second payment for the
  -- same realm collide (the replay/double-charge guard, alongside pay_tx_sig).
  realm_id BIGINT NOT NULL UNIQUE REFERENCES realms(realm_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buyer_wallet TEXT NOT NULL,
  currency TEXT NOT NULL,
  total_base BIGINT NOT NULL,
  treasury_base BIGINT NOT NULL,
  buyback_base BIGINT NOT NULL,
  tier SMALLINT NOT NULL,
  pay_tx_sig TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realm_purchases_account ON realm_purchases(account_id);

-- The ongoing $WOC bond a bought realm's owner must keep holding (skin in the game).
-- One row per bought realm; the owner's CURRENT linked wallet must hold at least the
-- cumulative bond across their realms or the realm enters a grace window and then
-- lapses. grace_until is set when the wallet first falls short and cleared when it
-- recovers; an expired grace closes the realm. Separate from the immutable purchase
-- receipt so its mutable state never touches the payment record.
CREATE TABLE IF NOT EXISTS realm_bonds (
  realm_id BIGINT PRIMARY KEY REFERENCES realms(realm_id) ON DELETE CASCADE,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bond_base BIGINT NOT NULL,
  grace_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realm_bonds_account ON realm_bonds(account_id);
`;

export interface RealmBuyQuoteRow {
  quoteId: string;
  accountId: number;
  realmId: number;
  buyerWallet: string;
  currency: BuyCurrency;
  totalBase: bigint;
  treasuryBase: bigint;
  buybackBase: bigint;
  treasuryAddr: string;
  buybackAddr: string;
  tier: number;
  wocBase: bigint;
  bondBase: bigint;
  expiresAt: Date;
}

const QUOTE_COLS = `quote_id, account_id, realm_id, buyer_wallet, currency, total_base,
  treasury_base, buyback_base, treasury_addr, buyback_addr, tier, woc_base, bond_base, expires_at`;

function toQuoteRow(r: Record<string, unknown>): RealmBuyQuoteRow {
  return {
    quoteId: String(r.quote_id),
    accountId: Number(r.account_id),
    realmId: Number(r.realm_id),
    buyerWallet: String(r.buyer_wallet),
    currency: String(r.currency) as BuyCurrency,
    totalBase: BigInt(r.total_base as string),
    treasuryBase: BigInt(r.treasury_base as string),
    buybackBase: BigInt(r.buyback_base as string),
    treasuryAddr: String(r.treasury_addr),
    buybackAddr: String(r.buyback_addr),
    tier: Number(r.tier),
    wocBase: BigInt(r.woc_base as string),
    bondBase: BigInt((r.bond_base as string) ?? '0'),
    expiresAt: r.expires_at as Date,
  };
}

export async function createRealmBuyQuote(db: Queryable, q: RealmBuyQuoteRow): Promise<void> {
  await db.query(
    `INSERT INTO realm_buy_quotes
       (quote_id, account_id, realm_id, buyer_wallet, currency, total_base,
        treasury_base, buyback_base, treasury_addr, buyback_addr, tier, woc_base, bond_base, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      q.quoteId, q.accountId, q.realmId, q.buyerWallet, q.currency, q.totalBase.toString(),
      q.treasuryBase.toString(), q.buybackBase.toString(), q.treasuryAddr, q.buybackAddr,
      q.tier, q.wocBase.toString(), q.bondBase.toString(), q.expiresAt,
    ],
  );
}

export async function getRealmBuyQuote(db: Queryable, quoteId: string): Promise<RealmBuyQuoteRow | null> {
  const res = await db.query(`SELECT ${QUOTE_COLS} FROM realm_buy_quotes WHERE quote_id = $1`, [quoteId]);
  return res.rows[0] ? toQuoteRow(res.rows[0]) : null;
}

export async function deleteRealmBuyQuote(db: Queryable, quoteId: string): Promise<void> {
  await db.query('DELETE FROM realm_buy_quotes WHERE quote_id = $1', [quoteId]);
}

// Open (unexpired) buy quotes for an account, counted toward the provisioning cap
// alongside owned realms + open stake quotes so neither path can over-reserve.
export async function countOpenBuyQuotesForAccount(db: Queryable, accountId: number): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM realm_buy_quotes WHERE account_id = $1 AND expires_at > now()`,
    [accountId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

// Reclaim abandoned buy-provisioning: close any provisioning realm whose buy quote
// expired (the payment never confirmed), then delete the expired quotes. Mirrors
// reclaimExpiredProvisioning for the stake path; frees the name + the cap slot.
export async function reclaimExpiredBuyProvisioning(db: Queryable): Promise<number> {
  const closed = await db.query(
    `UPDATE realms SET status = 'closed'
      WHERE status = 'provisioning'
        AND realm_id IN (SELECT realm_id FROM realm_buy_quotes WHERE expires_at <= now())`,
  );
  await db.query('DELETE FROM realm_buy_quotes WHERE expires_at <= now()');
  return closed.rowCount ?? 0;
}

// Record a finalized, verified purchase. pay_tx_sig is UNIQUE, so a replayed
// confirm throws a 23505 the caller maps to "already recorded". Runs on the
// caller's transaction (it activates the realm + grants the owner role atomically).
export async function insertRealmPurchase(
  db: Queryable,
  p: {
    realmId: number;
    accountId: number;
    buyerWallet: string;
    currency: BuyCurrency;
    totalBase: bigint;
    treasuryBase: bigint;
    buybackBase: bigint;
    tier: number;
    payTxSig: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO realm_purchases
       (realm_id, account_id, buyer_wallet, currency, total_base, treasury_base, buyback_base, tier, pay_tx_sig)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      p.realmId, p.accountId, p.buyerWallet, p.currency, p.totalBase.toString(),
      p.treasuryBase.toString(), p.buybackBase.toString(), p.tier, p.payTxSig,
    ],
  );
}

// Whether a realm was acquired by purchase (vs stake). Lets the lifecycle close a
// bought realm directly (no on-chain stake to release).
export async function realmWasPurchased(db: Queryable, realmId: number): Promise<boolean> {
  const res = await db.query('SELECT 1 FROM realm_purchases WHERE realm_id = $1 LIMIT 1', [realmId]);
  return (res.rowCount ?? 0) > 0;
}

// ── Realm bonds (ongoing $WOC hold requirement on the buy path) ───────────────

export interface RealmBondRow {
  realmId: number;
  accountId: number;
  bondBase: bigint;
  graceUntil: Date | null;
}

function toBondRow(r: Record<string, unknown>): RealmBondRow {
  return {
    realmId: Number(r.realm_id),
    accountId: Number(r.account_id),
    bondBase: BigInt(r.bond_base as string),
    graceUntil: (r.grace_until as Date | null) ?? null,
  };
}

export async function createRealmBond(
  db: Queryable,
  b: { realmId: number; accountId: number; bondBase: bigint; graceUntil: Date | null },
): Promise<void> {
  await db.query(
    `INSERT INTO realm_bonds (realm_id, account_id, bond_base, grace_until)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (realm_id) DO UPDATE SET account_id = $2, bond_base = $3, grace_until = $4`,
    [b.realmId, b.accountId, b.bondBase.toString(), b.graceUntil],
  );
}

export async function getRealmBond(db: Queryable, realmId: number): Promise<RealmBondRow | null> {
  const res = await db.query('SELECT realm_id, account_id, bond_base, grace_until FROM realm_bonds WHERE realm_id = $1', [realmId]);
  return res.rows[0] ? toBondRow(res.rows[0]) : null;
}

// Set or clear a realm's bond grace window. null clears it (the wallet recovered).
export async function setRealmBondGrace(db: Queryable, realmId: number, graceUntil: Date | null): Promise<void> {
  await db.query('UPDATE realm_bonds SET grace_until = $2 WHERE realm_id = $1', [realmId, graceUntil]);
}

// Active bonded realms for one account, oldest first. The enforcer checks the
// cumulative bond against the owner's wallet: the oldest realms a wallet can cover
// stay, the newest that push the cumulative bond past the balance fall short.
export async function listActiveBondsForAccount(db: Queryable, accountId: number): Promise<RealmBondRow[]> {
  const res = await db.query(
    `SELECT b.realm_id, b.account_id, b.bond_base, b.grace_until
       FROM realm_bonds b JOIN realms r ON r.realm_id = b.realm_id
      WHERE b.account_id = $1 AND r.status = 'active'
      ORDER BY b.created_at ASC, b.realm_id ASC`,
    [accountId],
  );
  return res.rows.map(toBondRow);
}

// Distinct accounts that own at least one active bonded realm (the enforcer's work
// list; it then reads each account's wallet once and checks the cumulative bond).
export async function accountsWithActiveBonds(db: Queryable): Promise<number[]> {
  const res = await db.query(
    `SELECT DISTINCT b.account_id
       FROM realm_bonds b JOIN realms r ON r.realm_id = b.realm_id
      WHERE r.status = 'active'`,
  );
  return res.rows.map((r: Record<string, unknown>) => Number(r.account_id));
}

// Bonds for a set of realms (for the operator dashboard), keyed by realm_id.
export async function bondsForRealms(db: Queryable, realmIds: number[]): Promise<Map<number, RealmBondRow>> {
  const out = new Map<number, RealmBondRow>();
  if (realmIds.length === 0) return out;
  const res = await db.query(
    'SELECT realm_id, account_id, bond_base, grace_until FROM realm_bonds WHERE realm_id = ANY($1::bigint[])',
    [realmIds],
  );
  for (const r of res.rows) {
    const row = toBondRow(r);
    out.set(row.realmId, row);
  }
  return out;
}
