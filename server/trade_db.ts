// Persistence for the two-lane player-trade settlement system (P1).
//
// Two tables, both additive and idempotent (CREATE ... IF NOT EXISTS), applied
// by ensureSchema() exactly like the other *_SCHEMA modules:
//   trade_settlements  the crash-recovery anchor for an in-flight external-lane
//                      trade (escrow JSONB + external pledges + per-leg state).
//   trade_ledger       append-only audit of every completed trade (both lanes).
//
// Every statement is parameterized. Token amounts are integers (copper, claudium
// as whole units in a BIGINT) or opaque decimal strings ($WOC UI units in TEXT);
// no float ever touches a money column. The saveTradePairAndLedger helper mirrors
// saveCharacterAndMarketState (server/db.ts): one transaction, both character
// rows lease-nonce-fenced, so a classic-lane trade's two halves persist together
// or not at all (fix A8: never let a crash tear a completed swap in two).

import type { PoolClient } from 'pg';
import { sanitizeRemovedZone1Content } from '../src/sim/removed_zone1_content';
import type { CharacterState } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { DB_HEAVY_STATEMENT_TIMEOUT_MS, PROCESS_LEASE_HOLDER, pool } from './db';

export const TRADE_SCHEMA = `
CREATE TABLE IF NOT EXISTS trade_settlements (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  status TEXT NOT NULL,
  char_a_id INT REFERENCES characters(id) ON DELETE SET NULL,
  char_b_id INT REFERENCES characters(id) ON DELETE SET NULL,
  account_a_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  account_b_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  char_a_name TEXT NOT NULL,
  char_b_name TEXT NOT NULL,
  escrow_a JSONB NOT NULL,
  escrow_b JSONB NOT NULL,
  claudium_a BIGINT NOT NULL DEFAULT 0,
  claudium_b BIGINT NOT NULL DEFAULT 0,
  claudium_a_exec BOOLEAN NOT NULL DEFAULT false,
  claudium_b_exec BOOLEAN NOT NULL DEFAULT false,
  woc_a TEXT NOT NULL DEFAULT '0',
  woc_b TEXT NOT NULL DEFAULT '0',
  woc_a_reference TEXT,
  woc_b_reference TEXT,
  woc_a_signature TEXT,
  woc_b_signature TEXT,
  woc_a_payer TEXT,
  woc_a_recipient TEXT,
  woc_b_payer TEXT,
  woc_b_recipient TEXT,
  fail_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS trade_settlements_open ON trade_settlements (realm) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS trade_settlements_char_a ON trade_settlements (char_a_id);
CREATE INDEX IF NOT EXISTS trade_settlements_char_b ON trade_settlements (char_b_id);
CREATE INDEX IF NOT EXISTS trade_settlements_account_a ON trade_settlements (account_a_id);
CREATE INDEX IF NOT EXISTS trade_settlements_account_b ON trade_settlements (account_b_id);
ALTER TABLE trade_settlements ADD COLUMN IF NOT EXISTS recovering_since TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS trade_ledger (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  settlement_id BIGINT,
  char_a_id INT,
  char_b_id INT,
  account_a_id INT,
  account_b_id INT,
  char_a_name TEXT NOT NULL,
  char_b_name TEXT NOT NULL,
  items_a JSONB NOT NULL,
  copper_a BIGINT NOT NULL DEFAULT 0,
  items_b JSONB NOT NULL,
  copper_b BIGINT NOT NULL DEFAULT 0,
  claudium_a BIGINT NOT NULL DEFAULT 0,
  claudium_b BIGINT NOT NULL DEFAULT 0,
  woc_a TEXT NOT NULL DEFAULT '0',
  woc_b TEXT NOT NULL DEFAULT '0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_ledger_char_a ON trade_ledger (char_a_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trade_ledger_char_b ON trade_ledger (char_b_id, created_at DESC);
`;

// One side's escrowed goods (items, including instance payloads, plus copper).
export interface TradeEscrow {
  items: InvSlot[];
  copper: number;
}

