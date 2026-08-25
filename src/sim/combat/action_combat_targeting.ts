import type { AbilityDef } from '../types';
import { abilityUsesDirectionalHostileAim } from './directional_attack';

export interface ActionCombatAim {
  x: number;
  z: number;
}

export interface ActionCombatCandidate {
  id: number;
  pos: ActionCombatAim;
}

export interface ActionCombatTargetQuery {
  origin: ActionCombatAim;
  aim: ActionCombatAim;
  fallbackFacing: number;
  maxRange: number;
  minRange?: number;
  candidates: readonly ActionCombatCandidate[];
  halfAngle?: number;
}

// A 60-degree total cone keeps reticle aiming forgiving without vacuuming in
// enemies that are visibly beside the cursor ray.
export const ACTION_COMBAT_CONE_HALF_ANGLE = Math.PI / 6;

/**
 * Entity-targeted offensive abilities may use action aim. Friendly, dead-ally,
 * ground-position and the weapon-enchant polymorphic cast retain their authored
 * target rules.
 */
export function abilityUsesActionCombatAim(ability: AbilityDef): boolean {
  return abilityUsesDirectionalHostileAim(ability);
}

/**
 * Select the hostile closest to the aim ray, then the closest hostile, then the
 * lowest entity id. The last comparison makes equal geometry deterministic.
 * Hostility, life, stealth and line-of-sight filtering remain server-owned by
 * the caller.
 */
export function selectActionCombatTarget<T extends ActionCombatCandidate>(
  query: ActionCombatTargetQuery & { candidates: readonly T[] },
): T | null {
  const dx = query.aim.x - query.origin.x;
  const dz = query.aim.z - query.origin.z;
  const aimLength = Math.hypot(dx, dz);
  const forwardX = aimLength > 1e-6 ? dx / aimLength : Math.sin(query.fallbackFacing);
  const forwardZ = aimLength > 1e-6 ? dz / aimLength : Math.cos(query.fallbackFacing);
  const minRange = Math.max(0, query.minRange ?? 0);
  const maxRange = Math.max(0, query.maxRange);
  const minimumDot = Math.cos(query.halfAngle ?? ACTION_COMBAT_CONE_HALF_ANGLE);

  let best: { candidate: T; angle: number; distance: number } | null = null;
  for (const candidate of query.candidates) {
    const tx = candidate.pos.x - query.origin.x;
    const tz = candidate.pos.z - query.origin.z;
    const distance = Math.hypot(tx, tz);
    if (distance < minRange || distance > maxRange) continue;

    // Overlapping targets have no meaningful angular error and are considered
    // directly under the reticle ray.
    const dot = distance > 1e-6 ? (tx * forwardX + tz * forwardZ) / distance : 1;
    if (dot < minimumDot) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (
      !best ||
      angle < best.angle - 1e-9 ||
      (Math.abs(angle - best.angle) <= 1e-9 &&
        (distance < best.distance - 1e-9 ||
          (Math.abs(distance - best.distance) <= 1e-9 && candidate.id < best.candidate.id)))
    ) {
      best = { candidate, angle, distance };
    }
  }
  return best?.candidate ?? null;
}
