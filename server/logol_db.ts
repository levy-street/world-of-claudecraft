// Postgres queries for Logol's $WOC purchase flow (docs/prd/woc/
// logol-merchant.md): the quote-then-confirm ledger over woc_quotes /
// woc_payments (DDL in server/db.ts). Mirrors the voice-npc / identity flows;
// all SQL for this feature lives here, none in server/logol.ts (the server SQL
// invariant, server/CLAUDE.md).
import { pool } from './db';

export interface WocQuoteRow {
  quoteId: string;
  accountId: number;
  kind: string;
  payload: Record<string, unknown>;
  priceBase: bigint;
  mint: string;
  expiresAt: number; // epoch ms
}

/** Insert a single-use quote (TTL enforced at read time). */
export async function insertWocQuote(
  quoteId: string,
  accountId: number,
  kind: string,
  payload: Record<string, unknown>,
  priceBase: bigint,
  mint: string,
  expiresAtMs: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO woc_quotes (quote_id, account_id, kind, payload, price_base, mint, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
    [quoteId, accountId, kind, payload, priceBase.toString(), mint, expiresAtMs],
  );
}

/** Load a quote by id if it belongs to `accountId`, else null (no TTL check). */
export async function getWocQuote(quoteId: string, accountId: number): Promise<WocQuoteRow | null> {
  const res = await pool.query(
    `SELECT quote_id, account_id, kind, payload, price_base, mint,
            (EXTRACT(EPOCH FROM expires_at) * 1000)::bigint AS expires_ms
     FROM woc_quotes WHERE quote_id = $1 AND account_id = $2`,
    [quoteId, accountId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    quoteId: row.quote_id,
    accountId: row.account_id,
    kind: row.kind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    priceBase: BigInt(row.price_base),
    mint: row.mint,
    expiresAt: Number(row.expires_ms),
  };
}

export async function deleteWocQuote(quoteId: string): Promise<void> {
  await pool.query('DELETE FROM woc_quotes WHERE quote_id = $1', [quoteId]);
}

/**
 * Record a settled payment. The tx_sig UNIQUE constraint is the replay guard:
 * returns false (no row) if this signature was already recorded, so a
 * double-confirm never double-grants.
 */
export async function recordWocPayment(
  accountId: number,
  txSig: string,
  amountBase: bigint,
  burnedBase: bigint,
  mint: string,
  reference: string,
): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO woc_payments (account_id, tx_sig, amount_base, burned_base, mint, reference)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_sig) DO NOTHING
     RETURNING id`,
    [accountId, txSig, amountBase.toString(), burnedBase.toString(), mint, reference],
  );
  return res.rows.length > 0;
}