// 'recovering' is a transient status the boot-recovery claim stamps on a row it has
// atomically grabbed (fix F3); recovery then resolves it to completed/refunded.
export type TradeSettlementStatus =
  | 'escrowed'
  | 'claudium_done'
  | 'completed'
  | 'refunded'
  | 'recovering';

export interface InsertTradeSettlementInput {
  realm: string;
  status: TradeSettlementStatus;
  charAId: number | null;
  charBId: number | null;
  accountAId: number | null;
  accountBId: number | null;
  charAName: string;
  charBName: string;
  escrowA: TradeEscrow;
  escrowB: TradeEscrow;
  claudiumA: number;
  claudiumB: number;
  wocA: string;
  wocB: string;
  wocARef: string | null;
  wocBRef: string | null;
  // The linked wallet pubkeys for each pledged $WOC leg, persisted at insert so
  // boot recovery can run a final on-chain verify without depending on the
  // wallet_links rows still existing (they may have been unlinked meanwhile).
  wocAPayer: string | null;
  wocARecipient: string | null;
  wocBPayer: string | null;
  wocBRecipient: string | null;
}

// A loaded open-settlement row (BIGINT columns arrive as strings from pg; the
// two whole-unit claudium fields are parsed back to number, and a value outside
// the safe-integer range marks the row corrupt: parseWhole returns NaN and
// recovery refuses to act on it rather than mis-round).
export interface TradeSettlementRow {
  id: number;
  realm: string;
  status: TradeSettlementStatus;
  charAId: number | null;
  charBId: number | null;
  accountAId: number | null;
  accountBId: number | null;
  charAName: string;
  charBName: string;
  escrowA: TradeEscrow;
  escrowB: TradeEscrow;
  claudiumA: number;
  claudiumB: number;
  claudiumExecA: boolean;
  claudiumExecB: boolean;
  wocA: string;
  wocB: string;
  wocARef: string | null;
  wocBRef: string | null;
  wocASig: string | null;
  wocBSig: string | null;
  wocAPayer: string | null;
  wocARecipient: string | null;
  wocBPayer: string | null;
  wocBRecipient: string | null;
  failReason: string | null;
}

export interface MarkTradeSettlementPatch {
  wocARef?: string | null;
  wocBRef?: string | null;
  wocASig?: string | null;
  wocBSig?: string | null;
  claudiumExecA?: boolean;
  claudiumExecB?: boolean;
  failReason?: string | null;
}

export interface TradeLedgerRow {
  realm: string;
  settlementId: number | null;
  charAId: number | null;
  charBId: number | null;
  accountAId: number | null;
  accountBId: number | null;
  charAName: string;
  charBName: string;
  itemsA: InvSlot[];
  copperA: number;
  itemsB: InvSlot[];
  copperB: number;
  claudiumA: number;
  claudiumB: number;
  wocA: string;
  wocB: string;
}

// Whole-unit money amounts (claudium, copper) cross the JS number boundary as
// integers. Anything above Number.MAX_SAFE_INTEGER would silently mis-round, so
// the writers assert a safe integer at the boundary. A violation is a programmer
// error (the sim clamps pledges far below this), never runtime data.
function assertSafeWhole(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`trade_db: ${field} is not a safe integer (got ${value})`);
  }
  return value;
}

