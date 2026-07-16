// Pure parimutuel pool math, extracted from Vale Cup's betting so the RiverBoat
// sportsbook and the casino pit book reuse the exact, audited pool logic instead
// of re-deriving it. A leaf module (no SimContext, no ctx): a Vitest imports it
// directly, and both the sim (Vale Cup, pit book) and the server (sportsbook)
// may consume it (server/ is allowed to import from src/sim).
//
// The model: bettors stake on side A or B. Winners get their stake back plus a
// pro-rata share of the LOSING pool (minus an optional rake); a draw, or a
// winning side nobody backed, refunds every stake. At rakeBps = 0 the settle is
// bit-identical to Vale Cup's original settleBets (proven by the untouched Vale
// Cup tests plus the parity gate).
//
// This module is pure over the pool: placeWager/settlePool mutate ONLY the pool
// passed in (poolA/poolB/wagers/settled). Funds debits, event emission, and
// per-account record bumps stay in the caller, which owns that state (copper in
// the sim, the ledger in the server).

export type BetSide = 'A' | 'B';

export interface Wager {
  side: BetSide;
  stake: number;
}

// A parimutuel pool keyed by the bettor's identity (a pid in the sim, an account
// id in the server). Winners split the losing pool pro-rata to their winning-side
// stake.
export interface BetPool<K = number> {
  poolA: number;
  poolB: number;
  wagers: Map<K, Wager>;
  settled: boolean;
}

/** A fresh, empty pool. */
export function createBetPool<K = number>(): BetPool<K> {
  return { poolA: 0, poolB: 0, wagers: new Map<K, Wager>(), settled: false };
}

export type WagerStatus = 'ok' | 'closed-side' | 'over-cap' | 'bad-stake';

/** Stake bounds for a pool: the smallest accepted stake and the per-bettor cap. */
export interface WagerCaps {
  min: number;
  max: number;
}

// Validate a would-be wager WITHOUT mutating the pool. Order matches Vale Cup's
// original sequence so the caller's silent-vs-error branches are preserved:
//   bad-stake  : the stake is not a finite integer at/above the minimum,
//   closed-side: the bettor already has a wager on the OTHER side (cannot back
//                both sides of one book),
//   over-cap   : this stake would push the bettor's cumulative stake over the cap.
// The caller floors the amount before calling (the sim floored `amount`); this
// re-checks integrality defensively.
export function validateWager<K>(
  pool: BetPool<K>,
  key: K,
  side: BetSide,
  stake: number,
  caps: WagerCaps,
): WagerStatus {
  if (!Number.isFinite(stake) || !Number.isInteger(stake) || stake < caps.min) return 'bad-stake';
  const existing = pool.wagers.get(key);
  if (existing && existing.side !== side) return 'closed-side';
  const current = existing?.stake ?? 0;
  if (current + stake > caps.max) return 'over-cap';
  return 'ok';
}

// Commit a validated stake: add it to the winning-side subtotal and accumulate
// the bettor's wager. Assumes validateWager returned 'ok' for the same inputs
// (same-side top-ups accumulate; the caller must have debited the funds first).
export function commitWager<K>(pool: BetPool<K>, key: K, side: BetSide, stake: number): void {
  if (side === 'A') pool.poolA += stake;
  else pool.poolB += stake;
  const current = pool.wagers.get(key)?.stake ?? 0;
  pool.wagers.set(key, { side, stake: current + stake });
}

// Validate then commit in one call (the common path when the caller has no
// interleaved check, e.g. a funds gate, between the two). Returns the status;
// mutates the pool only on 'ok'.
export function placeWager<K>(
  pool: BetPool<K>,
  key: K,
  side: BetSide,
  stake: number,
  caps: WagerCaps,
): WagerStatus {
  const status = validateWager(pool, key, side, stake, caps);
  if (status === 'ok') commitWager(pool, key, side, stake);
  return status;
}

export type SettleOutcome = 'won' | 'lost' | 'refunded';

export interface SettleRow<K> {
  key: K;
  side: BetSide;
  outcome: SettleOutcome;
  stake: number;
  // The amount returned to the bettor: 0 on a loss, the stake on a refund, and
  // stake + winnings on a win. The winning-only profit is payout - stake.
  payout: number;
}

export interface SettleResult<K> {
  rows: Array<SettleRow<K>>;
  // The rake taken from the losing pool (0 when rakeBps is 0 or every stake is
  // refunded). Winner-rounding dust is NOT folded in: it stays unpaid, exactly
  // as Vale Cup's original settle left it.
  rake: number;
}

// Settle the pool for a final winner ('A' | 'B') or a void/draw (null). Returns
// the per-bettor outcome rows the caller applies (credit copper / the ledger,
// emit events, bump records) and the rake taken. Idempotent: a second call on a
// settled pool returns an empty result. Marks the pool settled.
//
// Payout math (generalizing Vale Cup with a rake):
//   refundAll when winner is null OR nobody backed the winning side (winPool 0);
//   otherwise rake = floor(losePool * rakeBps / 10000), and each winner receives
//   stake + floor(stake * (losePool - rake) / winPool). At rakeBps 0 this is
//   exactly Vale Cup's floor(stake * losePool / winPool) winnings.
export function settlePool<K>(
  pool: BetPool<K>,
  winner: BetSide | null,
  rakeBps = 0,
): SettleResult<K> {
  if (pool.settled) return { rows: [], rake: 0 };
  pool.settled = true;
  if (pool.wagers.size === 0) return { rows: [], rake: 0 };

  const winPool = winner === 'A' ? pool.poolA : winner === 'B' ? pool.poolB : 0;
  const losePool = winner === 'A' ? pool.poolB : winner === 'B' ? pool.poolA : 0;
  const refundAll = winner === null || winPool === 0;

  const rake = refundAll ? 0 : Math.floor((losePool * rakeBps) / 10000);
  const distributable = losePool - rake;

  const rows: Array<SettleRow<K>> = [];
  for (const [key, w] of pool.wagers) {
    if (refundAll) {
      rows.push({ key, side: w.side, outcome: 'refunded', stake: w.stake, payout: w.stake });
      continue;
    }
    if (w.side === winner) {
      const winnings = Math.floor((w.stake * distributable) / winPool);
      rows.push({ key, side: w.side, outcome: 'won', stake: w.stake, payout: w.stake + winnings });
    } else {
      rows.push({ key, side: w.side, outcome: 'lost', stake: w.stake, payout: 0 });
    }
  }
  return { rows, rake };
}
