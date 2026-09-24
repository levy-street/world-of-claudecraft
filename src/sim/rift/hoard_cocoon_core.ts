// Broodmother Vysska's COCOON, the pure half: every tunable, how many she may
// wrap at once (never the whole party), how tough a cocoon is, and the clock of
// one cocoon's life. No rng, no DOM: the renderer imports this file.
//
// The rule: she wraps a player in silk. They are helpless, she feeds on them, and
// only their ALLIES can cut them out: the cocoon is a real mob to kill. Left too
// long she drinks deep, heals, and drops them. A lone player has nobody to cut
// them out, so alone she spins a BROOD cocoon instead: kill it before it hatches.
//
// What the client needs rides ordinary hoard cues:
//   brood-cocoon      one per cocoon: the warning, then its life. `targetId` the
//                     wrapped player (none on a brood cocoon); `innerRadius` 0 a
//                     wrapped player, 1 a brood cocoon
//   brood-cocoon-end  the SAME id, over: `innerRadius` 0 cut open in time, 1 she
//                     fed (or it hatched)

export const COCOON_CUE_VARIANTS = ['brood-cocoon', 'brood-cocoon-end'] as const;
export function isCocoonVariant(variant: string | undefined): boolean {
  return (COCOON_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

/** The mobs a cocoon is (src/sim/content/rift/mobs.ts). */
export const HOARD_SILK_COCOON_TEMPLATE = 'hoard_silk_cocoon';
export const HOARD_BROOD_COCOON_TEMPLATE = 'hoard_brood_cocoon';
export const HOARD_COCOONED_AURA_ID = 'hoard_cocooned';

export const COCOON = Object.freeze({
  // ---- how many
  /** MAX_COCOON_PERCENT_OF_GROUP and MIN_FREE_PLAYERS: for ONE cocoon, and for
   *  the double at full pressure. */
  maxShare: 0.34,
  minFreePlayers: 1,
  doubleMaxShare: 0.5,
  doubleMinFreePlayers: 2,
  // ---- one cocoon's life
  /** The web mark is on the player this long before the silk closes. */
  warningSec: 1.6,
  /** RESCUE_TIME: how long the party has to cut them out. */
  drainSec: 12,
  /** She feeds this often, for this much each time, and keeps this share of it as
   *  healing. Her feeding never kills by itself: it stops at a sliver. */
  drainEverySec: 1,
  drainDamageFraction: 0.07,
  drainHealShare: 1.5,
  /** Not cut out in time: a last deep drink, and what it heals her (a share of
   *  her own health). */
  devourDamageFraction: 0.45,
  devourHealFraction: 0.06,
  endSec: 0.9,
  // ---- the cocoon mob
  /** COCOON_HEALTH, as a share of the boss's own health (already scaled by party
   *  size and rarity), per free player who can work on it, within bounds. */
  healthFraction: 0.014,
  minHealthPlayers: 1,
  maxHealthPlayers: 4,
  cocoonRadius: 1.5,
  // ---- alone
  /** BROOD_HATCH_TIME, how many hatch, and how tough the brood cocoon is. */
  hatchSec: 11,
  hatchlings: 2,
  maxHatchlings: 4,
  broodHealthFraction: 0.028,
  /** It is spun this far from the lone player, toward her. */
  broodDistance: 8,
});

export const COCOON_TOTAL_SEC = COCOON.warningSec + COCOON.drainSec;
export const BROOD_COCOON_TOTAL_SEC = COCOON.warningSec + COCOON.hatchSec;

/** How many players she wraps at once: never the whole party, never so many that
 *  too few are left to cut them out. None alone (the brood cocoon instead). */
export function cocoonCount(living: number, double: boolean): number {
  const heads = Math.max(0, Math.floor(living));
  if (heads <= 1) return 0;
  const share = double ? COCOON.doubleMaxShare : COCOON.maxShare;
  const free = double ? COCOON.doubleMinFreePlayers : COCOON.minFreePlayers;
  const byShare = Math.max(1, Math.floor(heads * share));
  const count = Math.min(double ? 2 : 1, byShare, heads - free);
  // A party too small for the double's terms still gets the single's.
  return count >= 1 ? count : Math.min(1, heads - COCOON.minFreePlayers);
}

/** One wrapped player's cocoon health: more free hands, a tougher cocoon. */
export function cocoonHealth(bossMaxHp: number, freePlayers: number): number {
  const hands = Math.max(COCOON.minHealthPlayers, Math.min(COCOON.maxHealthPlayers, freePlayers));
  return Math.max(1, Math.round(bossMaxHp * COCOON.healthFraction * hands));
}

export function broodCocoonHealth(bossMaxHp: number): number {
  return Math.max(1, Math.round(bossMaxHp * COCOON.broodHealthFraction));
}

/** How many hatch from a brood cocoon left too long. */
export function broodHatchlings(rarityBonus = 0): number {
  return Math.max(1, Math.min(COCOON.maxHatchlings, COCOON.hatchlings + rarityBonus));
}

/** How far through its rescue window (0 to 1) a cocoon is, `elapsed` seconds into
 *  its cue: 0 through the warning, 1 when she feeds (or it hatches). */
export function cocoonUrgency(elapsed: number, total: number): number {
  const window = total - COCOON.warningSec;
  const t = (elapsed - COCOON.warningSec) / Math.max(1e-6, window);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}