// Shared INSERT so the pooled path and the in-transaction anchor path
// (insertSettlementAndSaveBoth) emit byte-identical SQL/params.
async function insertSettlementWith(
  query: (text: string, params: unknown[]) => Promise<{ rows: Array<{ id: unknown }> }>,
  input: InsertTradeSettlementInput,
): Promise<number> {
  const res = await query(
    `INSERT INTO trade_settlements
       (realm, status, char_a_id, char_b_id, account_a_id, account_b_id,
        char_a_name, char_b_name, escrow_a, escrow_b,
        claudium_a, claudium_b, woc_a, woc_b, woc_a_reference, woc_b_reference,
        woc_a_payer, woc_a_recipient, woc_b_payer, woc_b_recipient)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20)
     RETURNING id`,
    [
      input.realm,
      input.status,
      input.charAId,
      input.charBId,
      input.accountAId,
      input.accountBId,
      input.charAName,
      input.charBName,
      JSON.stringify(input.escrowA),
      JSON.stringify(input.escrowB),
      assertSafeWhole(Math.trunc(input.claudiumA), 'claudiumA'),
      assertSafeWhole(Math.trunc(input.claudiumB), 'claudiumB'),
      input.wocA,
      input.wocB,
      input.wocARef,
      input.wocBRef,
      input.wocAPayer,
      input.wocARecipient,
      input.wocBPayer,
      input.wocBRecipient,
    ],
  );
  return Number(res.rows[0].id);
}

// Advance a settlement's status and optionally patch the $WOC reference/signature
// or fail reason. resolved_at is stamped exactly when the trade reaches a terminal
// state ('completed' | 'refunded'), so the trade_settlements_open partial index
// stops covering it.
export async function markTradeSettlement(
  id: number,
  status: TradeSettlementStatus,
  patch: MarkTradeSettlementPatch = {},
): Promise<void> {
  const resolved = status === 'completed' || status === 'refunded';
  await pool.query(
    `UPDATE trade_settlements SET
       status = $2,
       woc_a_reference = COALESCE($3, woc_a_reference),
       woc_b_reference = COALESCE($4, woc_b_reference),
       woc_a_signature = COALESCE($5, woc_a_signature),
       woc_b_signature = COALESCE($6, woc_b_signature),
       claudium_a_exec = COALESCE($7, claudium_a_exec),
       claudium_b_exec = COALESCE($8, claudium_b_exec),
       fail_reason = COALESCE($9, fail_reason),
       resolved_at = CASE WHEN $10 THEN now() ELSE resolved_at END
     WHERE id = $1`,
    [
      id,
      status,
      patch.wocARef ?? null,
      patch.wocBRef ?? null,
      patch.wocASig ?? null,
      patch.wocBSig ?? null,
      patch.claudiumExecA ?? null,
      patch.claudiumExecB ?? null,
      patch.failReason ?? null,
      resolved,
    ],
  );
}

function parseEscrow(value: unknown): TradeEscrow {
  const rec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(rec.items) ? (rec.items as InvSlot[]) : [];
  const copper = typeof rec.copper === 'number' ? rec.copper : 0;
  return { items, copper };
}

// A BIGINT whole-unit column parsed back to number. A value outside the safe
// integer range (or non-numeric) returns NaN, which flags the row as corrupt so
// recovery refuses to act on it (mis-rounding a money amount is worse than
// deferring the row to manual reconciliation).
function parseWhole(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(n) ? n : NaN;
}

const SETTLEMENT_COLUMNS = `id, realm, status, char_a_id, char_b_id, account_a_id, account_b_id,
       char_a_name, char_b_name, escrow_a, escrow_b,
       claudium_a, claudium_b, claudium_a_exec, claudium_b_exec, woc_a, woc_b,
       woc_a_reference, woc_b_reference, woc_a_signature, woc_b_signature,
       woc_a_payer, woc_a_recipient, woc_b_payer, woc_b_recipient, fail_reason,
       recovering_since`;

