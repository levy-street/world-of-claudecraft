// Pure 80/20 split math for the featured-talent checkout (docs/prd/woc/
// talent-checkout.md). IO-free and unit-testable without a DB or RPC (the
// wallet_link.ts / woc_config.ts pure-split idiom): given a total price in base
// units and the treasury basis points, it returns the exact talent and treasury
// legs. Integer-only (bigint), so there is no floating-point drift and
// talentBase + treasuryBase === priceBase, always.
import { TALENT_TREASURY_BPS } from './talent_config';

export interface TalentSplit {
  talentBase: bigint;
  treasuryBase: bigint;
}

/**
 * Split `priceBase` (base units) into the treasury cut (`bps` basis points,
 * floored) and the talent remainder. The remainder takes any rounding dust, so
 * the two legs sum to exactly `priceBase` and the talent is never shorted by
 * rounding. `bps` defaults to the configured TALENT_TREASURY_BPS (2000 = 20%).
 */
export function talentSplit(priceBase: bigint, bps: number = TALENT_TREASURY_BPS): TalentSplit {
  if (priceBase <= 0n) return { talentBase: 0n, treasuryBase: 0n };
  const treasuryBase = (priceBase * BigInt(bps)) / 10000n;
  return { talentBase: priceBase - treasuryBase, treasuryBase };
}
