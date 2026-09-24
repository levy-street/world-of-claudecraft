/** Fast pressure onset, readable material breakup, then a clean short tail.
 * Only steel/spirit receiving sheets opt in; approved blood timing is untouched. */
export function warriorShearPhase(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  if (p < 0.18) return (p / 0.18) * 0.3;
  if (p < 0.72) return 0.3 + ((p - 0.18) / 0.54) * 0.42;
  return 0.72 + ((p - 0.72) / 0.28) * 0.28;
}

export interface WarriorMetalEjecta {
  x: number;
  y: number;
  z: number;
  speed: number;
  lift: number;
  tint: number;
}

/** Torn flakes, long swarf and small chips share one existing instanced draw.
 * Unequal lengths and exit speeds give a short burst a readable outer silhouette. */
export function warriorMetalEjecta(out: WarriorMetalEjecta, index: number, seed: number): void {
  const kind = (index + seed) % 4;
  out.x = kind === 0 ? 0.36 : kind === 1 ? 1.75 : kind === 2 ? 0.65 : 0.85;
  out.y = kind === 0 ? 2.8 : kind === 1 ? 0.28 : kind === 2 ? 1.65 : 0.65;
  out.z = kind === 1 ? 0.14 : 0.24 + (index % 3) * 0.12;
  out.speed = 2.35 + ((index * 7 + seed) % 5) * 0.24;
  out.lift = 0.42 + ((index * 3 + seed) % 7) * 0.14;
  out.tint = 0.68 + ((index * 5 + seed) % 11) * 0.038;
}
