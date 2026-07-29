// The Drakelands' modeled lava network: the single source of truth shared by
// the terrain grader (world.ts applyEmberLavaNetwork) and the render layer
// (render/ember_features.ts). Both sides read the SAME pool records and the
// SAME meander polylines, so the graded bed always sits flush under every
// modeled piece: the render chain cannot wander off its bed, and the bed
// never grades ground no model covers (the old system kept straight-line
// beds under seed-swayed render chains, which is exactly how pools and
// rivers ended up floating). Pure leaf: no imports, no rng. The meander
// phases are authored constants, NOT seed-derived, so the terrain and the
// render agree at every world seed.

/** A render-only network pool out on the open waste: a flat melt disc whose
 *  ground pad is graded level at `h` under the whole model footprint. */
export interface EmberFlatPool {
  x: number;
  z: number;
  /** melt-disc radius in world units (the model fp is 2r) */
  r: number;
  /** the pad height the terrain grades to (the model rests here) */
  h: number;
}

export const EMBER_FLAT_POOLS: readonly EmberFlatPool[] = [
  { x: 330, z: 2250, r: 8, h: 3.4 },
  { x: 344, z: 2233, r: 6, h: 3.4 },
  { x: 418, z: 2196, r: 7, h: 5.4 },
] as const;

/** One river run joining exactly two pools (a flat pool or a shaped basin
 *  mouth). The network is a TREE: one link per pool pair, no orphan runs. */
export interface EmberLavaLink {
  x0: number;
  z0: number;
  /** bed height at the (x0, z0) mouth */
  h0: number;
  x1: number;
  z1: number;
  /** bed height at the (x1, z1) mouth */
  h1: number;
  /** channel width in world units; river pieces render at this fp */
  w: number;
  /** meander amplitude (world units; capped well under w so the channel
   *  never leaves the graded bed) */
  amp: number;
  /** meander wavelength along the run */
  wavelength: number;
  /** authored phase: fixed per link so terrain and render always agree */
  phase: number;
  /** river pieces start this far from (x0, z0): the pool model's edge */
  trim0: number;
  /** ...and stop this far short of (x1, z1) */
  trim1: number;
}

// Endpoints reference EMBER_FLAT_POOLS and world.ts EMBER_LAVA_POOLS (the
// shaped basins). Mouth bed heights sit just above the receiving pool's melt
// surface so the pour-in reads downhill, never uphill.
export const EMBER_LAVA_LINKS: readonly EmberLavaLink[] = [
  // the twin waste pools' own short link
  // biome-ignore format: link rows read best as single lines
  { x0: 330, z0: 2250, h0: 3.4, x1: 344, z1: 2233, h1: 3.4, w: 10, amp: 1.2, wavelength: 40, phase: 1.1, trim0: 8, trim1: 6 },
  // the long run south from the twin pools into the waste basin (gentle
  // sway: the short bendy river pieces add their own curl on top, so a
  // tight authored meander made the chain read as loops)
  {
    x0: 330,
    z0: 2250,
    h0: 3.4,
    x1: 302,
    z1: 2328,
    h1: 0.6,
    w: 12,
    amp: 1.8,
    wavelength: 64,
    phase: 4.2,
    trim0: 8,
    trim1: 11,
  },
  // the north pool down into the spring basin
  {
    x0: 418,
    z0: 2196,
    h0: 5.4,
    x1: 446,
    z1: 2220,
    h1: 0.2,
    w: 11,
    amp: 1.6,
    wavelength: 56,
    phase: 2.6,
    trim0: 7,
    trim1: 11,
  },
  // the Moltenmaw pair: the lake field's two eyes joined across the saddle
  {
    x0: 423,
    z0: 2347,
    h0: -0.2,
    x1: 438,
    z1: 2326,
    h1: -0.2,
    w: 14,
    amp: 1.4,
    wavelength: 48,
    phase: 5.3,
    trim0: 15,
    trim1: 10,
  },
] as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface EmberLinkPoint {
  x: number;
  z: number;
  /** bed height at this point (smooth grade from h0 to h1) */
  h: number;
}

/** The meander curve at arc distance d along the straight chord. The sway
 *  fades to zero at both ends so the mouths stay centered on their pools. */
export function emberLinkPoint(link: EmberLavaLink, d: number): EmberLinkPoint {
  const len = Math.hypot(link.x1 - link.x0, link.z1 - link.z0);
  const t = clamp01(d / len);
  const dirx = (link.x1 - link.x0) / len;
  const dirz = (link.z1 - link.z0) / len;
  const fade = Math.sin(Math.min(Math.PI, t * Math.PI));
  const off = Math.sin((d * Math.PI * 2) / link.wavelength + link.phase) * link.amp * fade;
  return {
    x: link.x0 + dirx * d - dirz * off,
    z: link.z0 + dirz * d + dirx * off,
    // ease the grade so the bed leaves each mouth level, not kinked
    h: link.h0 + (link.h1 - link.h0) * sstep(0, 1, t),
  };
}

const POLYLINE_STEP = 2;
const polylineCache = new Map<EmberLavaLink, EmberLinkPoint[]>();

/** The link's meander sampled every POLYLINE_STEP units (cached). */
export function emberLinkPolyline(link: EmberLavaLink): readonly EmberLinkPoint[] {
  let pts = polylineCache.get(link);
  if (!pts) {
    const len = Math.hypot(link.x1 - link.x0, link.z1 - link.z0);
    pts = [];
    for (let d = 0; d <= len; d += POLYLINE_STEP) pts.push(emberLinkPoint(link, d));
    pts.push(emberLinkPoint(link, len));
    polylineCache.set(link, pts);
  }
  return pts;
}

export interface EmberBedSample {
  /** distance from (x, z) to the nearest point of the meander polyline */
  dist: number;
  /** bed height at that nearest point */
  h: number;
}

/** Nearest point on ONE link's meander (polyline vertices; 2-unit sampling
 *  is well inside the smoothstep blend bands the terrain uses). */
export function emberNearestOnLink(link: EmberLavaLink, x: number, z: number): EmberBedSample {
  const pts = emberLinkPolyline(link);
  let best = Infinity;
  let h = link.h0;
  for (const p of pts) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < best) {
      best = d;
      h = p.h;
    }
  }
  return { dist: best, h };
}

/** Distance to the nearest link channel, NORMALIZED by that link's width
 *  (dist / w). Rims and lips part where this drops under ~1, so every melt
 *  mouth pours in flush instead of climbing a bank. */
export function emberLinkDistanceNorm(x: number, z: number): number {
  let best = Infinity;
  for (const link of EMBER_LAVA_LINKS) {
    const s = emberNearestOnLink(link, x, z);
    best = Math.min(best, s.dist / link.w);
  }
  return best;
}
