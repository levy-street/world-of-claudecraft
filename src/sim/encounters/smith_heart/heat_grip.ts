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
//
// While the guardian is hidden (sunk, under or rising in an overflow: it lands
// no swing then) every worn grip is HELD (the owner's call of 2026-11-27):
// neither its time nor its next burn runs down, so the tanks come out of the
// overflow with the stacks they went in with and the swap still owed.
// combat/auras.ts `updateAuras` ages every aura BEFORE the encounter's pass
// in a tick, so `holdGrip` runs at the END of the fight's pass and gives back
// the tick the next pass takes (clamped to the whole, so a grip refreshed the
// tick it sank never reads longer than it is): the grip's clocks stand exactly
// still through the next tick's aging and no burn can fall due under it.
//
// Pure over the entities: no rng, no clock. `src/sim`-pure.

import { DT, type Entity } from '../../types';
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

/** Hold `e`'s Cinder Grip (if worn) through the next tick's aura aging: its
 *  time left and its burn's clock get back the tick that aging will take. */
export function holdGripOn(e: Entity): void {
  for (const a of e.auras) {
    if (a.id !== HEAT_AURAS.grip || a.kind !== 'dot') continue;
    a.remaining = Math.min(a.duration, a.remaining + DT);
    if (a.tickInterval)
      a.tickTimer = Math.min(a.tickInterval, (a.tickTimer ?? a.tickInterval) + DT);
  }
}

/** While the guardian is hidden, every grip on the claim's players near the
 *  Hearth stands still (call at the end of the fight's pass). Only players
 *  are held: the grip lands on the guardian's tank, and a pet tank's or a
 *  player's far from the Hearth ages as any aura would. */
export function holdGrip(s: HeatScope, listeners: readonly Entity[]): void {
  if (s.st.stage === 'fight') return;
  for (const p of listeners) if (!p.dead) holdGripOn(p);
}
