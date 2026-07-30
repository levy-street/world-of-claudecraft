// Ring of Frost is a persistent annular trap, not an instant disk-shaped Nova.
// The state rides the existing groundAoEs collection, while this module owns the
// ring-specific spawn and contact rules. Each target can trigger a given ring once.

import type { GroundAoE } from '../entity_roster';
import type { SimContext } from '../sim_context';
import type { Entity, Vec3 } from '../types';
import { DT } from '../types';

const SWEEP_QUERY_PADDING = 30;

export interface RingOfFrostEffect {
  duration: number;
  radius: number;
  ring: { duration: number; innerRadius: number };
}

export function spawnRingOfFrost(
  ctx: SimContext,
  source: Entity,
  center: Vec3,
  effect: RingOfFrostEffect,
  abilityName: string,
  abilityId: string,
): void {
  const innerRadius = Math.max(0, Math.min(effect.radius, effect.ring.innerRadius));
  ctx.groundAoEs.push({
    sourceId: source.id,
    pos: { ...center },
    radius: effect.radius,
    min: 0,
    max: 0,
    remaining: effect.ring.duration,
    interval: effect.ring.duration,
    tickTimer: effect.ring.duration,
    school: 'frost',
    ability: abilityName,
    frostRing: {
      id: `${source.id}:${Math.round(ctx.time / DT)}`,
      abilityId,
      duration: effect.ring.duration,
      freezeDuration: effect.duration,
      innerRadius,
      triggeredIds: new Set<number>(),
    },
  });
}

export function segmentTouchesAnnulus(
  start: Vec3,
  end: Vec3,
  center: Vec3,
  innerRadius: number,
  outerRadius: number,
): boolean {
  const startX = start.x - center.x;
  const startZ = start.z - center.z;
  const endX = end.x - center.x;
  const endZ = end.z - center.z;
  const maxDistanceSq = Math.max(startX * startX + startZ * startZ, endX * endX + endZ * endZ);
  if (maxDistanceSq < innerRadius * innerRadius) return false;

  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSq = dx * dx + dz * dz;
  const closestT =
    lengthSq > 0 ? Math.max(0, Math.min(1, -(startX * dx + startZ * dz) / lengthSq)) : 0;
  const closestX = startX + dx * closestT;
  const closestZ = startZ + dz * closestT;
  return closestX * closestX + closestZ * closestZ <= outerRadius * outerRadius;
}

export function tickRingOfFrost(ctx: SimContext, effect: GroundAoE): void {
  const ring = effect.frostRing;
  if (!ring) return;
  const source = ctx.entities.get(effect.sourceId);
  if (!source) return;

  for (const target of ctx.hostilesInRadius(
    source,
    effect.pos,
    effect.radius + SWEEP_QUERY_PADDING,
  )) {
    if (ring.triggeredIds.has(target.id)) continue;
    if (
      !segmentTouchesAnnulus(
        target.prevPos,
        target.pos,
        effect.pos,
        ring.innerRadius,
        effect.radius,
      )
    )
      continue;

    ring.triggeredIds.add(target.id);
    ctx.enterCombat(source, target);
    ctx.applyRootAura(
      source,
      target,
      effect.ability,
      `${ring.abilityId}_root`,
      ring.freezeDuration,
      'frost',
    );
  }
}
