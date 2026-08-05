// Level-appropriate camp navigation for the Idle Classic engine.
//
// When the character has no active quest and the area around it has no mob it
// should fight, it needs a destination. This module walks the CAMPS + MOBS
// content tables and picks the nearest camp whose mobs are within the player's
// current safe engagement gap. It returns a Vec3 for steerToward so the player
// actually WALKS toward the hunting ground instead of randomly wandering into
// murloc packs or boss camps.
//
// Priority order for identical-distance camps: prefer mobs whose minLevel is
// closest to the player (they give the best XP) without exceeding the safe
// gap. This creates a natural progression: wolves (L1-2) at L1, boars (L2-3)
// at L3, spiders (L2-4) at L5, etc.
//
// Pure leaf: reads only CAMPS, MOBS, and safeLevelGap. No Sim state mutated,
// no rng. Vitest-imported.

import { CAMPS, MOBS } from '../src/sim/data';
import { dist2d, type Vec3 } from '../src/sim/types';
import { safeLevelGap } from './difficulty';

export interface CampTarget {
  /** World position of the camp center. */
  readonly pos: Vec3;
  /** The mob type in this camp. */
  readonly mobId: string;
  /** Distance from the player (yards). */
  readonly dist: number;
  /** Max level of the mob template in this camp. */
  readonly mobMaxLevel: number;
}

/**
 * Find the best camp the player should head toward. Returns null if the
 * player is already in an appropriate camp (the navigator should NOT steer
 * in that case, letting auto-combat handle target selection).
 *
 * The function walks CAMPS, skips camps whose maxLevel exceeds the player's
 * safe gap, and picks the nearest camp (breaking ties by preferring the camp
 * whose maxLevel is closest to the player for best XP yield).
 */
export function findBestCampTarget(playerPos: Vec3, playerLevel: number): CampTarget | null {
  const gap = safeLevelGap(playerLevel);
  const maxAllowedLevel = playerLevel + gap;
  let best: CampTarget | null = null;

  for (const camp of CAMPS) {
    const template = MOBS[camp.mobId];
    if (!template) continue;
    // Boss/elite/worldBoss camps are NEVER safe navigation targets for an
    // idle player. They're meant to be taken on by a group at end-of-zone.
    if (template.boss || template.rare || template.worldBoss || template.elite) continue;
    // A camp is only appropriate when the WORST mob in it is within budget.
    if (template.maxLevel > maxAllowedLevel) continue;

    const d = dist2d(playerPos, { x: camp.center.x, y: 0, z: camp.center.z });
    if (
      best === null ||
      d < best.dist - 0.1 ||
      // Tie-break: prefer the camp whose maxLevel is closest to the player
      // (higher mob level within budget = better XP).
      (Math.abs(d - best.dist) <= 0.1 && template.maxLevel > best.mobMaxLevel)
    ) {
      best = {
        pos: { x: camp.center.x, y: 0, z: camp.center.z },
        mobId: camp.mobId,
        dist: d,
        mobMaxLevel: template.maxLevel,
      };
    }
  }
  return best;
}

/**
 * True when the player is within a camp that is appropriate for its level.
 * Used by the navigator to stop steering when the destination is reached :
 * combat takes over from here.
 */
export function isInAppropriateCamp(
  playerPos: Vec3,
  playerLevel: number,
  campRadius: number = 24, // yd, slightly larger than most camp radii to cover wander
): boolean {
  const gap = safeLevelGap(playerLevel);
  const maxAllowedLevel = playerLevel + gap;
  for (const camp of CAMPS) {
    const template = MOBS[camp.mobId];
    if (!template) continue;
    if (template.boss || template.rare || template.worldBoss || template.elite) continue;
    if (template.maxLevel > maxAllowedLevel) continue;
    const d = dist2d(playerPos, { x: camp.center.x, y: 0, z: camp.center.z });
    if (d <= camp.radius + campRadius) return true;
  }
  return false;
}
