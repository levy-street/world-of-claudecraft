// Armored ground-zone pulse (Fieldcraft rework, PR 4488). Volley used to be a
// 3 sec channel whose ticks rolled each struck target's armor (casting_lifecycle's
// position-channel path). It is now an instant zone that keeps falling after the
// hunter moves on, and the shared Sim.pulseGroundAoE never mitigates by armor
// (every zone it served was a spell school). A zone flagged armorMitigated pulses
// here instead: the same cue, roll, line-of-sight gate and damage call, with the
// armor reduction the channel applied. Draws one rng roll per struck target, in
// the same hostilesInRadius order the shared pulse uses.

import type { GroundAoE } from '../entity_roster';
import type { SimContext } from '../sim_context';
import { armorReduction } from '../types';

export function pulseArmoredGroundAoE(
  ctx: SimContext,
  effect: GroundAoE,
  threatOpts?: { flat?: number; mult?: number },
  direct = false,
): void {
  const source = ctx.entities.get(effect.sourceId);
  if (!source || source.dead) return;
  ctx.emit({
    type: 'spellfxAt',
    x: effect.pos.x,
    z: effect.pos.z,
    school: effect.school,
    fx: 'tick',
    radius: effect.radius,
    ability: effect.abilityId,
    sourceId: source.id,
  });
  for (const target of ctx.hostilesInRadius(source, effect.pos, effect.radius)) {
    if (!ctx.hasLineOfSight(source, target)) continue;
    const raw = ctx.rng.range(effect.min, effect.max) + (effect.spBonus ?? 0);
    const dmg = Math.round(raw * (1 - armorReduction(ctx.effectiveArmor(target), source.level)));
    ctx.dealDamage(
      source,
      target,
      dmg,
      false,
      effect.school,
      effect.ability,
      'hit',
      false,
      threatOpts,
      direct,
    );
  }
}
