// The Quartered Isle's four quarters as a smooth position field. The zone is
// one biome ('quartered'), and every per-biome consumer that wants the four
// arts to read as four places (terrain tint, fog, foliage, weather) blends by
// these weights instead of switching on a hard line: the quarters bleed into
// one another the way the old war left them, and Rivalmoot's hill at the
// centre reads as neutral ground where all four meet.
//
// Pure leaf: no SimContext, no rng, no clock. The sim never reads it for a
// gameplay decision; it is shared so the renderer, the map and any test read
// one definition.

export type QuarterId = 'ice' | 'fire' | 'earth' | 'wind';

export interface QuarterWeights {
  ice: number;
  fire: number;
  earth: number;
  wind: number;
}

/** Each quarter's heart. +x is the Drakelands side (fire), -x the Amberfall
 *  side (earth), south the Frostveil side (ice), north the Gyre (wind). */
export const QUARTER_CENTERS: Readonly<Record<QuarterId, { x: number; z: number }>> = {
  ice: { x: 0, z: 2045 },
  fire: { x: 125, z: 2190 },
  earth: { x: -125, z: 2190 },
  wind: { x: 0, z: 2355 },
};

/** How far (yards) one quarter's influence carries before the next takes
 *  over: smaller is a crisper seam. */
const QUARTER_FALLOFF = 70;

/** The four weights at (x, z), summing to 1. Gaussian falloff from each
 *  quarter's heart, normalized, so any point blends its nearest arts. */
export function quarterWeightsAt(x: number, z: number): QuarterWeights {
  const k = 1 / (2 * QUARTER_FALLOFF * QUARTER_FALLOFF);
  const w = (c: { x: number; z: number }) => {
    const dx = x - c.x;
    const dz = z - c.z;
    return Math.exp(-(dx * dx + dz * dz) * k);
  };
  const ice = w(QUARTER_CENTERS.ice);
  const fire = w(QUARTER_CENTERS.fire);
  const earth = w(QUARTER_CENTERS.earth);
  const wind = w(QUARTER_CENTERS.wind);
  const sum = ice + fire + earth + wind;
  // far from every heart (deep offshore) every term underflows: call it ice,
  // the Frostveil's side, rather than divide by zero
  if (!(sum > 1e-12)) return { ice: 1, fire: 0, earth: 0, wind: 0 };
  return { ice: ice / sum, fire: fire / sum, earth: earth / sum, wind: wind / sum };
}

/** The quarter with the largest weight at (x, z). */
export function dominantQuarterAt(x: number, z: number): QuarterId {
  const q = quarterWeightsAt(x, z);
  let best: QuarterId = 'ice';
  let bestW = q.ice;
  for (const id of ['fire', 'earth', 'wind'] as const) {
    if (q[id] > bestW) {
      best = id;
      bestW = q[id];
    }
  }
  return best;
}
