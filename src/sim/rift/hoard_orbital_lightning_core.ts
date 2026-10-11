/** Shared deterministic choreography, consumed by the authoritative cast and its VFX. */
export const ORBITAL_LIGHTNING = Object.freeze({
  orbCount: 6,
  // Vharok's scale-3 dragonkin silhouette is substantially larger than the Blender proxy.
  orbitRadius: 6.2,
  orbitHeight: 5.2,
  orbitSpeed: 0.52,
  summonDuration: 0.65,
  chargeDuration: 1.8,
  shotDelay: 0.25,
  waveCount: 3,
  wavePeriod: 4.5,
  waveWarningLead: 1.1,
  orbSize: 0.72,
  shotLength: 4.8,
  shotDuration: 0.125,
  prefireDuration: 0.2,
  impactRadius: 2.6,
  residualDuration: 0.55,
  endDuration: 0.8,
  totalDuration: 15.15,
  damageFraction: 0.25,
});

export function orbitalShotTime(index: number, wave = 0): number {
  return (
    ORBITAL_LIGHTNING.summonDuration +
    ORBITAL_LIGHTNING.chargeDuration +
    index * ORBITAL_LIGHTNING.shotDelay +
    wave * ORBITAL_LIGHTNING.wavePeriod
  );
}

export function orbitalWaveWarningTime(wave: number): number {
  return Math.max(0, orbitalShotTime(0, wave) - ORBITAL_LIGHTNING.waveWarningLead);
}

export function orbitalAngle(elapsed: number, index: number, facing: number): number {
  return (
    facing +
    (index * Math.PI * 2) / ORBITAL_LIGHTNING.orbCount +
    elapsed * ORBITAL_LIGHTNING.orbitSpeed
  );
}

/** Offsets from the captured cast center; each target is fixed before the first shot. */
export function orbitalTarget(index: number, facing: number, wave = 0): { x: number; z: number } {
  const angle = orbitalAngle(orbitalShotTime(index, wave), index, facing);
  const radius = ORBITAL_LIGHTNING.orbitRadius + ORBITAL_LIGHTNING.shotLength;
  return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
}
