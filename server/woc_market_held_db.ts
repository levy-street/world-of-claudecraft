// The Exchange Vault ledger (docs/prd/woc/marketplace.md, "Selling without a
// wallet: the Vault"): a per-account $WOC balance the game BOOKS on behalf of
// players who sell without a linked wallet. The tokens themselves sit in the
// operator's custody wallet on chain (WOC_MARKET_HELD_WALLET, moved only by
// the economy service); this table is the book of who is owed what, in base
// units, so the game still holds no keys and computes no token math: every
// figure posted here is a service-issued leg (the settlement quote's seller
// leg, the buyer's quoted amount), never a number derived in this repo.
//
// Storage rules (the bank-ledger precedent, server/bank_ledger_db.ts):
//  - every movement is an ENTRY with a unique ref, so a retried post is a
//    no-op ('duplicate') rather than a second credit or a second charge;
//  - the balance row is updated under its own row lock inside the same
//    transaction as the entry, with the non-negative check in the UPDATE's
//    predicate, so an overdraw is a typed 'insufficient' that rolls the entry
//    back, never a negative balance;
//  - base units are NUMERIC(40,0) and cross this module as decimal STRINGS
//    (a 9-decimal token exceeds Number precision long before a whale does).

import type { Pool, PoolClient } from 'pg';

export const WOC_MARKET_HELD_SCHEMA = `
CREATE TABLE IF NOT EXISTS woc_market_held_balances (
  account_id INT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  base NUMERIC(40,0) NOT NULL DEFAULT 0 CHECK (base >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS woc_market_held_entries (
  id BIGSERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ref TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'pay', 'pay_reverse', 'withdraw', 'withdraw_reverse')),
  delta_base NUMERIC(40,0) NOT NULL,
  settlement_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS woc_market_held_entries_account
  ON woc_market_held_entries (account_id, id DESC);
CREATE INDEX IF NOT EXISTS woc_market_held_entries_settlement
  ON woc_market_held_entries (settlement_id) WHERE settlement_id IS NOT NULL;
`;

export type WocHeldEntryKind = 'sale' | 'pay' | 'pay_reverse' | 'withdraw' | 'withdraw_reverse';

export interface WocHeldPost {
  account: number;
  /** Unique idempotency key (see wocHeld*Ref in woc_market_held.ts). */
  ref: string;
  kind: WocHeldEntryKind;
  /** Signed base-unit delta as a decimal string ('-' prefix for a charge). */
  deltaBase: string;
  settlementId?: number | null;
}

export type WocHeldPostOutcome = 'posted' | 'duplicate' | 'insufficient';

export interface WocHeldEntryRow {
  id: number;
  account: number;
  ref: string;
  kind: WocHeldEntryKind;
  deltaBase: string;
  settlementId: number | null;
  createdAtMs: number;
}

export interface WocMarketHeldDb {
  balance(account: number): Promise<string>;
  entries(account: number, limit: number): Promise<WocHeldEntryRow[]>;
  post(entry: WocHeldPost): Promise<WocHeldPostOutcome>;
  /** 'pay' entries whose settlement reached 'failed' or 'expired' with no
   *  matching 'pay_reverse' yet: the sweep's reversal backlog. */
  unreversedFailedPayments(limit: number): Promise<WocHeldEntryRow[]>;
}

/** The one SQL primitive, on a caller-owned client so the seller credit can
 *  ride INSIDE the delivery finalize transaction (woc_market_db.ts). The
 *  balance UPDATE's predicate is the overdraw guard; a zero-row UPDATE means
 *  the caller must roll back (the standalone post below rolls its transaction back;
 *  the finalize tail only ever credits, so it cannot hit it). */
export async function postHeldEntryOnClient(
  client: PoolClient,
  entry: WocHeldPost,
): Promise<WocHeldPostOutcome> {
  const inserted = await client.query(
    `INSERT INTO woc_market_held_entries (account_id, ref, kind, delta_base, settlement_id)
     VALUES ($1, $2, $3, $4::numeric, $5)
     ON CONFLICT (ref) DO NOTHING
     RETURNING id`,
    [entry.account, entry.ref, entry.kind, entry.deltaBase, entry.settlementId ?? null],
  );
  if ((inserted.rowCount ?? 0) === 0) return 'duplicate';
  await client.query(
    `INSERT INTO woc_market_held_balances (account_id, base) VALUES ($1, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [entry.account],
  );
  const updated = await client.query(
    `UPDATE woc_market_held_balances
        SET base = base + $2::numeric, updated_at = now()
      WHERE account_id = $1 AND base + $2::numeric >= 0
      RETURNING base`,
    [entry.account, entry.deltaBase],
  );
  return (updated.rowCount ?? 0) === 0 ? 'insufficient' : 'posted';
}

function entryRow(row: Record<string, unknown>): WocHeldEntryRow {
  return {
    id: Number(row.id),
    account: Number(row.account_id),
    ref: String(row.ref),
    kind: row.kind as WocHeldEntryKind,
    deltaBase: String(row.delta_base),
    settlementId: row.settlement_id === null ? null : Number(row.settlement_id),
    createdAtMs: new Date(row.created_at as string).getTime(),
  };
}

const ENTRY_COLS = 'id, account_id, ref, kind, delta_base, settlement_id, created_at';

export class PgWocMarketHeldDb implements WocMarketHeldDb {
  constructor(private readonly pool: Pool) {}

  async balance(account: number): Promise<string> {
    const res = await this.pool.query(
      'SELECT base FROM woc_market_held_balances WHERE account_id = $1',
      [account],
    );
    return res.rows[0] ? String(res.rows[0].base) : '0';
  }

  async entries(account: number, limit: number): Promise<WocHeldEntryRow[]> {
    const res = await this.pool.query(
      `SELECT ${ENTRY_COLS} FROM woc_market_held_entries
        WHERE account_id = $1 ORDER BY id DESC LIMIT $2`,
      [account, limit],
    );
    return res.rows.map(entryRow);
  }

  async post(entry: WocHeldPost): Promise<WocHeldPostOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const outcome = await postHeldEntryOnClient(client, entry);
      if (outcome === 'insufficient') {
        await client.query('ROLLBACK');
        return outcome;
      }
      await client.query('COMMIT');
      return outcome;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async unreversedFailedPayments(limit: number): Promise<WocHeldEntryRow[]> {
    const res = await this.pool.query(
      `SELECT e.id, e.account_id, e.ref, e.kind, e.delta_base, e.settlement_id, e.created_at FROM woc_market_held_entries e
         JOIN woc_market_settlements s ON s.id = e.settlement_id
        WHERE e.kind = 'pay' AND s.state IN ('failed', 'expired')
          AND NOT EXISTS (
            SELECT 1 FROM woc_market_held_entries r
             WHERE r.kind = 'pay_reverse' AND r.settlement_id = e.settlement_id)
        ORDER BY e.id LIMIT $1`,
      [limit],
    );
    return res.rows.map(entryRow);
  }
}
