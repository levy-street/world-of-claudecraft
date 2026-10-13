// Presentation timing only. Combat resolves on the authoritative cast-completion tick.
export const SPIRIT_BOMB_VISUAL = Object.freeze({
  slots: 4,
  particles: 160,
  radius: 3.2,
  lift: 3.4,
  flight: 0.24,
  impact: 1.1,
  blastRadius: 8,
});

export interface BombPoint {
  x: number;
  y: number;
  z: number;
}

export function bombChargeRadius(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return 0.35 + (SPIRIT_BOMB_VISUAL.radius - 0.35) * p ** 0.72;
}

export function bombFlightInto(out: BombPoint, from: BombPoint, to: BombPoint, age: number): void {
  const t = Math.max(0, Math.min(1, age / SPIRIT_BOMB_VISUAL.flight));
  const p = t * t * (3 - 2 * t);
  out.x = from.x + (to.x - from.x) * p;
  out.y = from.y + (to.y - from.y) * p + Math.sin(t * Math.PI) * 1.2;
  out.z = from.z + (to.z - from.z) * p;
}

// A stable spherical distribution spirals inward during charge, then throws out
// embers on the blast. No randomness, allocations or frame-rate-dependent emission.
export function bombParticleInto(
  out: BombPoint,
  index: number,
  time: number,
  radius: number,
  blast: number,
): number {
  const seed = ((index * 73) % 163) / 163;
  const cycle = (seed + time * 0.28) % 1;
  const y = 1 - 2 * ((index + 0.5) / SPIRIT_BOMB_VISUAL.particles);
  const flat = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * 2.39996323 + time * (0.45 + seed * 0.4) + cycle * 2;
  const reach = blast >= 0 ? radius + blast * (3 + seed * 6) : radius * (1.08 + (1 - cycle) * 1.3);
  out.x = Math.cos(angle) * flat * reach;
  out.y = y * reach;
  out.z = Math.sin(angle) * flat * reach;
  return blast >= 0 ? Math.max(0, 1 - blast) : Math.sin(cycle * Math.PI);
}
