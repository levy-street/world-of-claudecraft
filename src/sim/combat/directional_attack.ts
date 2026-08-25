import type { PlayerMeta } from '../sim';
import {
  type AbilityDef,
  type Entity,
  MELEE_RANGE,
  normAngle,
  type PlayerAttackResolution,
} from '../types';

export const PLAYER_MELEE_CONE_HALF_ANGLE = Math.PI / 3;
export const PLAYER_MELEE_TARGET_CAP = 3;
export const BALLISTIC_PROJECTILE_RADIUS = 0.2;

const LOCK_ON_EFFECTS = new Set([
  'charge',
  'hunterBloodhook',
  'packCommand',
  'pullTarget',
  'sportShove',
  'tamePet',
  'taunt',
  'unleashBeast',
  'destructionConflagrate',
]);

/** Central data-driven classifier. Content may override every inferred case. */
export function playerAttackResolution(ability: AbilityDef): PlayerAttackResolution {
  if (ability.playerAttackResolution) return ability.playerAttackResolution;
  if (ability.targetsDead || ability.targetType === 'friendly') return 'support';
  if (ability.targetMode === 'position') return 'groundArea';
  if (
    ability.targetType === 'any' ||
    ability.executeThreshold !== undefined ||
    ability.requiresTargetHpBelow !== undefined
  )
    return 'lockOnActivation';
  if (ability.effects?.some((effect) => LOCK_ON_EFFECTS.has(effect.type))) {
    return 'lockOnActivation';
  }
  if (ability.effects?.some((effect) => effect.type === 'aoeDamage')) return 'selfArea';
  if (!ability.requiresTarget) return 'selfArea';
  if (ability.range <= MELEE_RANGE) return 'meleeCone';
  // Projectile travel is an authored mechanic, not a proxy for "non-physical".
  // The old school fallback turned every ranged spell, including target-born
  // bursts, beams, DoTs and crowd control, into the same generic magic orb.
  // Real bolts/arrows opt in through projectile (or the explicit resolution
  // override above); everything else resolves on the aim line.
  if (ability.projectile === true) return 'ballisticProjectile';
  return 'directionalHitscan';
}

export function abilityUsesDirectionalHostileAim(ability: AbilityDef): boolean {
  const resolution = playerAttackResolution(ability);
  return (
    resolution === 'meleeCone' ||
    resolution === 'ballisticProjectile' ||
    resolution === 'directionalHitscan'
  );
}

export function combatAimAngle(player: Entity, meta: PlayerMeta): number {
  const angle = meta.combatAimAngle;
  return typeof angle === 'number' && Number.isFinite(angle)
    ? Math.atan2(Math.sin(angle), Math.cos(angle))
    : Math.atan2(Math.sin(player.facing), Math.cos(player.facing));
}

export function entityCombatRadius(entity: Pick<Entity, 'scale'>): number {
  return Math.min(2, Math.max(0.5, entity.scale * 0.5));
}

export interface DirectionalCandidate {
  id: number;
  pos: { x: number; z: number };
  scale: number;
}

export function selectMeleeConeTargets<T extends DirectionalCandidate>(query: {
  origin: { x: number; z: number };
  facing: number;
  range: number;
  candidates: readonly T[];
  cap?: number;
}): T[] {
  const range = Math.max(0, query.range);
  return query.candidates
    .map((candidate) => ({
      candidate,
      distance: Math.hypot(candidate.pos.x - query.origin.x, candidate.pos.z - query.origin.z),
      angle: Math.abs(
        normAngle(
          Math.atan2(candidate.pos.x - query.origin.x, candidate.pos.z - query.origin.z) -
            query.facing,
        ),
      ),
    }))
    .filter(
      ({ candidate, distance, angle }) =>
        distance <= range + entityCombatRadius(candidate) && angle <= PLAYER_MELEE_CONE_HALF_ANGLE,
    )
    .sort((a, b) => a.angle - b.angle || a.distance - b.distance || a.candidate.id - b.candidate.id)
    .slice(0, query.cap ?? PLAYER_MELEE_TARGET_CAP)
    .map(({ candidate }) => candidate);
}

export function segmentCircleTimeOfImpact(
  origin: { x: number; z: number },
  direction: { x: number; z: number },
  maxDistance: number,
  center: { x: number; z: number },
  radius: number,
): number | null {
  const ox = origin.x - center.x;
  const oz = origin.z - center.z;
  const projection = ox * direction.x + oz * direction.z;
  const c = ox * ox + oz * oz - radius * radius;
  const discriminant = projection * projection - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const enter = -projection - root;
  const exit = -projection + root;
  const distance = enter >= 0 ? enter : exit >= 0 ? 0 : null;
  return distance !== null && distance <= maxDistance ? distance : null;
}

export function selectFirstTargetOnSegment<T extends DirectionalCandidate>(query: {
  origin: { x: number; z: number };
  angle: number;
  maxDistance: number;
  minDistance?: number;
  projectileRadius?: number;
  candidates: readonly T[];
}): T | null {
  const direction = { x: Math.sin(query.angle), z: Math.cos(query.angle) };
  const minimum = Math.max(0, query.minDistance ?? 0);
  let best: { candidate: T; impact: number } | null = null;
  for (const candidate of query.candidates) {
    const impact = segmentCircleTimeOfImpact(
      query.origin,
      direction,
      Math.max(0, query.maxDistance),
      candidate.pos,
      entityCombatRadius(candidate) + Math.max(0, query.projectileRadius ?? 0),
    );
    if (impact === null || impact < minimum) continue;
    if (
      !best ||
      impact < best.impact - 1e-9 ||
      (Math.abs(impact - best.impact) <= 1e-9 && candidate.id < best.candidate.id)
    ) {
      best = { candidate, impact };
    }
  }
  return best?.candidate ?? null;
}
