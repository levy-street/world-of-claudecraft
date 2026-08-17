// Economy Watch, phase 2: the EVIDENCE the conservation checks are run against.
//
// `economy_reconcile.ts` is pure and takes its data as arguments; this module is
// where that data comes from, and `economy_reconcile_job.ts` is what schedules
// the pass. Splitting the three ways round is what lets the nasty cases be
// tested at all: the checks unit-test against hand-built fixtures, the job
// unit-tests against a fake evidence bag, and only this file needs a database.
//
// SQL lives here and nowhere else (server/CLAUDE.md).
//
// THE MEASUREMENT PROBLEM this module exists to be honest about. The ledger
// records a movement the moment the sim makes it; a character's purse reaches
// Postgres only when their save timer fires. So at any instant a live realm's
// persisted state legitimately disagrees with its ledger, and a reconciler that
// ignored that would page an operator for every player who looted a copper in
// the last minute. Every read below therefore carries the evidence needed to
// tell LAG from a FINDING: `loadPurseDisagreements` returns both timestamps and
// the exact magnitude of each disagreement, so the job can bound how much of a
// supply gap unsaved state could possibly account for and page only for the
// excess.

import {
  DB_HEAVY_STATEMENT_TIMEOUT_MS,
  loadMailState,
  loadMarketState,
  pool,
  runWithStatementTimeout,
} from './db';
import type { ReconcileRow, SupplySnapshot } from './economy_reconcile';
import { computeMarketTotals } from './market_backfill';

/** A window row plus the wall clock the persisted-state comparison needs. */
export interface EconomyWindowRow extends ReconcileRow {
  createdAt: number;
}

/**
 * One character whose persisted purse does not equal their ledger's last word.
 *
 * Every row here is EITHER save lag or a real finding, and this module
 * deliberately does not decide which: the job classifies them, because the
 * deciding fact (is this character online right now) lives in the game server's
 * session map and not in the database.
 */
export interface PurseDisagreement {
  characterId: number;
  /** `balance_after` on the character's newest purse row. */
  ledgerBalance: number;
  /** `state->>'copper'` as last saved. */
  persistedCopper: number;
  /** When that newest purse row was written. */
  ledgerAt: number;
  /** When the character row was last written. A save at or before `ledgerAt`
   *  cannot contain the movement, which is the cheap half of the lag test. */
  savedAt: number;
}

/**
 * The highest ledger id in this realm, captured BEFORE the window is read.
 *
 * The pass bounds itself at this id rather than at "whatever exists when each
 * query runs": rows keep landing while the pass works, and an unbounded window
 * would put a character's newest row in the evidence while an even newer one
 * arrived before the purse read, making the two disagree for a reason that is
 * not a finding.
 */
export async function maxGoldLedgerId(realm: string): Promise<number> {
  const res = await pool.query<{ max: string | null }>(
    'SELECT MAX(id)::bigint AS max FROM gold_ledger WHERE realm = $1',
    [realm],
  );
  return res.rows[0]?.max === null || res.rows[0]?.max === undefined ? 0 : Number(res.rows[0].max);
}

/**
 * One window's ledger rows, oldest first, bounded at both ends.
 *
 * `limit` caps a single pass so a long outage's backlog drains across several
 * passes instead of loading a million rows into one process; the job advances
 * its cursor to the last row it actually read, so the remainder is simply the
 * next pass's window.
 */
