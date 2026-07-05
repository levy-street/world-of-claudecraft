// Shared developer-badge tier thresholds.
//
// A purely cosmetic honor ladder derived from how many pull requests a
// contributor has had MERGED into the open-source game repo (the count comes
// from GitHub's pulls API, filtered to merged, resolved server-side from a
// verified GitHub-OAuth link). It grants NO gameplay power (the sim never
// reads it, like holder/Discord tiers); it is flair for the player card,
// nameplate, and inspect screen.
//
// Merged PRs, not raw commits: a raw commit count (e.g. from GitHub's
// /contributors stats) is gameable by splitting one contribution into many
// trivial commits on a branch that still gets merged whole (this repo merges
// PRs with real merge commits, not squashes, so every "wip"/"fix typo" commit
// on a branch lands in history and would otherwise count). Counting merged
// PRs means commit-spamming inside one PR still only ever earns one rung of
// credit; the unit is "a reviewed, accepted contribution", not "a keystroke".
//
// This pure, host-agnostic module exists so the server, the HUD presentation
// code, and any tooling can agree on the cosmetic tier index without importing
// across host boundaries. It mirrors src/sim/holder_tier.ts and
// src/sim/discord_tier.ts in shape.

export interface DevTierCore {
  /** 1-based rung (1 = Tinkerer, 5 = Worldwright). */
  index: number;
  /** Stable machine key used for CSS hooks, analytics, and presentation lookup. */
  key: string;
  /** Minimum count of merged pull requests to reach this rung. */
  threshold: number;
}

// Five rungs, thresholds calibrated against the project's real merged-PR
// distribution (28 distinct contributors at the time of writing): 1+ earns the
// first rung; the top rung is reserved for the two clear leaders (70+). Rungs
// climb roughly geometrically (1, 5, 15, 30, 70) so most contributors land in
// the lower-middle rungs and the top is a real flex, not a participation badge.
export const DEV_TIER_DEFS = [
  { index: 1, key: 'tinkerer', threshold: 1 },
  { index: 2, key: 'artificer', threshold: 5 },
  { index: 3, key: 'runesmith', threshold: 15 },
  { index: 4, key: 'architect', threshold: 30 },
  { index: 5, key: 'worldwright', threshold: 70 },
] as const satisfies readonly DevTierCore[];

export type DevTierKey = (typeof DEV_TIER_DEFS)[number]['key'];

/**
 * The lowest rung whose nameplate reads as a "significant contributor": at or
 * above this index a player gets the distinct glowing nameplate outline on top of
 * their badge (Architect and Worldwright). Tinkerer/Artificer/Runesmith show the
 * badge glyph only.
 */
export const DEV_TIER_SIGNIFICANT_INDEX = 4;

/**
 * The highest rung a merged-PR count qualifies for, or null when the count is
 * null (no linked/contributing GitHub account) or below the first rung (< 1).
 */
export function devTierForMergedPrs(mergedPrs: number | null): DevTierCore | null {
  if (mergedPrs === null || !Number.isFinite(mergedPrs) || mergedPrs < DEV_TIER_DEFS[0].threshold) {
    return null;
  }
  let tier: DevTierCore | null = null;
  for (const t of DEV_TIER_DEFS) {
    if (mergedPrs >= t.threshold) tier = t;
    else break;
  }
  return tier;
}

/** The 1-based rung index for a merged-PR count, or 0 when it qualifies for no rung. */
export function devTierIndexForMergedPrs(mergedPrs: number | null): number {
  return devTierForMergedPrs(mergedPrs)?.index ?? 0;
}

/** The rung at a 1-based index (1-5), or undefined for 0/out-of-range. */
export function devTierByIndex(index: number): DevTierCore | undefined {
  return Number.isInteger(index) && index >= 1 && index <= DEV_TIER_DEFS.length
    ? DEV_TIER_DEFS[index - 1]
    : undefined;
}

/** Whether a 1-based rung index is a "significant contributor" (gets the nameplate outline). */
export function isSignificantDevTier(index: number): boolean {
  return (
    Number.isInteger(index) && index >= DEV_TIER_SIGNIFICANT_INDEX && index <= DEV_TIER_DEFS.length
  );
}
