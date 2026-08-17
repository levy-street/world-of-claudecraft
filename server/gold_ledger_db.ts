// Economy Watch, phase 1: the SQL boundary for `gold_ledger`, the append-only
// audit trail of every coin movement the sim reported.
//
// Separate from `bank_ledger` on purpose, rather than another `op` value on it.
// `bank_ledger` is an OBSERVER that infers what happened by diffing a public
// read either side of one dispatch; `gold_ledger` is fed by the sim's own
// `EconomyEvent`, which states the movement rather than inferring it, and
// carries the two columns the whole feature rests on (`balance_after` and
// `prev_ledger_id`) that a diff-based observer structurally cannot produce.
// Merging them would force one of the two disciplines onto the other.
//
// SQL lives here, never in `gold_ledger.ts` (server/CLAUDE.md: logic modules
// carry zero raw SQL), so the writer's queue and batching are unit-testable
// against a fake with no `pg` at all.

import { pool } from './db';
import type { GoldLedgerInsert, GoldLedgerRow } from './gold_ledger_types';

/**
 * The `gold_ledger` DDL, applied by `ensureSchema` under the boot advisory
 * lock like every other domain schema module.
 *
 * KEEP FOREVER, deliberately, and therefore NOT registered with
 * `retention_sweep.ts`. This is the table an operator replays to answer "where
 * did this gold come from", and a dupe investigation routinely reaches back
 * past any window worth setting; a pruned ledger would come up clean for
 * exactly the incident it exists to explain. `bank_ledger` sets the same
 * precedent. Size is bounded in practice by the fact that a row is written
 * only when coin actually moves, never per tick or per request.
 */
