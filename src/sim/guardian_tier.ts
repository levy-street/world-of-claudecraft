// Liquidity Guardian cosmetic tiers: the staking-gated flair ladder over the
// woc_lp_vault LP staking positions, mirroring src/sim/holder_tier.ts for the
// holder ladder. Pure data + math, shared verbatim by the server (tier
// broadcast, prestige board) and the client (badges, titles, card), so both
// always agree. COSMETIC ONLY: the sim never reads a guardian tier and no
// gameplay system may ever consult it.
//
// Two gates make the flair farm-and-dump-proof:
//  - the tier ladder follows the REMAINING lock (the same thresholds as the
//    server's veLP reward tiers; tests pin the lockstep), so flair decays with
//    the lock exactly like reward weight does, and
//  - a SEASONING gate: a position younger than GUARDIAN_SEASONING_SECONDS has
//    no flair at all, so buying LP, flashing the badge, and dumping within the
//    week shows nothing.

export interface GuardianTierCore {
  index: number;
  key: GuardianTierKey;
  /** Minimum REMAINING lock (seconds) to hold this tier. */
  minRemainingLockSeconds: number;
}

export type GuardianTierKey =
  | 'wader'
  | 'tidewatcher'
  | 'currentkeeper'
  | 'stormwarden'
  | 'abyssguard';

const DAY = 24 * 60 * 60;

/** A position younger than this has no flair (anti farm-and-dump). */
export const GUARDIAN_SEASONING_SECONDS = 7 * DAY;

// Lock thresholds are in LOCKSTEP with VE_LP_TIERS in server/lp_staking.ts
// (tier index here = veLP tier index + 1); tests/guardian_tier.test.ts pins it.
export const GUARDIAN_TIER_DEFS: readonly GuardianTierCore[] = [
  { index: 1, key: 'wader', minRemainingLockSeconds: 0 },
  { index: 2, key: 'tidewatcher', minRemainingLockSeconds: 30 * DAY },
  { index: 3, key: 'currentkeeper', minRemainingLockSeconds: 90 * DAY },
  { index: 4, key: 'stormwarden', minRemainingLockSeconds: 180 * DAY },
  { index: 5, key: 'abyssguard', minRemainingLockSeconds: 360 * DAY },
];

export interface GuardianPositionLike {
  /** Staked LP in base units (0 = no position). */
  amountBase: bigint;
  /** Unix seconds the lock expires; 0 = never locked. */
  lockedUntil: number;
  /** Unix seconds of the first stake into the open position; 0 = empty. */
  stakedAt: number;
}

/**
 * The guardian tier index for a position at `nowSeconds`: 0 = no flair (no
 * stake, below the dust floor, or not yet seasoned), else 1 (wader) through 5
 * (abyssguard) by remaining lock. `minStakeBase` is the flair dust floor
 * (server-configured; LP base units are pool-specific).
 */
export function guardianTierIndex(
  p: GuardianPositionLike,
  nowSeconds: number,
  minStakeBase: bigint,
): number {
  if (p.amountBase <= 0n || p.amountBase < minStakeBase) return 0;
  if (p.stakedAt <= 0 || nowSeconds - p.stakedAt < GUARDIAN_SEASONING_SECONDS) return 0;
  const remaining = Math.max(0, p.lockedUntil - nowSeconds);
  let best = GUARDIAN_TIER_DEFS[0];
  for (const tier of GUARDIAN_TIER_DEFS) {
    if (remaining >= tier.minRemainingLockSeconds && tier.index > best.index) best = tier;
  }
  return best.index;
}

/** Tier definition by index (1-5), or undefined for 0/out of range. */
export function guardianTierByIndex(index: number): GuardianTierCore | undefined {
  return GUARDIAN_TIER_DEFS.find((t) => t.index === index);
}
