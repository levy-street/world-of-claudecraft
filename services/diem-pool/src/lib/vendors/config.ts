// Pure vendor policy + trust-ramp logic (no I/O - unit-testable).
// DB rows in VendorConfig override these defaults; see policies.ts.

export type VendorName = 'venice' | 'openai' | 'anthropic' | 'kimi';
export const ALL_VENDORS: VendorName[] = ['venice', 'openai', 'anthropic', 'kimi'];

export type TrustTierName = 'NEW' | 'ESTABLISHED' | 'TRUSTED';

export interface VendorPolicy {
  enabled: boolean;
  /** Applied to the base Claudium reward: floor(usd × CLAUDIUM_PER_USD × this). */
  rewardMultiplier: number;
  /** Standby pay on unused capacity - only sound for stake-backed (Venice)
   *  capacity; a free-to-declare BYOK budget must never earn standby. */
  standbyEligible: boolean;
  /** Days before settled rewards vest (0 = instant). Fraud window for BYOK. */
  vestingDays: number;
  /** Whether the trust-tier routing cap applies (BYOK yes, stake-backed no). */
  trustRampEnabled: boolean;
}

export const DEFAULT_VENDOR_POLICIES: Record<VendorName, VendorPolicy> = {
  venice: {
    enabled: true,
    rewardMultiplier: 1,
    standbyEligible: true,
    vestingDays: 0,
    trustRampEnabled: false,
  },
  openai: {
    enabled: true,
    rewardMultiplier: 1,
    standbyEligible: false,
    vestingDays: 7,
    trustRampEnabled: true,
  },
  anthropic: {
    enabled: true,
    rewardMultiplier: 1,
    standbyEligible: false,
    vestingDays: 7,
    trustRampEnabled: true,
  },
  kimi: {
    enabled: true,
    rewardMultiplier: 1,
    standbyEligible: false,
    vestingDays: 7,
    trustRampEnabled: true,
  },
};

/** Tier is a pure function of the healthy-day streak, recomputed at settlement. */
export function tierFromStreak(consecutiveHealthyDays: number): TrustTierName {
  if (consecutiveHealthyDays >= 30) return 'TRUSTED';
  if (consecutiveHealthyDays >= 7) return 'ESTABLISHED';
  return 'NEW';
}

export interface TrustCaps {
  newUsd: number;
  establishedUsd: number;
}

/** Routable daily budget after the trust ramp. TRUSTED (or ramp-exempt) = declared. */
export function effectiveCapacityUsd(
  declaredUsd: number,
  tier: TrustTierName,
  rampEnabled: boolean,
  caps: TrustCaps,
): number {
  if (!rampEnabled || tier === 'TRUSTED') return declaredUsd;
  return Math.min(declaredUsd, tier === 'NEW' ? caps.newUsd : caps.establishedUsd);
}

/**
 * Cheap key-shape sanity per vendor, checked before the paid validation call.
 * Returns an error string or null. Deliberately loose - vendors evolve
 * prefixes; the real gate is the upstream validation call.
 */
export function keyShapeError(vendor: VendorName, key: string): string | null {
  switch (vendor) {
    case 'anthropic':
      return key.startsWith('sk-ant-') ? null : 'Anthropic keys start with sk-ant-';
    case 'openai':
      if (key.startsWith('sk-ant-')) return 'that looks like an Anthropic key, not OpenAI';
      return key.startsWith('sk-') ? null : 'OpenAI keys start with sk-';
    case 'kimi':
      return key.startsWith('sk-') ? null : 'Kimi (Moonshot) keys start with sk-';
    case 'venice':
      return null;
  }
}
