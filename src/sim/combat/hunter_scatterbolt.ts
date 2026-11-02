// Scatterbolt (hunter, PR 4488): a spray of bolts in Shrapnel Charge's frontal
// cone that deals no damage and knocks every enemy it catches straight back
// until it stands `pushTo` yards from the hunter. It is Typhoon's knockback
// (combat/knockback_launch.ts): an enemy PLAYER is thrown into the air in a
// straight line, so a throw off a ledge keeps flying and the fall that follows
// is credited to the hunter, while mobs take the grounded applyKnockback walk.
// Either way walls, deep water, Ice Block, the Mooring Stone and knockback
// resistance stop or shorten it exactly as they do any other knockback.
// Crowd-control-immune mobs (raid bosses, heroic minibosses) are not moved.
// Off the GCD; draws no rng.

import { MOBS } from '../data';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { dist2d } from '../types';
import { shrapnelConeTargets } from './hunter_fieldcraft';
import { applyLaunchKnockback } from './knockback_launch';

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
    if (distance > 0) applyLaunchKnockback(ctx, hunter, enemy, distance);
  }
}