export const GOLD_LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS gold_ledger (
  id BIGSERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
  character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  -- 'purse' or 'pool': whose balance balance_after states. Only purse rows are
  -- chained (see prev_ledger_id) and only purse rows are compared against the
  -- persisted save blob; a pool row is booked against the actor who MOVED the
  -- coin but describes a market collection box, a guild treasury, or a letter
  -- in flight. Without this column those rows would sit in the actor's chain
  -- stating a balance that is not their purse.
  holder TEXT NOT NULL,
  -- Signed copper from the holder's point of view. BIGINT because the sim's
  -- own overflow guard is Number.MAX_SAFE_INTEGER, which does not fit INT.
  amount BIGINT NOT NULL,
  -- NULL when the holder has no single running balance: a burn belongs to
  -- nobody, and the mail book is a pile of letters rather than one pot. NOT
  -- NULL in practice on every purse row, but the constraint cannot say so
  -- without a CHECK that would fire on a legitimate pool row.
  balance_after BIGINT,
  -- The other side of a transfer, as a bounded kind plus its id: 'character',
  -- 'guild', or 'pool' (a market collection box, mail in flight). NULL on a
  -- faucet or a sink, where there is no second party by definition.
  counterparty_kind TEXT,
  counterparty_id TEXT,
  -- The previous gold_ledger row for THIS character, or NULL for their first.
  -- The chain is what detects a bypassed mutation: balance_after on the
  -- previous row plus amount on this one must equal this row's balance_after,
  -- and a write that skipped the ledger breaks that equality at exactly the
  -- row after it. Self-referencing FK left off on purpose: it would make every
  -- insert take a lock on the parent row and serialize a character's writes
  -- against their own audit trail for no integrity gain (the writer is the
  -- only producer and is per-realm single-process).
  prev_ledger_id BIGINT,
  -- The SIM clock (tick count), not a wall clock: two rows sharing it happened
  -- in the same tick, which is what makes same-tick race analysis possible.
  sim_tick BIGINT NOT NULL,
  zone TEXT NOT NULL,
  -- Coarse whole-unit world position. Deliberately not the exact float: this
  -- table is kept forever and must not become a movement recording.
  pos_x INT NOT NULL,
  pos_z INT NOT NULL,
  -- The play session the movement happened in, so an operator can group a
  -- suspicious run without joining through timestamps. NULL for a movement
  -- with no session (an offline or headless host).
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The per-character ledger page (admin read API) and the rolling-window
-- reconciliation pass, both newest-first over one character.
CREATE INDEX IF NOT EXISTS gold_ledger_character ON gold_ledger(character_id, id DESC);
-- The nightly full pass and the supply time series walk by time.
CREATE INDEX IF NOT EXISTS gold_ledger_created ON gold_ledger(created_at);
-- Faucet and sink totals by kind, the metrics and admin roll-up.
CREATE INDEX IF NOT EXISTS gold_ledger_kind_created ON gold_ledger(kind, created_at);
`;

// The insert column list, shared by the batch builder below so the placeholder
// arithmetic and the column order can never drift apart.
const INSERT_COLUMNS = [
  'realm',
  'account_id',
  'character_id',
  'kind',
  'holder',
  'amount',
  'balance_after',
  'counterparty_kind',
  'counterparty_id',
  'prev_ledger_id',
  'sim_tick',
  'zone',
  'pos_x',
  'pos_z',
  'session_id',
] as const;

const COLS_PER_ROW = INSERT_COLUMNS.length;

/** Flatten one row into its positional parameter values, in column order. */
function rowParams(r: GoldLedgerInsert): unknown[] {
  return [
    r.realm,
    r.accountId,
    r.characterId,
    r.kind,
    r.holder,
    r.amount,
    r.balanceAfter,
    r.counterpartyKind,
    r.counterpartyId,
    r.prevLedgerId,
    r.simTick,
    r.zone,
    r.posX,
    r.posZ,
    r.sessionId,
  ];
}

/**
 * Build the multi-row INSERT for a batch. Exported PURE so a test can assert
 * the placeholder arithmetic without a database: an off-by-one here would
 * silently shift every column of every row after the first.
 */
export function buildBatchInsertSql(rowCount: number): string {
  const tuples: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const base = i * COLS_PER_ROW;
    const placeholders: string[] = [];
    for (let c = 1; c <= COLS_PER_ROW; c++) placeholders.push(`$${base + c}`);
    tuples.push(`(${placeholders.join(', ')})`);
  }
  // RETURNING id in insertion order is what lets the writer advance its
  // per-character chain head without a second round trip. Postgres returns
  // multi-row INSERT ... RETURNING in VALUES order.
  return `INSERT INTO gold_ledger (${INSERT_COLUMNS.join(', ')})
     VALUES ${tuples.join(', ')}
     RETURNING id`;
}

/**
 * Insert a batch of ledger rows in ONE statement and return the new ids in
 * insertion order. An empty batch is a no-op rather than a malformed
 * statement, so the writer's flush needs no guard of its own.
 */
export async function insertGoldLedgerBatch(rows: readonly GoldLedgerInsert[]): Promise<number[]> {
  if (rows.length === 0) return [];
  const params: unknown[] = [];
  for (const r of rows) params.push(...rowParams(r));
  const res = await pool.query<{ id: string }>(buildBatchInsertSql(rows.length), params);
  return res.rows.map((r) => Number(r.id));
}

/**
 * Insert ONE ledger row on a caller-supplied client, for the paths where the
 * money mutation already rides a Postgres transaction (market, mail, guild
 * bank). Writing the row on the same client makes it commit or roll back WITH
 * the balance change it explains, which is the whole point: a ledger row that
 * survives a rolled-back transfer is worse than no row, because the
 * reconciler would then report a violation that never happened.
 */
export async function insertGoldLedgerRowInTx(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: { id: string }[] }> },
  row: GoldLedgerInsert,
): Promise<number> {
  const res = await client.query(buildBatchInsertSql(1), rowParams(row));
  return Number(res.rows[0]?.id ?? 0);
}

/**
 * The current chain head (highest id) per character, for the characters named.
 * The writer seeds its in-process chain map from this on first write after a
 * boot, so a restart continues the chain instead of restarting it at NULL and
 * blinding the chain check to the very first movement after every deploy.
 *
 * PURSE rows only, matching what the writer chains: a pool row is attributed to
 * the actor but states a holding area's balance, so seeding from one would hand
 * the next purse row a predecessor whose balance is not a purse and manufacture
 * a balance_mismatch out of a healthy market buy.
 */
export async function loadChainHeads(
  characterIds: readonly number[],
): Promise<Map<number, { id: number; balanceAfter: number }>> {
  const out = new Map<number, { id: number; balanceAfter: number }>();
  if (characterIds.length === 0) return out;
  // DISTINCT ON is the index-friendly per-character latest: the
  // gold_ledger_character index is (character_id, id DESC), so this walks one
  // entry per character rather than sorting the whole matching set.
  const res = await pool.query<{ character_id: number; id: string; balance_after: string }>(
    `SELECT DISTINCT ON (character_id) character_id, id, balance_after
       FROM gold_ledger
      WHERE character_id = ANY($1::int[]) AND holder = 'purse'
      ORDER BY character_id, id DESC`,
    [characterIds],
  );
  for (const r of res.rows) {
    out.set(Number(r.character_id), { id: Number(r.id), balanceAfter: Number(r.balance_after) });
  }
  return out;
}

/**
 * Every row for one character in chain order, oldest first, for the
 * reconciliation pass and the admin per-character page. `sinceId` pages
 * forward; the rolling window passes the watermark it last reconciled.
 */
export async function goldLedgerForCharacter(
  characterId: number,
  opts: { sinceId?: number; limit?: number } = {},
): Promise<GoldLedgerRow[]> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 500)), 5000);
  const sinceId = Math.max(0, Math.floor(opts.sinceId ?? 0));
  const res = await pool.query(
    `SELECT id, realm, account_id, character_id, kind, holder, amount, balance_after,
            counterparty_kind, counterparty_id, prev_ledger_id, sim_tick, zone,
            pos_x, pos_z, session_id, created_at
       FROM gold_ledger
      WHERE character_id = $1 AND id > $2
      ORDER BY id ASC
      LIMIT $3`,
    [characterId, sinceId, limit],
  );
  return res.rows.map(mapRow);
}

/** Faucet and sink totals grouped by kind over a time window. */
export async function goldFlowByKind(
  realm: string,
  sinceIso: string,
): Promise<{ kind: string; total: number; rows: number }[]> {
  const res = await pool.query<{ kind: string; total: string; rows: string }>(
    `SELECT kind, SUM(amount)::bigint AS total, COUNT(*)::bigint AS rows
       FROM gold_ledger
      WHERE realm = $1 AND created_at >= $2
      GROUP BY kind
      ORDER BY kind`,
    [realm, sinceIso],
  );
  return res.rows.map((r) => ({ kind: r.kind, total: Number(r.total), rows: Number(r.rows) }));
}

// Shared row mapper: pg returns BIGINT as a string to avoid precision loss, so
// every numeric column crosses back through Number() in exactly one place.
function mapRow(r: Record<string, unknown>): GoldLedgerRow {
  return {
    id: Number(r.id),
    realm: String(r.realm),
    accountId: r.account_id === null ? null : Number(r.account_id),
    characterId: Number(r.character_id),
    kind: String(r.kind),
    holder: r.holder === 'pool' ? 'pool' : 'purse',
    amount: Number(r.amount),
    balanceAfter: r.balance_after === null ? null : Number(r.balance_after),
    counterpartyKind: r.counterparty_kind === null ? null : String(r.counterparty_kind),
    counterpartyId: r.counterparty_id === null ? null : String(r.counterparty_id),
    prevLedgerId: r.prev_ledger_id === null ? null : Number(r.prev_ledger_id),
    simTick: Number(r.sim_tick),
    zone: String(r.zone),
    posX: Number(r.pos_x),
    posZ: Number(r.pos_z),
    sessionId: r.session_id === null ? null : String(r.session_id),
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}
