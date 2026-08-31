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

// One pool per lava AREA. The twin at (344, 2233) came out: it sat 22yd
// from its neighbour with a combined model reach of 14, so the two read as
// one lumpy smear and every river between them overlapped both.
// Moved from world.ts under the monolith ratchet: the lava pools are
// layout data, and this file is the pool tables' one home.
// Open lava pools out in the wastes (shaped as shallow flat-floored basins;
// the render lava surface sits just above each floor).
// padK: where the flat melt floor ends, as a fraction of r. The default 0.95
// keeps the whole model footprint on level ground; the Drakemaw vent keeps
// the original tight eye (0.55) because its shore is the escape bench's
// wade-out ramp (DRAKEMAW_ESCAPE), pinned by tests/terrain_escape_walkout.test.ts.
export const EMBER_LAVA_POOLS = [
  { x: 390, z: 2320, r: 14, floor: 12, padK: 0.55 }, // the vent inside the Drakemaw crater
  { x: 446, z: 2220, r: 11, floor: -0.5 },
  { x: 302, z: 2328, r: 11, floor: 0 },
  // crater pools high in the two smaller cones (padK 0.55: the pit walls
  // cradle the model's rocky ring, and the escape walkers need the legacy
  // gentle floor-to-wall transition)
  { x: 270, z: 2282, r: 7, floor: 11.5, padK: 0.55 },
  { x: 487, z: 2356, r: 6, floor: 9.5, padK: 0.55 },
  // the Moltenmaw: an open lava-lake field east of the caldera. The big eye
  // sits at (423, 2347) so its whole model footprint (r * 1.15) stays clear
  // of the Drakemaw escape bench ring (benchFade 23 from the vent), whose
  // every-azimuth dry-shore guarantee is pinned by tests/terrain_escape_walkout.
  { x: 423, z: 2347, r: 16, floor: -1.2 },
  { x: 438, z: 2326, r: 10, floor: -1.2 },
] as const;

export const EMBER_FLAT_POOLS: readonly EmberFlatPool[] = [
  { x: 330, z: 2250, r: 8, h: 3.4 },
  { x: 418, z: 2196, r: 7, h: 5.4 },
] as const;

/** How a run terminates at one of its mouths: pouring into a pool, or
 *  spending itself on open ground under a river END cap. */
export type EmberLavaMouth = 'pool' | 'cap';

/** One river run. Most join two pools (a flat pool or a shaped basin
 *  mouth); a run may also spill onto open waste, which is where the END
 *  piece of the three-asset vocabulary belongs. */
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
  /** how the (x0, z0) mouth ends (render-only; the grader beds the whole
   *  polyline either way) */
  m0: EmberLavaMouth;
  /** how the (x1, z1) mouth ends */
  m1: EmberLavaMouth;
}

// Endpoints reference EMBER_FLAT_POOLS and world.ts EMBER_LAVA_POOLS (the
// shaped basins). Mouth bed heights sit just above the receiving pool's melt
// surface so the pour-in reads downhill, never uphill.
export const EMBER_LAVA_LINKS: readonly EmberLavaLink[] = [
  // ONE run per lava area, and one river piece per run: a pool, the river
  // that leaves it, and the end that spends it. The old network ran four
  // pool-to-pool links whose chords needed 2, 11, 5 and 2 river pieces to
  // span, so a single area could stack eleven overlapping models into one
  // long smear. Each run below is sized so exactly one middle fits between
  // the pool's edge and its end cap.
  {
    x0: 330,
    z0: 2250,
    h0: 3.4,
    x1: 309,
    z1: 2237,
    h1: 1.0,
    w: 9,
    amp: 1.1,
    wavelength: 38,
    phase: 0.7,
    trim0: 8,
    trim1: 0,
    m0: 'pool',
    m1: 'cap',
  },
  {
    x0: 418,
    z0: 2196,
    h0: 5.4,
    x1: 436,
    z1: 2210,
    h1: 1.9,
    w: 8,
    amp: 1.0,
    wavelength: 34,
    phase: 2.6,
    trim0: 7,
    trim1: 0,
    m0: 'pool',
    m1: 'cap',
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
