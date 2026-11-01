// Damage-derived self-heals under the PvP tank restraint (owner rule, v0.46).
//
// A `selfHealDamageFrac` heal (Hammer of Grace) heals for a share of the damage
// that LANDED. Against a hostile player that damage already paid the 30% tank
// cut, and the heal then pays the 30% self-heal cut too, so the heal would be
// cut twice (0.7 x 0.7). The owner ruled for a clean -30%: the heal is planned
// from the damage BEFORE the tank cut, and only the self-heal cut applies.
//
// Recurring Grace turns Hammer of Grace OVERHEAL into a shield. Overheal is
// "planned minus healed", so a plan taken before the self-heal cut would hand
// the restraint's 30% straight back as a shield. `restrainedPlannedHeal` is the
// plan after that cut, so only real overheal (the missing-health clamp) becomes
// a shield. Outside the restraint both helpers return their input unchanged.
// Draws no rng.

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { tankPvpDamageMult, tankPvpSelfHealMult } from './tank_restraint';

/** The damage a hit would have landed without the tank cut. `landed` is the
 *  hp the target actually lost; the cut applied only when the target is a
 *  hostile player or something one controls and `source` is restrained. */
export function damageBeforeTankCut(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  landed: number,
): number {
  if (landed <= 0) return landed;
  const targetPlayer = ctx.pvpController(target);
  if (!targetPlayer || targetPlayer.id === source.id || !ctx.isHostileTo(source, target)) {
    return landed;
  }
  const mult = tankPvpDamageMult(source, ctx.players.get(source.id), ctx.time);
  return mult > 0 && mult < 1 ? landed / mult : landed;
}

/** A self-heal's plan after the PvP self-heal cut: what the heal lands at
 *  full health headroom, so `restrainedPlannedHeal - healed` is real overheal. */
export function restrainedPlannedHeal(ctx: SimContext, p: Entity, plannedHeal: number): number {
  const mult = tankPvpSelfHealMult(p, p, ctx.players.get(p.id), ctx.time);
  return mult === 1 ? plannedHeal : Math.round(plannedHeal * mult);
}
