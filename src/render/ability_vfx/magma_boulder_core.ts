// Pure core of the Magma Burst cracking boulder (the Shaman's lava_burst): a
// volcanic rock that leaves the caster's hand as a pebble and arrives as a
// boulder, its crust plates drifting apart as it swells so the glowing cracks
// between them open and widen; the growth, crack and light curves that one
// flight progress drives; the crust's plate split; the impact clock; and what
// each budget tier draws. Three-, DOM- and i18n-free; every random value is a
// deterministic hash or an injected source, so a test drives it directly. The
// Three-side owners are ../magma_boulder_visual.ts (the rock) and
// magma_boulders.ts (the pool that rides the projectile).

/** The rock's radius at arrival, in yards, and its size at the hand as a
 * fraction of that: a pebble that swells into a boulder. */
export const BOULDER_RADIUS = 0.6;
export const BOULDER_START_SCALE = 0.25;
/** The gap between crust plates as a fraction of the radius, at launch and at
 * arrival: the cracks open and widen as it grows. */
export const CRACK_GAP_START = 0.03;
export const CRACK_GAP_END = 0.26;
/** Seconds the ring of fire burns at the target's feet, its radius in yards,
 * and how many waves of flame it lights over that life. */
export const FIRE_RING_S = 1.3;
export const FIRE_RING_RADIUS = 2.2;
export const RING_WAVES = 4;
/** The world's lava light (ember_features.ts, the Drakelands lava pools: a
 * 0xff5a18 point light of intensity 8 reaching 3.4 times the pool's radius,
 * decay 2). The boulder is lit as a piece of that same lava: its colour, its
 * level and its reach per yard of lava. */
export const LAVA_LIGHT_COLOR = 0xff5a18;
export const LAVA_POOL_INTENSITY = 8;
export const LAVA_REACH_PER_RADIUS = 3.4;
/** The lava pool the boulder reads as: in flight at full size, a small crater
 * pool (radius 7); its burst, a mid lava pool (radius 11). */
export const FLIGHT_LAVA_RADIUS = 7;
export const IMPACT_LAVA_RADIUS = 11;
/** Flight light at full size, the burst peak and the ring of fire, as
 * multiples of one lava pool's level. A pool's brightness mostly comes from
 * its own glowing surface and its neighbours' lights, so one rock lit at a
 * single pool's level barely reads on daylit ground: it carries several. */
export const FLIGHT_LAVA_GAIN = 3;
export const IMPACT_LAVA_GAIN = 8;
export const RING_LAVA_GAIN = 2;
/** Crust radial jitter: a craggy rock, not a ball. */
export const CRAG_AMP = 0.16;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How far along its flight a projectile is, 0 at launch to 1 at arrival,
 * from the distance it started at and the distance left. A degenerate start
 * (launched on top of its target) reads as arrived. */
export function flightProgress(startDist: number, distLeft: number): number {
  if (!(startDist > 1e-3)) return 1;
  return clamp01(1 - distLeft / startDist);
}

/** The rock's size multiplier at a flight progress (1 = BOULDER_RADIUS). */
export function boulderScale(progress: number): number {
  return BOULDER_START_SCALE + (1 - BOULDER_START_SCALE) * clamp01(progress);
}

/** The crack gap at a flight progress, as a fraction of the current radius. */
export function crackGap(progress: number): number {
  return CRACK_GAP_START + (CRACK_GAP_END - CRACK_GAP_START) * clamp01(progress);
}

/** The travelling light grows with the rock: intensity and range multiplier. */
export function flightLightScale(progress: number): number {
  return 0.45 + 0.95 * clamp01(progress);
}

/** Light gain after impact: full at the burst, a quick fall, then the ring of
 * fire's glow (RING_LAVA_GAIN pools, IMPACT_RING_GAIN of the burst) until it
 * burns out. */
export function impactLightGain(since: number): number {
  if (since < 0 || since >= FIRE_RING_S) return 0;
  if (since < 0.08) return 1;
  const burst = Math.max(0, 1 - (since - 0.08) / 0.4);
  const ring = IMPACT_RING_GAIN * (1 - since / FIRE_RING_S);
  return Math.max(burst * burst, ring);
}

/** The ring of fire's glow as a share of the burst peak. */
export const IMPACT_RING_GAIN = RING_LAVA_GAIN / IMPACT_LAVA_GAIN;

export interface LavaLight {
  intensity: number;
  range: number;
}

