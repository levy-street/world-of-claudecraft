// Scatterbolt (hunter, PR 4488): a spray of bolts in Shrapnel Charge's frontal
// cone that deals no damage and shoves every enemy it catches straight back
// until it stands `pushTo` yards from the hunter. The shove is the shared
// applyKnockback walk, so walls, cliffs, deep water, Ice Block, the Mooring
// Stone and knockback resistance all stop or shorten it exactly as they do any
// other knockback. Crowd-control-immune mobs (raid bosses, heroic minibosses)
// are not moved. Off the GCD; draws no rng.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { dist2d } from '../types';
import { shrapnelConeTargets } from './hunter_fieldcraft';

export function runScatterbolt(
  ctx: SimContext,
  hunter: Entity,
  effect: { coneRange: number; coneAngleDeg: number; pushTo: number },
  abilityId: string,
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: hunter.id,
    targetId: hunter.id,
    school: 'physical',
    fx: 'fireCone',
    ability: abilityId,
    range: effect.coneRange,
    angle: effect.coneAngleDeg,
    level: 1,
  });
  const { primary, others } = shrapnelConeTargets(
    ctx,
    hunter,
    effect.coneRange,
    effect.coneAngleDeg,
  );
  // Materialized before anyone moves, so displacement cannot perturb the set.
  const hit = primary ? [primary, ...others] : others;
  for (const enemy of hit) {
    if (enemy.dead) continue;
    if (enemy.kind === 'mob' && (MOBS[enemy.templateId]?.ccImmune || enemy.ccImmune)) continue;
    ctx.enterCombat(hunter, enemy);
    const distance = effect.pushTo - dist2d(hunter.pos, enemy.pos);
    if (distance > 0) ctx.applyKnockback(hunter, enemy, distance);
  }
}
