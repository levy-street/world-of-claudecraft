// Realm stake tiers (#475). The stake to provision a realm is denominated as a
// percentage of $WOC supply, so realms are deliberately scarce whale-tier assets
// and the lock removes a large slab of supply from circulation (durable buy
// pressure, zero emission). Bronze 1%, Silver 5%, Gold 10% by default, each
// env-tunable. Tier governs realm limits (player cap, customization budget,
// payout-rail eligibility). Pure: the caller passes the live mint supply in base
// units, read from chain, so nothing here touches the network or a clock.

function bpsEnv(key: string, fallback: number): number {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v > 0 && v <= 10_000 ? v : fallback;
}

// Stake thresholds as basis points of total supply (100 bps = 1%).
export const TIER_BPS = {
  bronze: bpsEnv('REALM_TIER_BRONZE_BPS', 100), // 1%
  silver: bpsEnv('REALM_TIER_SILVER_BPS', 500), // 5%
  gold: bpsEnv('REALM_TIER_GOLD_BPS', 1000), // 10%
} as const;

// 0 means the stake is below the minimum (bronze): provisioning is not allowed.
export type RealmTier = 0 | 1 | 2 | 3;
export const TIER_NAMES = ['none', 'bronze', 'silver', 'gold'] as const;

export function tierName(tier: RealmTier): (typeof TIER_NAMES)[number] {
  return TIER_NAMES[tier];
}

// The base-unit stake threshold for a tier given the live supply. Integer math
// throughout (base units are bigint), floor division.
export function tierThreshold(tierBps: number, supplyBase: bigint): bigint {
  return (supplyBase * BigInt(tierBps)) / 10_000n;
}

// The tier a locked amount qualifies for against the live supply. A locked
// amount below the bronze threshold is tier 0 (cannot provision).
export function tierForStake(lockedBase: bigint, supplyBase: bigint): RealmTier {
  if (supplyBase <= 0n || lockedBase <= 0n) return 0;
  if (lockedBase >= tierThreshold(TIER_BPS.gold, supplyBase)) return 3;
  if (lockedBase >= tierThreshold(TIER_BPS.silver, supplyBase)) return 2;
  if (lockedBase >= tierThreshold(TIER_BPS.bronze, supplyBase)) return 1;
  return 0;
}

// The minimum stake (bronze) required to provision a realm at all.
export function minStakeBase(supplyBase: bigint): bigint {
  return tierThreshold(TIER_BPS.bronze, supplyBase);
}
