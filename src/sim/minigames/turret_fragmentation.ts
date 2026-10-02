// Fire and Fly fragmentation shell, the half the engine (turret_defense.ts)
// drives: the burst a frag shell makes where a shell would land, the fixed star
// its bomblets land on (turned to the shot's bearing, no draw), when each lands,
// and the blast each makes. The blasts themselves are the engine's, on the
// shell's falloff and launch rules. Pure: private stateless draws only, no clock.

import { TURRET_FRAGMENTATION, TURRET_WEAPON } from '../content/turret_defense';
import { groundOr, type ThrowProbe } from './thrown_body';
import type { TurretBlast, TurretEvent, TurretShot } from './turret_defense';
import { TURRET_STREAM } from './turret_defense_rng';

const TAU = Math.PI * 2;

/** A frag shell that burst, its bomblets landing in turn. */
export interface TurretFragBurst {
  shotId: number;
  /** The aim point, the centre bomblet's spot. */
  x: number;
  z: number;
  /** Unit bearing of the shot from the tower: the first outer bomblet lands straight ahead. */
  dirX: number;
  dirZ: number;
  /** The shot's core damage, as a shell's. */
  damage: number;
  burstTick: number;
  /** Bomblets landed so far, in landing order. */
  landed: number;
  /** A landed bomblet hit a body: the frag then counts as one hit. */
  hit: boolean;
}

export interface TurretBomblet {
  index: number;
  x: number;
  z: number;
  landTick: number;
}

export interface TurretBombletSpot extends TurretBomblet {
  y: number;
}

/** Bomblets per frag shell: the centre and the outer circle. */
export const TURRET_BOMBLETS = 1 + TURRET_FRAGMENTATION.outerCount;

/**
 * The star, in landing order: the centre on the aim point first, then the outer
 * bomblets one tick apart, the first straight ahead along the bearing, the rest
 * clockwise seen from above (bearing x += sin, z += cos, decreasing).
 */
export function turretFragBomblets(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  burstTick: number,
): TurretBomblet[] {
  const f = TURRET_FRAGMENTATION;
  const out: TurretBomblet[] = [];
  for (let i = 0; i < TURRET_BOMBLETS; i++) {
    const landTick = burstTick + (i === 0 ? f.centreDelayTicks : f.outerDelayTicks + i - 1);
    out.push({ index: i, x: 0, z: 0, landTick });
  }
  writeTurretFragStar(x, z, dirX, dirZ, out);
  return out;
}

/**
 * The star's spots written into `out` (at least TURRET_BOMBLETS entries), the same
 * points as turretFragBomblets with no allocation: the HUD reticle reads it per frame.
 */
export function writeTurretFragStar<P extends { x: number; z: number }>(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  out: readonly P[],
): readonly P[] {
  const f = TURRET_FRAGMENTATION;
  const bearing = Math.atan2(dirX, dirZ);
  out[0].x = x;
  out[0].z = z;
  for (let i = 0; i < f.outerCount; i++) {
    const angle = bearing - (i * TAU) / f.outerCount;
    out[i + 1].x = x + Math.sin(angle) * f.outerRadius;
    out[i + 1].z = z + Math.cos(angle) * f.outerRadius;
  }
  return out;
}

/** A frag shell's burst at its impact tick, from the tower at (cx, cz), and the event that shows it. */
export function burstTurretFrag(
  shot: TurretShot,
  cx: number,
  cz: number,
  tick: number,
  probe: ThrowProbe,
): { frag: TurretFragBurst; event: TurretEvent } {
  const dx = shot.x - cx;
  const dz = shot.z - cz;
  const len = Math.hypot(dx, dz);
  const dirX = len > 1e-9 ? dx / len : 0;
  const dirZ = len > 1e-9 ? dz / len : 1;
  const frag: TurretFragBurst = {
    shotId: shot.id,
    x: shot.x,
    z: shot.z,
    dirX,
    dirZ,
    damage: shot.damage,
    burstTick: tick,
    landed: 0,
    hit: false,
  };
  const bomblets = turretFragBomblets(shot.x, shot.z, dirX, dirZ, tick).map(
    (b): TurretBombletSpot => ({ ...b, y: groundOr(probe, b.x, b.z, 0) }),
  );
  return {
    frag,
    event: {
      type: 'fragBurst',
      shotId: shot.id,
      x: shot.x,
      y: groundOr(probe, shot.x, shot.z, 0) + TURRET_FRAGMENTATION.burstHeight,
      z: shot.z,
      bomblets,
    },
  };
}

/** A bomblet's blast: a shell's of a shorter reach, on the frag's core damage. */
export function turretBombletBlast(frag: TurretFragBurst, bomblet: TurretBomblet): TurretBlast {
  const f = TURRET_FRAGMENTATION;
  return {
    x: bomblet.x,
    z: bomblet.z,
    radius: f.blastRadius,
    core: f.blastCore,
    damage: frag.damage * f.damageScale,
    push: TURRET_WEAPON.push * f.throwScale,
    pop: TURRET_WEAPON.pop * f.throwScale,
    stream: TURRET_STREAM.bombletThrow,
    key: frag.shotId * TURRET_BOMBLETS + bomblet.index,
  };
}
