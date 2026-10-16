// Level-scaled mechanic damage: a boss loose in an open zone that mixes low levels with
// level 20s (Balgath in the Mirefen) cannot price his telegraphed mechanics with one flat
// range. Priced for a level 20 they one-shot the locals; priced for the locals (today's
// numbers) a geared level 20 shrugs them off and the dodging stops mattering.
//
// So the RECEIVING player's level sets the size of the hit, on a straight line: at
// `fromLevel` and below the mechanic deals exactly its authored range, at `toLevel` it
// deals `toMult` times it, and every level between adds the same share. Classic-style
// rather than a percentage of max health: a player's base health also grows by a fixed
// amount per level (a starter-gear warrior has 290 at level 6 and 822 at level 20, x2.8;
// a mage 175 to 665), so a linear rise keeps each mechanic costing about the same share
// of a fresh pool at every level, while gear, stamina and armor still pay off exactly
// as they do against every other hit (it scales the authored number BEFORE mitigation).
//
// Opt-in per template (MobTemplate.mechanicLevelScale), players only: a muster soldier,
// the wildlife in his craters and every boss without the field keep today's numbers.
// Pure: no rng, no clock, so the draw order of every mechanic is unchanged.

import { MOBS } from '../data';
import type { Entity, MobTemplate } from '../types';

export type MechanicLevelScale = NonNullable<MobTemplate['mechanicLevelScale']>;

/** The multiplier a mechanic's authored damage takes against a player of `level`. */
export function mechanicLevelMult(scale: MechanicLevelScale | undefined, level: number): number {
  if (!scale) return 1;
  const span = scale.toLevel - scale.fromLevel;
  if (span <= 0) return level >= scale.toLevel ? scale.toMult : 1;
  const k = Math.min(1, Math.max(0, (level - scale.fromLevel) / span));
  return 1 + (scale.toMult - 1) * k;
}

/** `amount` (already rolled and multiplied by difficulty) resized for the receiving
 *  player's level when `mob`'s template opts in; unchanged for any non-player target. */
export function levelScaledMechanicDamage(mob: Entity, target: Entity, amount: number): number {
  if (target.kind !== 'player') return amount;
  const scale = MOBS[mob.templateId]?.mechanicLevelScale;
  if (!scale) return amount;
  return Math.round(amount * mechanicLevelMult(scale, target.level));
}
