// Creator hosting quota + trust policy — pure, server-authoritative, unit-tested.
//
// Two policies live here so they're tunable in one place and provable without a
// DB or RPC:
//   1. hostedSlotQuota(tierIndex) — how many IPFS-hosted skins a creator may keep
//      persistently, by their $WOC holder-tier (src/sim/holder_tier.ts). The free
//      designer + self-hosted modes are NOT gated by this.
//   2. the trusted-creator badge — when a creator's image uploads skip the review
//      queue and go instant-live, earned faster at higher tiers.
//
// Entry-friendly, floored at coppercrest (tier 3 = ≥100 $WOC): below that, zero
// hosted slots. Whale-scaled at the top.

// Hosted slots by 1-based holder-tier index. Tiers 9+ (≥2% of supply) share the
// top count. Index 0-2 (no wallet / < 100 $WOC) get 0 — they fall through the map.
const HOSTED_SLOTS_BY_TIER: Readonly<Record<number, number>> = {
  3: 2, // coppercrest  ≥100
  4: 5, // silverbound  ≥1,000
  5: 12, // gilded      ≥10,000
  6: 30, // vaultwarden ≥100,000
  7: 80, // whale       ≥1,000,000
  8: 200, // leviathan  ≥10,000,000 (1% supply)
};
const TOP_TIER_SLOTS = 400; // tidelord+ (≥2% supply, tier ≥ 9)

/** How many hosted (IPFS-pinned) skins this holder-tier may keep live at once. */
export function hostedSlotQuota(tierIndex: number): number {
  if (!Number.isInteger(tierIndex) || tierIndex <= 0) return 0;
  if (tierIndex >= 9) return TOP_TIER_SLOTS;
  return HOSTED_SLOTS_BY_TIER[tierIndex] ?? 0;
}

// --- Trusted-creator badge (instant-live uploads, skipping review) -----------

export const TRUST_MIN_ACCOUNT_AGE_DAYS = 14;
export const TRUST_STRIKE_WINDOW_DAYS = 30;

/** Approved-listing count required to earn trust, by tier — shrinks as the tier
 *  rises. Whale+ (≥7) is handled separately (age-relaxed) in isTrustedCreator. */
export function trustApprovalThreshold(tierIndex: number): number {
  if (tierIndex >= 5) return 2; // gilded / vaultwarden
  if (tierIndex >= 4) return 3; // silverbound
  return 5; // coppercrest (and anyone below who somehow has approvals)
}

export interface TrustInputs {
  approvedCount: number; // lifetime approved image listings
  tierIndex: number; // current $WOC holder tier
  accountAgeDays: number; // age of the account
  recentStrikes: number; // ToS strikes within TRUST_STRIKE_WINDOW_DAYS
}

/** Whether a creator's image uploads may go instant-live (skip the review queue).
 *  A strike in the trailing window always revokes trust; whales clear the bar on
 *  their first clean approval (age-relaxed); everyone else needs the per-tier
 *  approval count AND the minimum account age. */
export function isTrustedCreator(p: TrustInputs): boolean {
  if (p.recentStrikes > 0) return false;
  if (p.tierIndex >= 7) return p.approvedCount >= 1;
  return p.approvedCount >= trustApprovalThreshold(p.tierIndex) && p.accountAgeDays >= TRUST_MIN_ACCOUNT_AGE_DAYS;
}