/** The travelling light at a flight progress: a lava pool's colour and level
 * scaled by the rock's growth, reaching as far as that pool would. */
export function flightLavaLight(progress: number, out: LavaLight): LavaLight {
  const grow = flightLightScale(progress) / flightLightScale(1);
  out.intensity = LAVA_POOL_INTENSITY * FLIGHT_LAVA_GAIN * grow;
  out.range = LAVA_REACH_PER_RADIUS * FLIGHT_LAVA_RADIUS * grow;
  return out;
}

/** The burst and ring-of-fire light `since` seconds after impact. */
export function impactLavaLight(since: number, out: LavaLight): LavaLight {
  out.intensity = LAVA_POOL_INTENSITY * IMPACT_LAVA_GAIN * impactLightGain(since);
  out.range = LAVA_REACH_PER_RADIUS * IMPACT_LAVA_RADIUS;
  return out;
}

/** When each ring-of-fire wave fires, seconds after the burst. */
export function ringWaveAt(wave: number): number {
  return 0.05 + (wave * (FIRE_RING_S - 0.4)) / RING_WAVES;
}

/** The twelve directions of an icosahedron's vertices: the plate seeds. */
export const PLATE_SEEDS: readonly (readonly [number, number, number])[] = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  return raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l] as const;
  });
})();

/** A deterministic 0..1 hash of a (rounded) position: a vertex shared by two
 * plates gets the same value, so their edges stay matched. */
export function vertexHash(x: number, y: number, z: number): number {
  const q = (v: number) => Math.round(v * 1000);
  let h = Math.imul(q(x), 73856093) ^ Math.imul(q(y), 19349663) ^ Math.imul(q(z), 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export interface CrustPlate {
  /** Index into PLATE_SEEDS: the direction this plate drifts along. */
  seed: number;
  /** Packed x, y, z triangles (unit-radius, craggy). */
  positions: Float32Array;
}

/**
 * Split a unit sphere mesh (non-indexed triangles, packed x, y, z) into crust
 * plates: every triangle joins the seed its centroid faces most, and every
 * vertex is pushed in or out by its deterministic crag hash so the rock is
 * craggy while shared edges still meet. Plates with no triangles are dropped.
 */
export function splitIntoPlates(positions: Float32Array, cragAmp = CRAG_AMP): CrustPlate[] {
  const buckets: number[][] = PLATE_SEEDS.map(() => []);
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const cx = (positions[i] + positions[i + 3] + positions[i + 6]) / 3;
    const cy = (positions[i + 1] + positions[i + 4] + positions[i + 7]) / 3;
    const cz = (positions[i + 2] + positions[i + 5] + positions[i + 8]) / 3;
    let best = 0;
    let bestDot = -2;
    for (let s = 0; s < PLATE_SEEDS.length; s++) {
      const d = PLATE_SEEDS[s];
      const dot = cx * d[0] + cy * d[1] + cz * d[2];
      if (dot > bestDot) {
        bestDot = dot;
        best = s;
      }
    }
    for (let v = 0; v < 3; v++) {
      const x = positions[i + v * 3];
      const y = positions[i + v * 3 + 1];
      const z = positions[i + v * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      const r = 1 + cragAmp * (vertexHash(x, y, z) * 2 - 1);
      buckets[best].push((x / len) * r, (y / len) * r, (z / len) * r);
    }
  }
  const plates: CrustPlate[] = [];
  buckets.forEach((b, seed) => {
    if (b.length > 0) plates.push({ seed, positions: new Float32Array(b) });
  });
  return plates;
}

export interface MagmaBurstPlan {
  /** Lava dripping off the boulder in flight. */
  drips: boolean;
  /** The ring of fire at the target's feet after the burst. */
  fireRing: boolean;
}

/** VFX quality (the render budget's 0..1 level) below which the drips go. */
export const BOULDER_FULL_QUALITY = 0.5;

/**
 * What a Magma Burst draws on a given ability-VFX budget tier and VFX quality:
 * tier 0 the full boulder with drips and the ring of fire; tier 1 the growing
 * boulder and its shatter alone; tier 2 (the spam floor) nothing, which keeps
 * the color-only heavy bolt. Falling quality sheds the drips. Cosmetic only:
 * the flight time and the hit are identical on every arm.
 */
export function magmaBurstPlan(tier: number, quality = 1): MagmaBurstPlan | null {
  if (tier >= 2) return null;
  const full = tier === 0;
  return { drips: full && quality >= BOULDER_FULL_QUALITY, fireRing: full };
}