function mapSettlementRow(row: Record<string, unknown>): TradeSettlementRow {
  return {
    id: Number(row.id),
    realm: row.realm as string,
    status: row.status as TradeSettlementStatus,
    charAId: row.char_a_id === null ? null : Number(row.char_a_id),
    charBId: row.char_b_id === null ? null : Number(row.char_b_id),
    accountAId: row.account_a_id === null ? null : Number(row.account_a_id),
    accountBId: row.account_b_id === null ? null : Number(row.account_b_id),
    charAName: row.char_a_name as string,
    charBName: row.char_b_name as string,
    escrowA: parseEscrow(row.escrow_a),
    escrowB: parseEscrow(row.escrow_b),
    claudiumA: parseWhole(row.claudium_a),
    claudiumB: parseWhole(row.claudium_b),
    claudiumExecA: row.claudium_a_exec === true,
    claudiumExecB: row.claudium_b_exec === true,
    wocA: typeof row.woc_a === 'string' ? row.woc_a : '0',
    wocB: typeof row.woc_b === 'string' ? row.woc_b : '0',
    wocARef: (row.woc_a_reference as string | null) ?? null,
    wocBRef: (row.woc_b_reference as string | null) ?? null,
    wocASig: (row.woc_a_signature as string | null) ?? null,
    wocBSig: (row.woc_b_signature as string | null) ?? null,
    wocAPayer: (row.woc_a_payer as string | null) ?? null,
    wocARecipient: (row.woc_a_recipient as string | null) ?? null,
    wocBPayer: (row.woc_b_payer as string | null) ?? null,
    wocBRecipient: (row.woc_b_recipient as string | null) ?? null,
    failReason: (row.fail_reason as string | null) ?? null,
  };
}

// Every unresolved settlement for this realm (the crash-recovery candidate set).
// These are only CANDIDATES: recovery must atomically claim each row via
// claimTradeSettlementForRecovery before acting, so a concurrent double-boot on
// the same realm cannot both deliver its mail/ledger (see fix F3).
export async function loadOpenTradeSettlements(realm: string): Promise<TradeSettlementRow[]> {
  const res = await pool.query(
    `SELECT ${SETTLEMENT_COLUMNS}
       FROM trade_settlements
      WHERE realm = $1 AND resolved_at IS NULL
      ORDER BY id ASC`,
    [realm],
  );
  return res.rows.map(mapSettlementRow);
}

// Atomically claim one open settlement for recovery: flip it to the transient
// 'recovering' status, stamp recovering_since = now(), and RETURN the row only if
// this process won the claim. A row is claimable when it is still unresolved AND
// either freshly escrowed / claudium-done, OR stuck in 'recovering' whose claim
// began more than ten minutes ago (or predates the recovering_since column, so
// recovering_since IS NULL). The staleness gate keys off recovering_since (the
// recovery-attempt age), NOT created_at (the trade's age): a row a live peer just
// claimed has recovering_since = now(), so a second concurrent boot's reclaim WHERE
// excludes it and cannot re-grab an in-flight one within the window (fix R1). A
// genuinely abandoned claim is still eventually reclaimable. Returns null when
// another process already claimed it (RETURNING yields no row).
export async function claimTradeSettlementForRecovery(
  id: number,
): Promise<TradeSettlementRow | null> {
  const res = await pool.query(
    `UPDATE trade_settlements
        SET status = 'recovering',
            recovering_since = now()
      WHERE id = $1
        AND resolved_at IS NULL
        AND (
          status IN ('escrowed', 'claudium_done')
          OR (
            status = 'recovering'
            AND (recovering_since IS NULL OR recovering_since < now() - interval '10 minutes')
          )
        )
      RETURNING ${SETTLEMENT_COLUMNS}`,
    [id],
  );
  return res.rows.length > 0 ? mapSettlementRow(res.rows[0]) : null;
}

