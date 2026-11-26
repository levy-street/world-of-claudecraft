// The Guardian of the Heat's Cinder Grip per tier. The burn itself is the
// template's `stackPoison` (mob/mob_swing.ts): every landed swing adds a
// stack, and the template's per-stack burn (HEAT_TUNING.gripPerTick) is one
// for every tier. Each tier's own per-stack burn lives on its difficulty row
// (HEAT_DIFFICULTY `gripPerTick`, the owner's call of 2026-11-26: Heroic a
// little more than Normal, Mythic a little more than Heroic); every tick of
// the fight this sets each worn grip's burn to the tier's, its stacks kept.
// A swing that lands in the same tick as a grip's burn ticks before this step
// can tick that once at the template's rate (at most a stack's difference).
//
// Pure over the entities: no rng, no clock. `src/sim`-pure.

import type { Entity } from '../../types';
import { HEAT_AURAS } from './heat_ids';
import type { HeatScope } from './heat_scope';

/** A grip's burn a second at `stacks` stacks for a tier's per-stack burn. */
export function gripBurn(perTick: number, stacks: number): number {
  return Math.max(1, Math.round(perTick * Math.max(1, stacks)));
}

/** Set `e`'s Cinder Grip (if worn) to `perTick` a stack. */
export function tierGrip(e: Entity, perTick: number): void {
  for (const a of e.auras) {
    if (a.id !== HEAT_AURAS.grip || a.kind !== 'dot') continue;
    a.value = gripBurn(perTick, a.stacks ?? 1);
  }
}

/** Every player on the Hearth's floor burns at the tier's grip. */
export function stepGrip(s: HeatScope): void {
  for (const p of s.players) tierGrip(p, s.rules.gripPerTick);
}
