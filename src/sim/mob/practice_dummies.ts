// The friendly practice target's two rules: what a level-20 ally is worth, and how
// it gives healing back so the next player finds it the way the last one did.
//
// Both are separated from the mob update loop on purpose. The vitals are a pure
// function of the item tables (no rng, no clock), and the rest policy is pure
// arithmetic, so each is unit-testable on its own without standing a Sim up.

import { bestEpicGearFor } from '../dev/bis_gear';
import { characterDerivedStats } from '../entity';
import type { Entity, PlayerClass } from '../types';

// The reference player a friendly dummy simulates. Protection warrior in the
// best-in-slot epic kit is the level-20 reference this repo already tunes
// against everywhere else (content/dungeon_difficulty.ts and rift/ranks.ts both
// price their damage floors on "the reference warrior, a level-20 prot in the
// max-armor kit"), so the healing target is the same body those floors describe
// rather than a second, competing definition of a geared player.
//
// GEAR ONLY, no talents: the kit is what a player can be handed, while a
// spec's passive stamina and armor multipliers are what they bring themselves.
// Excluding them keeps this number a property of the item tables alone.
const REFERENCE_CLASS: PlayerClass = 'warrior';
const REFERENCE_SPEC = 'protection';
export const PLAYER_DUMMY_LEVEL = 20;

// A friendly dummy rests here rather than at full, so a healer arriving at it
// has something to heal instead of a wall of overheal. Deep enough that a
// full-strength cast lands entirely, shallow enough that the dummy never reads
// as an emergency.
export const PLAYER_DUMMY_REST_HP_FRACTION = 0.35;

// How fast healing drains back off once the dummy is above its resting mark, as
// a fraction of max health per second. At 5% it takes 13 seconds to shed a
// full-health top-off, which is long enough to read a heal on the bar and short
// enough that the dummy is ready again before the next player walks up.
export const PLAYER_DUMMY_SHED_FRACTION_PER_SECOND = 0.05;

export interface PlayerDummyVitals {
  maxHp: number;
  armor: number;
}

// Memoized: the item tables are static, and this is called once per spawn.
let cached: PlayerDummyVitals | null = null;

/** Health and armor of the level-20 best-in-slot reference player. Draws no rng. */
export function playerDummyVitals(): PlayerDummyVitals {
  if (!cached) {
    const kit = bestEpicGearFor(REFERENCE_CLASS, REFERENCE_SPEC);
    const derived = characterDerivedStats(REFERENCE_CLASS, PLAYER_DUMMY_LEVEL, kit);
    cached = { maxHp: derived.maxHp, armor: derived.stats.armor };
  }
  return cached;
}

/** The health a friendly dummy settles back to. At least 1: it never dies of rest. */
export function playerDummyRestHp(maxHp: number): number {
  return Math.max(1, Math.round(maxHp * PLAYER_DUMMY_REST_HP_FRACTION));
}

/**
 * One tick of shedding. Health above the resting mark drains toward it and never
 * past it; health at or below it is left alone, so a heal in progress is what
 * moves the bar rather than this. Pure.
 */
export function playerDummyShedHp(hp: number, maxHp: number, dt: number): number {
  const rest = playerDummyRestHp(maxHp);
  if (hp <= rest) return hp;
  // Whole points, and never fewer than one per call: health elsewhere in the sim
  // is integral, and a rounded-to-zero step would strand a small pool above rest
  // forever.
  const shed = Math.max(1, Math.round(maxHp * PLAYER_DUMMY_SHED_FRACTION_PER_SECOND * dt));
  return Math.max(rest, hp - shed);
}

/**
 * Stamp the reference player's body onto a freshly created friendly dummy, and
 * start it at rest. Called from the camp spawn path, which is also where the
 * template's own placeholder hp/armor get replaced.
 */
export function applyPlayerDummyVitals(mob: Entity): void {
  const vitals = playerDummyVitals();
  mob.maxHp = vitals.maxHp;
  mob.hp = playerDummyRestHp(vitals.maxHp);
  mob.stats.armor = vitals.armor;
}
