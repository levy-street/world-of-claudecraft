import type { Vec3 } from './types';

export interface ShadowPatrol {
  x: number;
  z: number;
  period: number;
  pause: number;
}
/** Both ends have a visible watch pause; period is travel time for one leg. */
export function shadowPatrolPosition(
  start: { x: number; z: number },
  patrol: ShadowPatrol,
  seconds: number,
) {
  const leg = patrol.period + patrol.pause;
  const phase = ((seconds % (2 * leg)) + 2 * leg) % (2 * leg);
  const returning = phase >= leg;
  const travel = Math.max(0, (phase % leg) - patrol.pause) / patrol.period;
  const fraction = returning ? 1 - travel : travel;
  return {
    x: start.x + (patrol.x - start.x) * fraction,
    z: start.z + (patrol.z - start.z) * fraction,
    facing: Math.atan2(patrol.x - start.x, patrol.z - start.z) + (returning ? Math.PI : 0),
  };
}
/** A forward lantern cone: a guard that carries one sees a cloaked player anywhere inside it. */
export interface ShadowCone {
  radius: number;
  /** Half the cone opening, in radians, measured from the guard's facing. */
  halfAngle: number;
}

export interface ShadowDetectionDef {
  /** Contact circle around the guard, always active. */
  detectionRadius: number;
  cone?: ShadowCone;
}

/** The one detection rule: the contact circle, plus the forward cone when the guard carries one. */
export function shadowGuardDetects(
  def: ShadowDetectionDef,
  guard: { pos: Pick<Vec3, 'x' | 'z'>; facing: number },
  player: Pick<Vec3, 'x' | 'z'>,
): boolean {
  const dx = player.x - guard.pos.x,
    dz = player.z - guard.pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < def.detectionRadius) return true;
  const cone = def.cone;
  if (!cone || distance >= cone.radius || distance <= 0) return false;
  const forward = (dx * Math.sin(guard.facing) + dz * Math.cos(guard.facing)) / distance;
  return forward >= Math.cos(cone.halfAngle);
}

/** A broad rear pocket, not an extra detection cone. The lantern cues remain the danger cues. */
export function shadowBehindCarrier(
  player: Pick<Vec3, 'x' | 'z'>,
  carrier: { pos: Pick<Vec3, 'x' | 'z'>; facing: number },
): boolean {
  const dx = player.x - carrier.pos.x,
    dz = player.z - carrier.pos.z;
  const distance = Math.hypot(dx, dz);
  return (
    distance > 0.1 &&
    (dx * Math.sin(carrier.facing) + dz * Math.cos(carrier.facing)) / distance <= -0.5
  );
}
