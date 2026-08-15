import { grantAbilityDevotion } from '../paladin_devotion';
import { scheduleProjectile } from '../projectile_travel';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export interface SunwardBounceChain {
  caster: Entity;
  primary: Entity;
  jumps: number;
  radius: number;
  school: string;
  abilityId: string;
  dealImpact(target: Entity, hopIndex: number): boolean;
}

function nearestBounceTarget(
  ctx: SimContext,
  caster: Entity,
  origin: Entity,
  radius: number,
  excluded: ReadonlySet<number>,
): Entity | null {
  let best: Entity | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const candidate of ctx.hostilesInRadius(caster, origin.pos, radius)) {
    if (excluded.has(candidate.id) || !ctx.hasLineOfSight(origin, candidate)) continue;
    const dx = candidate.pos.x - origin.pos.x;
    const dz = candidate.pos.z - origin.pos.z;
    const distanceSq = dx * dx + dz * dz;
    if (
      best === null ||
      distanceSq < bestDistanceSq ||
      (distanceSq === bestDistanceSq && candidate.id < best.id)
    ) {
      best = candidate;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

/**
 * Launches one bounce only after the previous ward impact. Each hop searches
 * around that impact point, carries its own travel time, and applies damage
 * and Devotion only when the radiant disc reaches the selected enemy.
 */
export function scheduleSunwardBounceChain(ctx: SimContext, chain: SunwardBounceChain): void {
  const hitIds = new Set<number>([chain.caster.id, chain.primary.id]);
  const totalHits = chain.jumps + 1;

  const launchNext = (origin: Entity, hopIndex: number): void => {
    if (hopIndex > chain.jumps) return;
    const target = nearestBounceTarget(ctx, chain.caster, origin, chain.radius, hitIds);
    if (!target) return;
    hitIds.add(target.id);
    ctx.emit({
      type: 'spellfx',
      sourceId: origin.id,
      targetId: target.id,
      school: chain.school,
      fx: 'paladinSunwardDisc',
      ability: chain.abilityId,
      level: hopIndex,
      count: totalHits,
    });
    scheduleProjectile(
      ctx,
      chain.caster,
      target,
      (_caster, landedTarget) => {
        ctx.emit({
          type: 'spellfx',
          sourceId: origin.id,
          targetId: landedTarget.id,
          school: chain.school,
          fx: 'paladinSunwardDiscImpact',
          ability: chain.abilityId,
          level: hopIndex,
          count: totalHits,
        });
        if (chain.dealImpact(landedTarget, hopIndex)) {
          grantAbilityDevotion(chain.caster, 1);
        }
        launchNext(landedTarget, hopIndex + 1);
      },
      origin.pos,
    );
  };

  launchNext(chain.primary, 1);
}
