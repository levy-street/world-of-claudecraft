// Adaptive difficulty policy for the Idle Classic engine.
//
// The classic-era engagement gate is "fight mobs within +2 levels of you."
// That is correct at cap (level 7+ in zone 1, level 13+ in zone 2) where the
// full ability kit, gear, and stamina cushion make a +2 survivable. It is
// WRONG at level 1-3: a fresh warrior has 50 HP, no abilities worth a rage
// bar, and 0 armor on the mob side, so a +2 (a level 3 mob) hits hard enough
// to kill before the player grinds it down.
//
// This module owns the ONE function the threat and combat policies share:
// the maximum number of levels a mob can exceed the player and still be a
// fair engagement, parameterized by the player's current level. Pure leaf,
// no Sim, no rng. Vitest-imported.

import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

/**
 * The classic engagement ceiling (+2) only once the player has the HP kit
 * and gear to survive it. At very low level, tighten the gate so the fresh
 * character only fights at-level mobs and never the +2 that would kill it.
 *
 * The floor is +1 (a single above-level mob is the classic "yellow" fight)
 * below the survivability threshold; it opens to +2 once the player has the
 * stamina/ability cushion to win that fight. Deterministic in the level.
 */
export function safeLevelGap(playerLevel: number): number {
  // Level 1-2: fragile. Only fight at or slightly above your level.
  if (playerLevel <= 2) return 1;
  // Level 3-6: growing kit. Allow +2 (the classic gate) only past level 6.
  if (playerLevel <= 6) return 2;
  // Level 7+ (zone cap): full classic gate, +2 is the standard.
  return 2;
}

/**
 * True when a mob should NOT be engaged by the idle player: its level exceeds
 * the player's safe gap, OR it carries a boss/rare/elite/world-boss affix.
 *
 * Affix mobs are NEVER idle-fight targets: they are group content (aoePulse,
 * summonAdds, enrage) tuned for a full party, and the idle solo player dies to
 * their mechanics regardless of raw level. This matches the threat map's
 * strong-test so the engagement gate and the flee gate agree: if the threat
 * map says flee from an affix mob, the combat gate will never have engaged it.
 */
export function isTooDangerous(playerLevel: number, mob: Entity): boolean {
  const template = MOBS[mob.templateId];
  const affix =
    !!template && (!!template.boss || !!template.rare || !!template.elite || !!template.worldBoss);
  if (affix) return true; // never idle-fight affix mobs (group content)
  return mob.level > playerLevel + safeLevelGap(playerLevel);
}

/**
 * True when a mob is a good engagement: hostile, live, and within the player's
 * safe gap, with no disqualifying affix at this level.
 */
export function isGoodEngagement(playerLevel: number, mob: Entity): boolean {
  if (mob.dead || !mob.hostile) return false;
  return !isTooDangerous(playerLevel, mob);
}
