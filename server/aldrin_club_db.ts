// SQL for the Aldrin Club: single-use payment quotes and the immutable payment
// ledger. DDL is exported as ALDRIN_SCHEMA and run by db.ts ensureSchema (the
// same pattern as SOCIAL_SCHEMA / OAUTH_SCHEMA). Membership state itself lives in
// accounts.cosmetics (see setAldrinMembership in db.ts) so it rides the existing
// cosmetics sync to the client; this module only owns the quote + ledger tables.
import { pool } from './db';
import type { AldrinPayMethod, AldrinQuote } from './aldrin_club';

export const ALDRIN_SCHEMA = `
-- Single-use payment intents. A crypto client pays with quote_id as the on-chain
-- memo, binding the transaction to this quote + account; rows are short-lived
-- (expires_at) and deleted once consumed. payload is the full AldrinQuote JSON.
CREATE TABLE IF NOT EXISTS aldrin_quotes (
  quote_id TEXT PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aldrin_quotes_account ON aldrin_quotes(account_id);

-- Immutable payment ledger: one row per settled payment. reference is the on-chain
-- transaction signature (crypto) or the Stripe event id (fiat); its UNIQUE
-- constraint is the replay/idempotency guard. Base amounts are token base units;
-- NUMERIC(40,0) holds a u64+ without float loss (read back as a decimal string).
CREATE TABLE IF NOT EXISTS aldrin_payments (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  usd_cents INT NOT NULL DEFAULT 0,
  mint TEXT,
  price_base NUMERIC(40,0) NOT NULL DEFAULT 0,
  treasury_base NUMERIC(40,0) NOT NULL DEFAULT 0,
  split_base NUMERIC(40,0) NOT NULL DEFAULT 0,
  granted_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aldrin_payments_account ON aldrin_payments(account_id, created_at DESC);
`;

export async function insertAldrinQuote(q: AldrinQuote): Promise<void> {
  await pool.query(
    `INSERT INTO aldrin_quotes (quote_id, account_id, method, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [q.quoteId, q.accountId, q.method, q, q.expiresAt],
  );
}

export async function loadAldrinQuote(quoteId: string, accountId: number): Promise<AldrinQuote | null> {
  const res = await pool.query('SELECT payload FROM aldrin_quotes WHERE quote_id = $1 AND account_id = $2', [
    quoteId,
    accountId,
  ]);
  const payload = res.rows[0]?.payload;
  return payload && typeof payload === 'object' ? (payload as AldrinQuote) : null;
}

export async function deleteAldrinQuote(quoteId: string): Promise<void> {
  await pool.query('DELETE FROM aldrin_quotes WHERE quote_id = $1', [quoteId]);
}

/** Housekeeping: drop quotes whose TTL has passed. Safe to call on any boot/tick. */
export async function pruneAldrinQuotes(): Promise<void> {
  await pool.query('DELETE FROM aldrin_quotes WHERE expires_at < now()');
}

export interface AldrinPaymentRecord {
  accountId: number;
  method: AldrinPayMethod;
  /** Tx signature (crypto) or Stripe event id (fiat). UNIQUE replay guard. */
  reference: string;
  usdCents: number;
  mint: string | null;
  priceBase: bigint;
  treasuryBase: bigint;
  splitBase: bigint;
  /** New membership expiry granted by this payment (ISO). */
  grantedUntil: string;
}

/**
 * Append to the payment ledger. Returns false if `reference` was already recorded
 * (the UNIQUE guard fired) so the caller can treat the confirm as an idempotent
 * no-op rather than double-granting.
 */
/** The membership expiry a previously-recorded payment granted (for idempotent heal). */
export async function aldrinPaymentByReference(reference: string): Promise<{ grantedUntil: string } | null> {
  const res = await pool.query('SELECT granted_until FROM aldrin_payments WHERE reference = $1', [reference]);
  const row = res.rows[0];
  return row ? { grantedUntil: new Date(row.granted_until).toISOString() } : null;
}

export async function recordAldrinPayment(rec: AldrinPaymentRecord): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO aldrin_payments
         (account_id, method, reference, usd_cents, mint, price_base, treasury_base, split_base, granted_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        rec.accountId,
        rec.method,
        rec.reference,
        rec.usdCents,
        rec.mint,
        rec.priceBase.toString(),
        rec.treasuryBase.toString(),
        rec.splitBase.toString(),
        rec.grantedUntil,
      ],
    );
    return true;
  } catch (err: any) {
    if (err?.code === '23505') return false; // duplicate reference: already settled
    throw err;
  }
}
