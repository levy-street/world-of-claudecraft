// Cat Form energy is a pool the druid parks, not a refill.
//
// Shifting into Cat Form swaps the resource bar to energy (recalcPlayerStats in
// entity.ts). That swap used to hand over a fresh 100 every time, which made a
// free right-click on the form buff plus one Cat Form cast a full energy bar
// on demand, mid-fight (player report, v0.44). Classic only ever gave a partial
// refund on a shift, and only through a dedicated helm.
//
// The rule now, in one place:
//   - leaving Cat Form (to caster, Bruin, Fleet, or death) PARKS the energy the
//     druid left with, stored as its shortfall from full;
//   - the parked pool keeps regenerating at the base energy tick while the
//     druid is out of Cat (updateRegen), so a shift back returns what staying
//     in the form would have at the base rate (a Cat-only energy regen buff
//     does not ride along), never more;
//   - a resurrection and the arena top-off hand back a full pool;
//   - a shift INTO Cat Form during a fight hands over the parked pool; out of
//     combat it still hands over the full bar, the friendly opener the design
//     chose over the classic-era zero.
//
// The deficit rests at 0 (a full pool), so a druid who never spent energy and
// every other class carry no state here.
// Pure: no Sim, no Rng, no host.
import type { Entity } from '../types';

/** A full energy bar. */
export const CAT_ENERGY_MAX = 100;

/** Energy the parked pool regains per classic two-second regen tick: the base
 *  energy tick updateRegen pays a druid in Cat Form (before any Cat-only
 *  buff_energyregen aura, which the druid is not wearing while out of form). */
export const PARKED_ENERGY_REGEN_PER_TICK = 20;

type ParkedEnergyHolder = Pick<Entity, 'parkedEnergyDeficit'>;

/** Park the live energy bar as the druid leaves Cat Form. */
export function parkCatEnergy(e: ParkedEnergyHolder, energy: number): void {
  const clamped = Math.max(0, Math.min(CAT_ENERGY_MAX, energy));
  e.parkedEnergyDeficit = CAT_ENERGY_MAX - clamped;
}

/** The energy a shift into Cat Form hands over right now. */
export function catFormEntryEnergy(e: Pick<Entity, 'inCombat' | 'parkedEnergyDeficit'>): number {
  if (!e.inCombat) return CAT_ENERGY_MAX;
  return CAT_ENERGY_MAX - (e.parkedEnergyDeficit ?? 0);
}

/** Hand the parked pool over on a shift into Cat Form, and clear it: while the
 *  druid wears the form the live bar is the pool. */
export function takeCatFormEntryEnergy(e: Pick<Entity, 'inCombat' | 'parkedEnergyDeficit'>) {
  const energy = catFormEntryEnergy(e);
  e.parkedEnergyDeficit = 0;
  return energy;
}

/** One classic regen tick for the parked pool (the druid is out of Cat Form). */
export function regenParkedCatEnergy(e: ParkedEnergyHolder): void {
  if (!e.parkedEnergyDeficit) return;
  e.parkedEnergyDeficit = Math.max(0, e.parkedEnergyDeficit - PARKED_ENERGY_REGEN_PER_TICK);
}
