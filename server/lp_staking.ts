// Pure veLP staking math for the $WOC LP staking vault. No I/O: the epoch
// runner (lp_staking_service.ts) feeds it chain snapshots + ledger headroom and
// persists what it returns. All token amounts are base-unit bigints.
//
// The reward model, end to end:
//  - A position's WEIGHT is amount x a multiplier bought by its REMAINING lock
//    (ve-decay: as the lock runs down, the multiplier steps down with it, so a
//    long lock is worth the most on day one and nothing extra once expired).
//  - Each epoch the service reserves an emission through the #799 flow ledger
//    (the buy>sell invariant: bounded by verified inflows) and splits it across
//    positions pro rata by weight. Flooring dust is NOT emitted; it stays in
//    the season headroom.
//  - Accruals VEST linearly over a configured window. Unstaking forfeits the
//    unvested part proportionally to the amount removed (anti-mercenary: you
//    can always take your principal, but yield you have not sat through goes
//    back to the pool).

export interface VeLpTier {
  index: number;
  key: string;
  /** Minimum REMAINING lock (seconds) at snapshot time to hold this tier. */
  minRemainingLockSeconds: number;
  /** Reward weight multiplier in basis points (10000 = 1x). */
  multiplierBps: number;
}

const DAY = 24 * 60 * 60;

// Worst-first order not required; lookup sorts descending. Multipliers cap at
// 5x for a full-year lock; an unlocked (or expired-lock) position still earns
// 1x, so leaving liquidity in place is never worthless.
export const VE_LP_TIERS: readonly VeLpTier[] = [
  { index: 0, key: 'drift', minRemainingLockSeconds: 0, multiplierBps: 10_000 },
  { index: 1, key: 'ripple', minRemainingLockSeconds: 30 * DAY, multiplierBps: 15_000 },
  { index: 2, key: 'tide', minRemainingLockSeconds: 90 * DAY, multiplierBps: 20_000 },
  { index: 3, key: 'undertow', minRemainingLockSeconds: 180 * DAY, multiplierBps: 30_000 },
  { index: 4, key: 'maelstrom', minRemainingLockSeconds: 360 * DAY, multiplierBps: 50_000 },
];

/** The veLP tier for a position given seconds of lock remaining at snapshot. */
export function veLpTierForRemainingLock(remainingSeconds: number): VeLpTier {
  let best = VE_LP_TIERS[0];
  for (const tier of VE_LP_TIERS) {
    if (remainingSeconds >= tier.minRemainingLockSeconds && tier.multiplierBps > best.multiplierBps)
      best = tier;
  }
  return best;
}

export interface PositionSnapshot {
  owner: string; // base58 wallet
  amountBase: bigint;
  lockedUntil: number; // unix seconds, 0 = never locked
}

/** A position's reward weight at `nowSeconds` (amount x tier multiplier). */
export function positionWeight(p: PositionSnapshot, nowSeconds: number): bigint {
  if (p.amountBase <= 0n) return 0n;
  const remaining = Math.max(0, p.lockedUntil - nowSeconds);
  const tier = veLpTierForRemainingLock(remaining);
  return (p.amountBase * BigInt(tier.multiplierBps)) / 10_000n;
}

/**
 * The emission budget for one epoch: the configured rate, clamped by a
 * headroom-share cap (so LP mining can never drain the whole season budget out
 * from under the arena payouts) and by the headroom itself. Zero when the rate
 * is zero (emissions dark), headroom is empty, or nothing is staked.
 */
export function epochEmissionBudget(p: {
  rateBase: bigint;
  headroomBase: bigint;
  headroomCapBps: number; // max share of current headroom one epoch may reserve
  totalWeight: bigint;
}): bigint {
  if (p.rateBase <= 0n || p.headroomBase <= 0n || p.totalWeight <= 0n) return 0n;
  const cap = (p.headroomBase * BigInt(p.headroomCapBps)) / 10_000n;
  const budget = p.rateBase < cap ? p.rateBase : cap;
  return budget > 0n ? budget : 0n;
}

export interface AccrualShare {
  owner: string;
  amountBase: bigint;
  weight: bigint;
}

/**
 * Split `budgetBase` across positions pro rata by weight, flooring per share.
 * Sum of shares <= budget (dust is never emitted); zero-weight and zero-share
 * positions are dropped. Deterministic for a given snapshot ordering.
 */
export function splitEpochEmission(
  budgetBase: bigint,
  positions: PositionSnapshot[],
  nowSeconds: number,
): AccrualShare[] {
  if (budgetBase <= 0n) return [];
  const weighted = positions
    .map((p) => ({ owner: p.owner, weight: positionWeight(p, nowSeconds) }))
    .filter((w) => w.weight > 0n);
  const totalWeight = weighted.reduce((a, w) => a + w.weight, 0n);
  if (totalWeight <= 0n) return [];
  return weighted
    .map((w) => ({
      owner: w.owner,
      weight: w.weight,
      amountBase: (budgetBase * w.weight) / totalWeight,
    }))
    .filter((s) => s.amountBase > 0n);
}

/**
 * How much of one accrual has vested by `nowSeconds`: linear from the accrual's
 * epoch time over `vestSeconds`, clamped to [0, amount]. vestSeconds <= 0 means
 * instant vesting.
 */
export function vestedAmount(
  accrual: { amountBase: bigint; accruedAtSeconds: number },
  vestSeconds: number,
  nowSeconds: number,
): bigint {
  if (accrual.amountBase <= 0n) return 0n;
  if (vestSeconds <= 0) return accrual.amountBase;
  const elapsed = nowSeconds - accrual.accruedAtSeconds;
  if (elapsed <= 0) return 0n;
  if (elapsed >= vestSeconds) return accrual.amountBase;
  return (accrual.amountBase * BigInt(elapsed)) / BigInt(vestSeconds);
}

/**
 * The unstake-decay forfeit: removing `removedBase` out of `positionBase`
 * forfeits the same fraction of the accrual's UNVESTED remainder (floor). A
 * full exit forfeits everything unvested; vested rewards are never touched.
 */
export function forfeitOnUnstake(p: {
  accrualAmountBase: bigint;
  vestedBase: bigint;
  alreadyForfeitedBase: bigint;
  removedBase: bigint;
  positionBase: bigint; // position size BEFORE the unstake
}): bigint {
  if (p.positionBase <= 0n || p.removedBase <= 0n) return 0n;
  const unvested = p.accrualAmountBase - p.vestedBase - p.alreadyForfeitedBase;
  if (unvested <= 0n) return 0n;
  const removed = p.removedBase > p.positionBase ? p.positionBase : p.removedBase;
  return (unvested * removed) / p.positionBase;
}
