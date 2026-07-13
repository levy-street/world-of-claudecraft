// Emboldening Roar (aura kind 'sure_crit'): the caster and friendly players
// within range gain 'Emboldened' (aura id 'emboldening_roar_crit', 3 charges).
// While a carrier wears it, each of their next 3 damaging ABILITY casts is a
// guaranteed critical strike.
//
// Determinism contract: the existing crit rng draw at every ability crit-roll
// site (meleeSwing's weaponStrike path, directDamage, finisherDamage,
// judgement, consumeAura's deal arm) is still rolled exactly as before; the
// aura only OVERRIDES the rolled outcome to a crit. No draw is skipped and
// none is added, so wearing the aura never shifts the global rng stream.
//
// Consumption is per ABILITY CAST, not per effect: runEffects resolves the
// override once per cast and spends ONE charge after the cast actually rolled
// at least one crit (a Red Harvest's three strikes all crit on one charge; a
// fully whiffed cast or a pure buff/AoE cast with no crit roll spends
// nothing). Plain auto-attack swings (no ability context) neither benefit nor
// consume. When the last charge is spent the aura drops with its fade event.
//
// `src/sim`-pure: sibling types + the SimContext seam only, no rng of its own
// (enforced by tests/architecture.test.ts).

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

/** Is a guaranteed-crit aura armed on this entity? */
export function hasSureCritAura(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'sure_crit');
}

/** Spend one guaranteed-crit charge after a cast that rolled a crit; the aura
 *  drops (with its fade event for the buff bar) on the last charge, mirroring
 *  area_echo's consumeAreaEchoCharge. */
export function consumeSureCritCharge(ctx: SimContext, e: Entity): void {
  const idx = e.auras.findIndex((a) => a.kind === 'sure_crit');
  if (idx < 0) return;
  const aura = e.auras[idx];
  const left = (aura.charges ?? 1) - 1;
  if (left <= 0) {
    e.auras.splice(idx, 1);
    ctx.emit({ type: 'aura', targetId: e.id, name: aura.name, gained: false });
    return;
  }
  aura.charges = left;
}
