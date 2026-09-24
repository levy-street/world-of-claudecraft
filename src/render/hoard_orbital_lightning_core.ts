import {
  ORBITAL_LIGHTNING as C,
  orbitalAngle,
  orbitalShotTime,
} from '../sim/rift/hoard_orbital_lightning_core';

export interface OrbitalOrbPose {
  x: number;
  y: number;
  z: number;
  scale: number;
  brightness: number;
  spin: number;
  shotAge: number;
  shotWave: number;
  impactScale: number;
  impactBrightness: number;
}

const clamp = (v: number): number => Math.max(0, Math.min(1, v));

/** Writes into caller-owned storage; the server and painter share the orbit and shot clock. */
export function orbitalOrbPose(
  elapsed: number,
  index: number,
  facing: number,
  calm: boolean,
  out: OrbitalOrbPose,
): OrbitalOrbPose {
  const firstShot = orbitalShotTime(index);
  let shotWave = Math.max(
    0,
    Math.min(C.waveCount - 1, Math.floor((elapsed - firstShot) / C.wavePeriod)),
  );
  let age = elapsed - orbitalShotTime(index, shotWave);
  if (
    age > C.shotDuration &&
    shotWave + 1 < C.waveCount &&
    elapsed >= orbitalShotTime(index, shotWave + 1) - C.prefireDuration
  ) {
    shotWave++;
    age = elapsed - orbitalShotTime(index, shotWave);
  }
  const angle = orbitalAngle(elapsed, index, facing);
  const summon = clamp((elapsed - index * 0.055) / 0.32);
  const charge = clamp((elapsed - C.summonDuration) / C.chargeDuration);
  const prefire = age < 0 ? clamp(1 + age / C.prefireDuration) : 0;
  const discharge = age >= 0 ? clamp(1 - age / C.shotDuration) : 0;
  const fade = clamp((C.totalDuration - elapsed) / C.endDuration);
  out.x = Math.sin(angle) * C.orbitRadius;
  out.y = C.orbitHeight + (calm ? 0 : Math.sin(elapsed * 3 + index * 2) * 0.09);
  out.z = Math.cos(angle) * C.orbitRadius;
  out.scale = summon * fade * (1 + prefire * 0.17 + discharge * 0.26);
  out.brightness = (0.6 + charge * 0.55 + prefire * 0.85 + discharge) * fade;
  out.spin = calm ? index : elapsed * 1.4 + index;
  out.shotAge = age;
  out.shotWave = shotWave;
  const impact = age >= 0 && age < C.residualDuration;
  out.impactScale = impact ? 0.55 + clamp(age / 0.16) * 0.85 : 0;
  out.impactBrightness = impact ? (1 - age / C.residualDuration) ** 1.5 : 0;
  return out;
}

/** A stable jagged trunk with exact endpoints. Caller supplies terrain-adjusted endpoint heights. */
export function orbitalBoltPoints(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  seed: number,
  bucket: number,
  out: Float32Array,
): void {
  const count = out.length / 3;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const envelope = i === 0 || i === count - 1 ? 0 : 0.18;
    out[i * 3] = ax + (bx - ax) * t + Math.sin(i * 17.31 + seed + bucket * 7) * envelope;
    out[i * 3 + 1] = ay + (by - ay) * t + Math.cos(i * 11.17 + seed * 2 + bucket) * envelope;
    out[i * 3 + 2] = az + (bz - az) * t + Math.sin(i * 7.43 + seed * 3 - bucket) * envelope;
  }
}