export async function loadLedgerWindow(
  realm: string,
  sinceId: number,
  untilId: number,
  limit: number,
): Promise<EconomyWindowRow[]> {
  if (untilId <= sinceId) return [];
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT id, character_id, kind, holder, amount, balance_after, prev_ledger_id,
              counterparty_kind, counterparty_id, sim_tick, created_at
         FROM gold_ledger
        WHERE realm = $1 AND id > $2 AND id <= $3
        ORDER BY id ASC
        LIMIT $4`,
      [realm, sinceId, untilId, Math.max(1, Math.floor(limit))],
    ),
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    characterId: Number(r.character_id),
    kind: String(r.kind) as ReconcileRow['kind'],
    holder: r.holder === 'pool' ? 'pool' : 'purse',
    amount: Number(r.amount),
    balanceAfter: r.balance_after === null ? null : Number(r.balance_after),
    prevLedgerId: r.prev_ledger_id === null ? null : Number(r.prev_ledger_id),
    counterpartyKind: r.counterparty_kind === null ? null : String(r.counterparty_kind),
    counterpartyId: r.counterparty_id === null ? null : String(r.counterparty_id),
    simTick: Number(r.sim_tick),
    createdAt:
      r.created_at instanceof Date ? r.created_at.getTime() : Date.parse(String(r.created_at)),
  }));
}

/**
 * Every character in this realm whose saved purse disagrees with their ledger.
 *
 * Deliberately NOT window-scoped, which is the point of it. A mutation that
 * bypassed the ledger leaves a character whose save and ledger disagree
 * FOREVER after, and they may not move another coin for weeks; a check that
 * only ever looked at characters with rows in the last window would let exactly
 * that character fall out of view one window after the incident. The result set
 * stays small on a healthy realm because it lists only DISAGREEMENTS, which are
 * otherwise just the handful of players mid-session.
 *
 * PURSE rows only: a pool row states a market box's balance, and comparing one
 * against a character's save would manufacture a finding out of a market buy.
 */
export async function loadPurseDisagreements(realm: string): Promise<PurseDisagreement[]> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT h.character_id, h.balance_after, h.created_at, c.updated_at,
              (c.state->>'copper')::bigint AS copper
         FROM (
           SELECT DISTINCT ON (character_id) character_id, balance_after, created_at
             FROM gold_ledger
            WHERE realm = $1 AND holder = 'purse'
            ORDER BY character_id, id DESC
         ) h
         JOIN characters c ON c.id = h.character_id
        WHERE c.state ? 'copper'
          AND (c.state->>'copper')::bigint IS DISTINCT FROM h.balance_after`,
      [realm],
    ),
  );
  return res.rows.map((r) => ({
    characterId: Number(r.character_id),
    ledgerBalance: Number(r.balance_after),
    persistedCopper: Number(r.copper),
    ledgerAt:
      r.created_at instanceof Date ? r.created_at.getTime() : Date.parse(String(r.created_at)),
    savedAt:
      r.updated_at instanceof Date ? r.updated_at.getTime() : Date.parse(String(r.updated_at)),
  }));
}

/** Coin sitting in character purses, as last saved. */
export async function supplyInPurses(realm: string): Promise<number> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT COALESCE(SUM((state->>'copper')::bigint), 0)::bigint AS total
         FROM characters
        WHERE realm = $1 AND state ? 'copper'`,
      [realm],
    ),
  );
  return Number(res.rows[0]?.total ?? 0);
}

/**
 * Coin sitting in guild treasuries, as last saved.
 *
 * An oversized or structurally broken `guild_banks` row is SKIPPED by the boot
 * loader and preserved for a human (server/guild_bank_state.ts). Its treasury
 * is still real coin, so it is summed here anyway: leaving it out would make
 * the identity report the whole treasury as vanished on top of whatever was
 * actually wrong with the row.
 */
export async function supplyInGuildTreasuries(realm: string): Promise<number> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT COALESCE(SUM((data->>'treasury')::bigint), 0)::bigint AS total
         FROM guild_banks
        WHERE realm = $1 AND jsonb_typeof(data->'treasury') = 'number'`,
      [realm],
    ),
  );
  return Number(res.rows[0]?.total ?? 0);
}

/**
 * Every term of the global supply identity, measured from persisted state.
 *
 * The realm argument covers the two SQL terms; the market and mail books are
 * single realm-scoped `world_state` blobs whose loaders bind REALM themselves
 * (one process serves one realm), so they take no argument. Reading the blobs
 * rather than summing them in jsonb is deliberate: `computeMarketTotals`
 * already owns the definition of "coin held in escrow", and a second definition
 * written in SQL would be free to drift from the first.
 */
export async function economySupplySnapshot(realm: string): Promise<SupplySnapshot> {
  const [purses, guildTreasuries, market, mail] = await Promise.all([
    supplyInPurses(realm),
    supplyInGuildTreasuries(realm),
    loadMarketState(),
    loadMailState(),
  ]);
  let unclaimedMailCoin = 0;
  for (const letter of mail?.mail ?? []) {
    const coin = Number(letter.copper);
    // A stored blob can carry a surprising value; a NaN here would poison the
    // whole identity and read as the realm's coin supply collapsing.
    if (Number.isFinite(coin)) unclaimedMailCoin += coin;
  }
  return {
    purses,
    // Structurally zero: the personal bank is an item vault with no copper
    // field. See the field's own note in economy_reconcile.ts for why the term
    // is named at all rather than dropped.
    bankVaults: 0,
    guildTreasuries,
    unclaimedMailCoin,
    marketEscrow: market === null ? 0 : computeMarketTotals(market).escrowCopper,
  };
}
