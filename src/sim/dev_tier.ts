// Shared developer-badge tier thresholds.
//
// A purely cosmetic honor ladder derived from how many commits a contributor has
// landed into the open-source game repo (the count comes from GitHub's
// contributors API, resolved server-side from a verified GitHub-OAuth link). It
// grants NO gameplay power (the sim never reads it, like holder/Discord tiers);
// it is flair for the player card, nameplate, and inspect screen.
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
  /** Minimum count of landed commits to reach this rung. */
  threshold: number;
}

// Five rungs. Thresholds climb so the first commit is already a visible honor and
// the top rungs are a real flex, sized against the project's real contribution
// distribution (most contributors land single digits; only a handful pass 150).
export const DEV_TIER_DEFS = [
  { index: 1, key: 'tinkerer', threshold: 1 },
  { index: 2, key: 'artificer', threshold: 10 },
  { index: 3, key: 'runesmith', threshold: 50 },
  { index: 4, key: 'architect', threshold: 150 },
  { index: 5, key: 'worldwright', threshold: 500 },
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
 * The highest rung a landed-commit count qualifies for, or null when the count is
 * null (no linked/contributing GitHub account) or below the first rung (< 1).
 */
export function devTierForCommits(commits: number | null): DevTierCore | null {
  if (commits === null || !Number.isFinite(commits) || commits < DEV_TIER_DEFS[0].threshold) {
    return null;
  }
  let tier: DevTierCore | null = null;
  for (const t of DEV_TIER_DEFS) {
    if (commits >= t.threshold) tier = t;
    else break;
  }
  return tier;
}

/** The 1-based rung index for a commit count, or 0 when it qualifies for no rung. */
export function devTierIndexForCommits(commits: number | null): number {
  return devTierForCommits(commits)?.index ?? 0;
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
