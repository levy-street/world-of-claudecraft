// SQL for the buyback keeper's durable batch ledger. Lifted from the skins
// marketplace burn_batches table and generalized: a batch's terminal settlement
// is either a BURN (deflationary) or a TOP_UP (transfer of the swapped $WOC into
// a reward pool, credited to the flow ledger as a verified buyback inflow). All
// raw SQL for the keeper lives here per the server SQL-only-in-*_db.ts invariant;
// the keeper drives an injected PayoutStore so it is unit-tested with a fake.
//
// BUYBACK_BATCHES_SCHEMA is applied by db.ts ensureSchema() under the shared
// pg_advisory_xact_lock.
import { pool } from './db';

export type PayoutMode = 'burn' | 'top_up';
export type BatchStatus = 'swapping' | 'swapped' | 'settling' | 'settled' | 'failed';

export const BUYBACK_BATCHES_SCHEMA = `
CREATE TABLE IF NOT EXISTS buyback_batches (
  batch_id       TEXT PRIMARY KEY,
  mode           TEXT NOT NULL DEFAULT 'burn' CHECK (mode IN ('burn','top_up')),
  source         TEXT NOT NULL DEFAULT 'marketplace',
  usdc_in        BIGINT NOT NULL,
  woc_bought     BIGINT NOT NULL DEFAULT 0,
  woc_settled    BIGINT NOT NULL DEFAULT 0,
  buy_tx_sig     TEXT UNIQUE,
  settle_tx_sig  TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'swapping'
                 CHECK (status IN ('swapping','swapped','settling','settled','failed')),
  fail_reason    TEXT,
  -- top_up only: which reward season's pool this buyback credits, and the on-chain
  -- destination owner the swapped $WOC was transferred to. NULL for burn batches.
  season_id      INT,
  dest           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When the settle tx (burn or top-up transfer) was broadcast. Settling-phase
  -- staleness is measured from THIS, not created_at (= swap time), so a slow swap
  -- can't make the settle look instantly stale and trigger a premature re-issue.
  settle_broadcast_at TIMESTAMPTZ,
  executed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS buyback_batches_status ON buyback_batches(status);
CREATE INDEX IF NOT EXISTS buyback_batches_executed ON buyback_batches(executed_at DESC);
`;

export interface PayoutBatchRow {
  batchId: string;
  mode: PayoutMode;
  source: string;
  usdcIn: bigint;
  wocBought: bigint;
  wocSettled: bigint;
  buyTxSig: string | null;
  settleTxSig: string | null;
  status: BatchStatus;
  failReason: string | null;
  seasonId: number | null;
  dest: string | null;
  createdAt: string;
  settleBroadcastAt: string | null;
  executedAt: string | null;
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function mapBatch(row: Record<string, unknown>): PayoutBatchRow {
  return {
    batchId: row.batch_id as string,
    mode: row.mode as PayoutMode,
    source: row.source as string,
    usdcIn: BigInt(row.usdc_in as string),
    wocBought: BigInt(row.woc_bought as string),
    wocSettled: BigInt(row.woc_settled as string),
    buyTxSig: (row.buy_tx_sig as string | null) ?? null,
    settleTxSig: (row.settle_tx_sig as string | null) ?? null,
    status: row.status as BatchStatus,
    failReason: (row.fail_reason as string | null) ?? null,
    seasonId: row.season_id == null ? null : Number(row.season_id),
    dest: (row.dest as string | null) ?? null,
    createdAt: isoOrNull(row.created_at) ?? '',
    settleBroadcastAt: isoOrNull(row.settle_broadcast_at),
    executedAt: isoOrNull(row.executed_at),
  };
}

// Open the batch by recording its durable intent + the pre-signed swap signature
// BEFORE the swap is broadcast. Returns false if buy_tx_sig collides (the same
// signed swap was already opened — idempotent on a retried/recovered cycle). A
// target-less ON CONFLICT DO NOTHING arbitrates over EVERY unique constraint (the
// batch_id PK AND the buy_tx_sig UNIQUE), so a buy_tx_sig replay is a no-op
// (rowCount 0) — don't narrow it to one target.
export async function createBuybackBatch(b: {
  batchId: string;
  mode: PayoutMode;
  source: string;
  usdcIn: bigint;
  buyTxSig: string;
  seasonId?: number | null;
  dest?: string | null;
}): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO buyback_batches (batch_id, mode, source, usdc_in, buy_tx_sig, season_id, dest, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'swapping') ON CONFLICT DO NOTHING`,
    [b.batchId, b.mode, b.source, b.usdcIn.toString(), b.buyTxSig, b.seasonId ?? null, b.dest ?? null],
  );
  return (res.rowCount ?? 0) === 1;
}

export async function markBatchSwapped(batchId: string, wocBought: bigint): Promise<void> {
  await pool.query(`UPDATE buyback_batches SET status = 'swapped', woc_bought = $2 WHERE batch_id = $1`, [batchId, wocBought.toString()]);
}

export async function markBatchSettling(batchId: string, settleTxSig: string): Promise<void> {
  await pool.query(
    `UPDATE buyback_batches SET status = 'settling', settle_tx_sig = $2, settle_broadcast_at = now() WHERE batch_id = $1`,
    [batchId, settleTxSig],
  );
}

export async function markBatchSettled(batchId: string, wocSettled: bigint): Promise<void> {
  await pool.query(
    `UPDATE buyback_batches SET status = 'settled', woc_settled = $2, executed_at = now() WHERE batch_id = $1`,
    [batchId, wocSettled.toString()],
  );
}

export async function markBatchFailed(batchId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE buyback_batches SET status = 'failed', fail_reason = $2, executed_at = now() WHERE batch_id = $1`,
    [batchId, reason.slice(0, 500)],
  );
}