async function insertTradeLedgerWith(
  query: (text: string, params: unknown[]) => Promise<unknown>,
  row: TradeLedgerRow,
): Promise<void> {
  await query(
    `INSERT INTO trade_ledger
       (realm, settlement_id, char_a_id, char_b_id, account_a_id, account_b_id,
        char_a_name, char_b_name, items_a, copper_a, items_b, copper_b,
        claudium_a, claudium_b, woc_a, woc_b)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      row.realm,
      row.settlementId,
      row.charAId,
      row.charBId,
      row.accountAId,
      row.accountBId,
      row.charAName,
      row.charBName,
      JSON.stringify(row.itemsA),
      assertSafeWhole(Math.trunc(row.copperA), 'copperA'),
      JSON.stringify(row.itemsB),
      assertSafeWhole(Math.trunc(row.copperB), 'copperB'),
      assertSafeWhole(Math.trunc(row.claudiumA), 'claudiumA'),
      assertSafeWhole(Math.trunc(row.claudiumB), 'claudiumB'),
      row.wocA,
      row.wocB,
    ],
  );
}

// Append one audit row for a completed trade (used by the settling lane, where the
// character halves were already force-saved individually).
export async function insertTradeLedger(row: TradeLedgerRow): Promise<void> {
  await insertTradeLedgerWith((text, params) => pool.query(text, params), row);
}

export interface TradePairSaveSide {
  characterId: number;
  level: number;
  state: CharacterState;
  leaseNonce?: string;
}

// Classic-lane durability (fix A8): persist BOTH characters' post-swap rows AND
// the ledger row in ONE transaction. Each character UPDATE is lease-nonce-fenced
// on the current holder (the exact fence saveCharacterState uses); if either
// fence misses (a same-account takeover rotated a nonce out from under a displaced
// session) the whole transaction rolls back and this returns false, so a completed
// swap's two halves never land apart and the ledger never records a save that did
// not happen.
export async function saveTradePairAndLedger(
  sideA: TradePairSaveSide,
  sideB: TradePairSaveSide,
  ledger: TradeLedgerRow,
  leaseHolder: string = PROCESS_LEASE_HOLDER,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${DB_HEAVY_STATEMENT_TIMEOUT_MS}`);
    if (
      !(await saveFencedSide(client, sideA, leaseHolder)) ||
      !(await saveFencedSide(client, sideB, leaseHolder))
    ) {
      await client.query('ROLLBACK');
      return false;
    }
    await insertTradeLedgerWith((text, params) => client.query(text, params), ledger);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// One lease-nonce-fenced character UPDATE inside an open transaction. Returns
// false when the fence misses (the lease nonce rotated out from under a displaced
// session), which the caller turns into a full ROLLBACK. Shared by the classic
// pair save and the settling-lane escrow anchor so both fence identically.
async function saveFencedSide(
  client: PoolClient,
  side: TradePairSaveSide,
  leaseHolder: string,
): Promise<boolean> {
  const clean = sanitizeRemovedZone1Content(side.state).state;
  if (side.leaseNonce === undefined) {
    await client.query(
      'UPDATE characters SET level = $2, state = $3, updated_at = now() WHERE id = $1',
      [side.characterId, side.level, JSON.stringify(clean)],
    );
    return true;
  }
  const res = await client.query(
    `UPDATE characters SET level = $2, state = $3, updated_at = now()
      WHERE id = $1
        AND EXISTS (
          SELECT 1 FROM character_leases
           WHERE character_id = $1 AND holder = $4 AND nonce = $5
        )`,
    [side.characterId, side.level, JSON.stringify(clean), leaseHolder, side.leaseNonce],
  );
  return (res.rowCount ?? 0) > 0;
}

// Settling-lane escrow anchor (fix F2): INSERT the trade_settlements row AND
// persist both characters' post-escrow rows in ONE transaction. The sim removed
// the escrowed goods from both bags in memory at tradeConfirm; this makes that
// removal and the recovery anchor durable together, so a crash can never leave
// the anchor row referencing goods the character rows still hold (which recovery
// would then mail a second time). Each character UPDATE is lease-nonce-fenced
// exactly like saveTradePairAndLedger; if either fence misses the whole
// transaction rolls back and this returns null (nothing persisted, escrow stays
// in memory, the caller fails the settle consistently).
export async function insertSettlementAndSaveBoth(
  input: InsertTradeSettlementInput,
  sideA: TradePairSaveSide,
  sideB: TradePairSaveSide,
  leaseHolder: string = PROCESS_LEASE_HOLDER,
): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${DB_HEAVY_STATEMENT_TIMEOUT_MS}`);
    if (
      !(await saveFencedSide(client, sideA, leaseHolder)) ||
      !(await saveFencedSide(client, sideB, leaseHolder))
    ) {
      await client.query('ROLLBACK');
      return null;
    }
    const id = await insertSettlementWith((text, params) => client.query(text, params), input);
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
