// A Smith's Heart boss's own swing per tier: the raid has no dungeon tuning
// row of its own (tier_health.ts), so its bosses spawn with the template's
// weapon on every tier. Each encounter's difficulty row carries a `swingMult`
// (the parse-calibrated pass of 2026-11-16); the pull scales the body's weapon
// by it (its swing cleave, a share of the swing, follows) and remembers the
// weapon it had, and the fight's end (a wipe's reset) gives that weapon back,
// the way tier_health.ts does the pool.
//
// Pure over the entity: no rng, no clock. `src/sim`-pure.

import type { Entity } from '../../types';

/** The weapon a pull found on the body, to give back at the reset. */
export interface TierSwingBase {
  min: number;
  max: number;
}

/** Scale `e`'s swing by `mult` for the fight; returns the weapon to restore
 *  (undefined: nothing changed). */
export function applyTierSwing(e: Entity, mult: number): TierSwingBase | undefined {
  if (mult === 1 || e.dead || !e.weapon) return undefined;
  const base = { min: e.weapon.min, max: e.weapon.max };
  e.weapon.min = Math.round(base.min * mult);
  e.weapon.max = Math.round(base.max * mult);
  return base;
}

/** Give `e` back the swing it had before the tier's. */
export function restoreTierSwing(e: Entity, base: TierSwingBase | undefined): void {
  if (!base || !e.weapon) return;
  e.weapon.min = base.min;
  e.weapon.max = base.max;
}