// In-flight batches (anything not terminal) for crash recovery, oldest first.
export async function openBuybackBatches(): Promise<PayoutBatchRow[]> {
  const res = await pool.query(`SELECT * FROM buyback_batches WHERE status IN ('swapping','swapped','settling') ORDER BY created_at`);
  return res.rows.map(mapBatch);
}

// Timestamp of the most recent completed settlement (drives the batch cadence).
export async function lastSettleAt(): Promise<number | null> {
  const res = await pool.query(`SELECT MAX(executed_at) AS at FROM buyback_batches WHERE status = 'settled'`);
  const at = res.rows[0]?.at;
  return at == null ? null : new Date(at as string).getTime();
}

// Cross-process single-flight for the keeper: sibling realm processes share one
// vault + DB, so a Postgres session advisory lock ensures only one process runs a
// cycle at a time (returns null for the losers). Distinct key from the schema
// lock (0x574f4301) and the skins burn-keeper lock (0x574f4302).
const PAYOUT_KEEPER_LOCK_KEY = 0x57_4f_43_03; // "WOC\x03"
export async function withPayoutKeeperLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [PAYOUT_KEEPER_LOCK_KEY]);
    if (!res.rows[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [PAYOUT_KEEPER_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

// Public transparency ledger: completed batches + cumulative totals, split by mode
// (burned vs topped-up). Read by an ops/admin surface; never under hot load.
export async function buybackLedger(limit = 100): Promise<{
  batches: PayoutBatchRow[];
  cumulativeWocBurned: bigint;
  cumulativeWocToppedUp: bigint;
  cumulativeUsdcIn: bigint;
}> {
  const batches = await pool.query(`SELECT * FROM buyback_batches WHERE status = 'settled' ORDER BY executed_at DESC LIMIT $1`, [limit]);
  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(woc_settled) FILTER (WHERE mode='burn'),0)::text   AS burned,
       COALESCE(SUM(woc_settled) FILTER (WHERE mode='top_up'),0)::text AS topped_up,
       COALESCE(SUM(usdc_in),0)::text                                  AS usdc
     FROM buyback_batches WHERE status = 'settled'`,
  );
  const t = totals.rows[0] ?? {};
  return {
    batches: batches.rows.map(mapBatch),
    cumulativeWocBurned: BigInt((t.burned as string) ?? '0'),
    cumulativeWocToppedUp: BigInt((t.topped_up as string) ?? '0'),
    cumulativeUsdcIn: BigInt((t.usdc as string) ?? '0'),
  };
}
