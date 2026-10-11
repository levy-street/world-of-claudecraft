// Local walkability grades on the Thornpeak Heights side of the natural
// relief: small authored corrections where the peaks biome's hill, crag, and
// detail noise (world.ts baseHeight) built an unclimbable feature right where
// a player walks. Each is a pure function of (x, z[, seed]) over the height
// the terrain chain has built so far, wired into world.ts terrainHeightUnpadded
// behind its own terrain_region_index.ts bounds: no content table, no road, no
// camp, so none of them can move roadDistance calming or any rng-consuming
// system. Pure leaf: deterministic, no rng, no SimContext.

import { STRIP_MAX_X } from './data';
import { WORLD_SEED } from './world_seed';

// Bit-identical to world.ts's own smoothstep: the Gardenwalk pass moved here
// verbatim and must keep its exact heights.
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// The Gardenwalk pass floor, mirrored onto the Thornpeak (west/strip) side
// of the border: applyGardenCoast's passW (world.ts) only reaches the east
// column (its blend rides "seam", the coastal cross-fade into the strip,
// which is near zero west of the border). Without a matching flatten here
// the peaks biome's full hill/crag/detail noise (baseHeight) runs right up
// to the crossing: player report, a small unclimbable step around x=173,
// z=797. A pure function of (x, z), like every applier in this file: it
// touches no content table, so it cannot move roadDistance calming or any
// other rng-consuming system.
export function applyGardenwalkWestPass(x: number, z: number, h: number): number {
  // Symmetric around the border line itself (not a one-sided cutoff at
  // STRIP_MAX_X): a hard x < STRIP_MAX_X gate left a seam exactly at the
  // border, where this window's near-full weight met applyGardenCoast's
  // own passW at whatever partial "seam" it had reached there, and the two
  // land on different baseline math (this blends raw h; that blends a
  // coastal "out" value), so the join was not even C0. Peaking gently AT the
  // border and fading both directions instead overlaps applyGardenCoast's
  // effect on the east side, but both blends pull the same direction (down
  // toward the ~6 pass floor), so composing them stays smooth.
  const w =
    (1 - smoothstep(26, 52, Math.abs(z - 800))) *
    (1 - smoothstep(0, 58, Math.abs(x - STRIP_MAX_X)));
  if (w <= 0) return h;
  return h + (6 + (h - 6) * 0.08 - h) * w;
}

// The hillside pocket west of the Highwatch practice row (player report:
// stuck at the minimap readout "-69, 631", /unstuck the only way out). The
// gradient-damped hill fbm (terrain_relief.ts erodedFbm2) damps each octave
// by the running gradient INCLUDING that octave's own derivative, so its top
// octave spikes about ninefold across the yard where that gradient crosses
// zero. Here the spike landed on the steep stretch of highlandMask, which
// doubled it through the crag layer: a crest about 2yd tall and 1.5yd wide,
// narrower than the render lattice (it reads as open hillside) but far past
// the climb gate (it walks like a wall). With the crag face and its boulder
// to the west and a terrace step to the north, the crest shut the downhill
// side of a small pit; the only ways out were a narrow groove south-east and
// one line north-east.
//
// The grade blends the whole knot (crest, pit, and crag face) onto the
// hillside's own smooth surface: a quadratic least-squares fitted to the
// finished shipped-seed terrainHeight on the ring just outside the window (a
// plane could not follow the slope's curvature, so its fade added a steep
// rim of its own). This applier returns the surface outright inside rIn and
// leaves the hillside untouched past rOut; the chain's later universal
// altitude roughening still rides on top, so the finished ground inside rIn
// sits within about 0.6yd of the surface (low frequency, and already part
// of the ring the fit saw). To re-fit, fit finished terrainHeight on that
// ring again. The surface falls east toward the practice row and rises
// north, under 1.0 rise/run everywhere inside rIn, well below the 1.5 climb
// gate.
//
// SHIPPED SEED ONLY: the crest is an artifact of the WORLD_SEED noise, and on
// any other seed (the RL env accepts arbitrary seeds) the same hillside sits
// at a different height, where a frozen surface would stamp a mound or a
// hole. tests/thornpeak_hillside_pocket.test.ts pins the fit against drift:
// if later terrain work moves the natural ring off this surface, re-fit it.
export const THORNPEAK_POCKET_GRADE = {
  x: -67.5,
  z: 629,
  // the fitted hillside, in offsets (dx, dz) from the center above:
  // h = h0 + gx dx + gz dz + gxx dx^2 + gxz dx dz + gzz dz^2
  h0: 23.8944,
  gx: -0.69164,
  gz: 0.39067,
  gxx: 0.00521,
  gxz: -0.02968,
  gzz: -0.0017,
  rIn: 5.5, // full surface out to here (the whole knot sits inside)...
  rOut: 11, // ...easing back onto the natural hillside by here
} as const;
// The window's bounding box, derived so it can never drift from the record
// (terrain_region_index.ts registers exactly this box).
export const THORNPEAK_POCKET_GRADE_BOUNDS = {
  minX: THORNPEAK_POCKET_GRADE.x - THORNPEAK_POCKET_GRADE.rOut,
  maxX: THORNPEAK_POCKET_GRADE.x + THORNPEAK_POCKET_GRADE.rOut,
  minZ: THORNPEAK_POCKET_GRADE.z - THORNPEAK_POCKET_GRADE.rOut,
  maxZ: THORNPEAK_POCKET_GRADE.z + THORNPEAK_POCKET_GRADE.rOut,
} as const;

/** The fitted hillside surface the grade blends onto (exported for the
 *  drift pin). */
export function thornpeakPocketSurface(x: number, z: number): number {
  const g = THORNPEAK_POCKET_GRADE;
  const dx = x - g.x;
  const dz = z - g.z;
  return g.h0 + g.gx * dx + g.gz * dz + g.gxx * dx * dx + g.gxz * dx * dz + g.gzz * dz * dz;
}

export function applyThornpeakPocketGrade(x: number, z: number, h: number, seed: number): number {
  if (seed !== WORLD_SEED) return h;
  const g = THORNPEAK_POCKET_GRADE;
  const dx = x - g.x;
  const dz = z - g.z;
  const dSq = dx * dx + dz * dz;
  if (dSq >= g.rOut * g.rOut) return h;
  const w = 1 - smoothstep(g.rIn, g.rOut, Math.sqrt(dSq));
  return h + (thornpeakPocketSurface(x, z) - h) * w;
}
