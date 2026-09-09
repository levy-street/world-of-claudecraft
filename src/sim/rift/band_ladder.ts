// The Riftbound band item-level ladder: the one place a band's power is priced.
//
// A band has no static loot source, so item_level.ts cannot derive its level
// from a drop table the way it does for every other piece. The level is a
// property of the COPY instead: the rank the rift was cleared at sets the base
// (RIFT_BAND_TIER_BASE_ILVL), every Rift Essence upgrade raises it by one, and
// RIFT_BAND_ILVL_CAP holds the whole ladder one step under the current raid
// ring line (Ignivar epics are item level 35), so a maxed band is the best ring
// outside the raid and never the best ring in the game. Primary stats come
// straight off the shared epic-ring budget curve (item_budget.ts
// primaryStatBudget) at that level, split on the class shell's 3:2
// primary-to-secondary identity, so a band at level N carries exactly what an
// authored epic ring at level N would.
//
// Sockets never touch the level or the primary budget. A gem is one combat
// rating line keyed by colour (RIFT_GEM_RATING_STAT), sized so a full S band
// (two sockets) stays under the single 25-rating line the raid rings carry:
// hit gems fine-tune a character onto the raid hit cap, crit and haste gems
// take over once it is met. The static ItemDef shells carry no stats at all;
// everything a band grants lives in the rolled aggregate this module prices.
//
// Pure and host-agnostic (no ctx, no rng): the sim, the client tooltip, and
// the tests all read the same numbers from here.
import type { RiftGemId } from '../content/rift/items';
import { normalizePrimaryStats, type PrimaryStat, primaryStatBudget } from '../item_budget';
import type { RiftTier } from '../types';

/** The ladder ceiling: one under the raid ring line, so the raid stays best. */
export const RIFT_BAND_ILVL_CAP = 34;

/** Essence upgrades a band can take; each raises the item level by one. */
export const RIFT_BAND_MAX_UPGRADE = 5;

/** Item level a fresh band starts at, by the rank of the clear that minted it.
 *  A three-level step per rank so every rank's maxed band lands on a named
 *  tier: C at the heroic-variant rare line, B at the heroic-variant epic line
 *  (28), A at the heroic five-man epic line (31), S at the cap. */
export const RIFT_BAND_TIER_BASE_ILVL: Readonly<Record<RiftTier, number>> = {
  C: 20,
  B: 23,
  A: 26,
  S: 29,
};

/** Gem sockets per rank: only an S band carries two. */
export const RIFT_BAND_GEM_SLOTS: Readonly<Record<RiftTier, number>> = { C: 1, B: 1, A: 1, S: 2 };

/** Combat rating one socketed gem grants, whatever its colour. Two of them
 *  (24) sit under the 25-rating line the raid rings carry. */
export const RIFT_GEM_RATING = 12;

export type RiftGemRating = 'critRating' | 'hasteRating' | 'hitRating';

/** Colour to rating: crimson is crit, azure is haste, verdant is hit. */
export const RIFT_GEM_RATING_STAT: Readonly<Record<RiftGemId, RiftGemRating>> = {
  rift_gem_crimson: 'critRating',
  rift_gem_azure: 'hasteRating',
  rift_gem_verdant: 'hitRating',
};

/** The primary-to-secondary split every band shell carries (a DPS ring
 *  identity: three parts primary stat to two parts stamina or spirit). */
export const RIFT_BAND_STAT_RATIO: readonly [primary: number, secondary: number] = [3, 2];

export interface RiftBandShell {
  primary: PrimaryStat;
  secondary: PrimaryStat;
}

/** The item level of a band at `upgradeLevel` essence upgrades, capped. */
export function riftBandItemLevel(tier: RiftTier, upgradeLevel: number): number {
  const steps = Number.isFinite(upgradeLevel) ? Math.floor(upgradeLevel) : 0;
  const level = Math.max(0, Math.min(RIFT_BAND_MAX_UPGRADE, steps));
  return Math.min(RIFT_BAND_ILVL_CAP, RIFT_BAND_TIER_BASE_ILVL[tier] + level);
}

/** The primary-stat points an epic ring of `itemLevel` carries. */
export function riftBandStatBudget(itemLevel: number): number {
  return primaryStatBudget(itemLevel, 'epic', 'ring');
}

/** The band's primary stat line at `itemLevel`: the ring budget, split on the
 *  shell's 3:2 identity with the shared largest-remainder rounding. */
export function riftBandPrimaryStats(
  shell: RiftBandShell,
  itemLevel: number,
): Partial<Record<PrimaryStat, number>> {
  const [primaryShare, secondaryShare] = RIFT_BAND_STAT_RATIO;
  return normalizePrimaryStats(
    { [shell.primary]: primaryShare, [shell.secondary]: secondaryShare },
    riftBandStatBudget(itemLevel),
  );
}

/** Rating totals from the socketed gems (unknown ids contribute nothing). */
export function riftGemRatings(gems: readonly string[]): Partial<Record<RiftGemRating, number>> {
  const out: Partial<Record<RiftGemRating, number>> = {};
  for (const gem of gems) {
    const stat = RIFT_GEM_RATING_STAT[gem as RiftGemId];
    if (!stat) continue;
    out[stat] = (out[stat] ?? 0) + RIFT_GEM_RATING;
  }
  return out;
}

/** The whole rolled aggregate for a band: primary stats at its item level plus
 *  the gem rating lines. This is what recalcPlayerStats consumes and what the
 *  tooltip renders, rebuilt from (tier, upgradeLevel, gems) and nothing else. */
export function riftBandRolledStats(
  shell: RiftBandShell,
  tier: RiftTier,
  upgradeLevel: number,
  gems: readonly string[],
): Record<string, number> {
  return {
    ...riftBandPrimaryStats(shell, riftBandItemLevel(tier, upgradeLevel)),
    ...riftGemRatings(gems),
  };
}
