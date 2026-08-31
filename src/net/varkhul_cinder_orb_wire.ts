// Strict snapshot decoders for Varkhul's reconnect-safe permanent fires and
// traveling Cinder Orbs. Malformed or future rows are dropped, never rendered.

import type {
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from '../sim/varkhul_cinder_orbs';

function finiteNumbers(values: unknown[]): values is number[] {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

export function decodeVarkhulCinderFires(value: unknown): ActiveVarkhulCinderFire[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown): ActiveVarkhulCinderFire[] => {
    if (!row || typeof row !== 'object') return [];
    const fire = row as Record<string, unknown>;
    if (
      typeof fire.id !== 'string' ||
      !finiteNumbers([fire.sourceId, fire.x, fire.z, fire.r]) ||
      (fire.sourceId as number) < 0 ||
      (fire.r as number) <= 0
    ) {
      return [];
    }
    return [
      {
        id: fire.id,
        sourceId: fire.sourceId as number,
        x: fire.x as number,
        z: fire.z as number,
        radius: fire.r as number,
      },
    ];
  });
}

export function decodeVarkhulCinderOrbProjectiles(
  value: unknown,
): ActiveVarkhulCinderOrbProjectile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown): ActiveVarkhulCinderOrbProjectile[] => {
    if (!row || typeof row !== 'object') return [];
    const projectile = row as Record<string, unknown>;
    if (
      typeof projectile.id !== 'string' ||
      !finiteNumbers([
        projectile.sourceId,
        projectile.x,
        projectile.z,
        projectile.dx,
        projectile.dz,
        projectile.r,
        projectile.dur,
        projectile.rem,
      ]) ||
      (projectile.sourceId as number) < 0 ||
      (projectile.r as number) <= 0 ||
      (projectile.dur as number) <= 0 ||
      (projectile.rem as number) <= 0
    ) {
      return [];
    }
    return [
      {
        id: projectile.id,
        sourceId: projectile.sourceId as number,
        x: projectile.x as number,
        z: projectile.z as number,
        dirX: projectile.dx as number,
        dirZ: projectile.dz as number,
        radius: projectile.r as number,
        duration: projectile.dur as number,
        remaining: Math.min(projectile.rem as number, projectile.dur as number),
      },
    ];
  });
}
