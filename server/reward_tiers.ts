// Pure reward-tier distribution for the $WOC seasonal leaderboard rewards (#480):
// split a season's pool across the top-ranked players by a configurable per-rank
// basis-points schedule. No I/O — fully unit-tested. All amounts are base-unit
// bigints (a pool can exceed Number.MAX_SAFE_INTEGER).
//
// This computes a PROJECTION ("if the season closed now, the top arena players
// would earn this from the pool"). The actual on-chain payout at season close is
// the escrow/payout path (deferred to #478); this is the read/display side.

// Per-rank share of the pool in basis points (rank 1 = index 0). A player ranked
// beyond the schedule earns nothing. The defaults sum to 10000 (the whole pool);
// they are PLACEHOLDERS — the exact tiers are an economic decision (tune via
// WOC_REWARD_TIER_BPS before launch).
export const DEFAULT_REWARD_TIER_BPS: readonly number[] = [3000, 2000, 1200, 800, 800, 440, 440, 440, 440, 440];

/** The active schedule: a comma-separated WOC_REWARD_TIER_BPS env override (all
 *  non-negative integers summing to <= 10000), else the default. */
export function rewardTierBpsFromEnv(): number[] {
  const raw = (process.env.WOC_REWARD_TIER_BPS ?? '').trim();
  if (!raw) return [...DEFAULT_REWARD_TIER_BPS];
  const parsed = raw.split(',').map((s) => Number(s.trim()));
  const valid = parsed.length > 0
    && parsed.every((n) => Number.isInteger(n) && n >= 0)
    && parsed.reduce((a, b) => a + b, 0) <= 10000;
  return valid ? parsed : [...DEFAULT_REWARD_TIER_BPS];
}

export interface RankedEntry {
  name: string;
  rating: number;
}

export interface RewardStanding {
  rank: number;
  name: string;
  rating: number;
  rewardBase: bigint;
}

/**
 * Distribute `poolBase` across `entries` (already ordered best-first) by `tierBps`.
 * Each rank gets floor(pool × bps / 10000); the flooring remainder of the
 * ALLOCATED portion (pool × Σbps_used / 10000) is added to rank 1 so the
 * distribution conserves exactly. Ranks past the schedule earn 0; with fewer
 * entries than tiers, the unused tiers' share simply stays in the pool.
 */
export function projectSeasonRewards(
  poolBase: bigint,
  entries: RankedEntry[],
  tierBps: number[] = [...DEFAULT_REWARD_TIER_BPS],
): RewardStanding[] {
  const pool = poolBase > 0n ? poolBase : 0n;
  const standings: RewardStanding[] = entries.map((e, i) => ({
    rank: i + 1,
    name: e.name,
    rating: e.rating,
    rewardBase: i < tierBps.length ? (pool * BigInt(tierBps[i])) / 10000n : 0n,
  }));
  if (standings.length === 0) return standings;

  const usedBps = tierBps.slice(0, entries.length).reduce((a, b) => a + b, 0);
  const allocated = (pool * BigInt(usedBps)) / 10000n;
  const distributed = standings.reduce((a, s) => a + s.rewardBase, 0n);
  if (allocated > distributed) standings[0].rewardBase += allocated - distributed;
  return standings;
}
