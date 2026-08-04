// Pure, host-agnostic shaping for the world map's sea: how near a patch of safe
// water is to the open sea the sim's swim fatigue governs.
//
// WHY IT EXISTS. The zone map used to colour water with two palettes a stark
// distance apart, split by the sim's swim-fatigue predicate (inHollowOpenSea):
// safe water light, the lethal open sea near-navy. That predicate is a rectangle
// test (a fixed inset from the strip and row bounds), so the two met at a hard
// straight step in the middle of open water and the map read as a lighter box
// pasted on a flat sea rather than as anything the world contains.
//
// The sea is now ONE shallow-to-deep ramp, and this module is what walks it:
// water deepens as the open sea nears, the way a chart says it. The map marks
// no boundary at all, because the sim states it far better than a drawn rule
// could (src/sim/fatigue.ts: an on-screen toast on crossing, repeated every 4s,
// and 8 seconds of grace before the first damage pulse, reaching a swimmer who
// is looking at the world and not at the map).
//
// WHY THE PREDICATE IS SAMPLED RATHER THAN RE-DERIVED. The distance to that
// boundary is not something the predicate reports, and re-deriving it in the
// painter would mean copying rules (the moat inset, the row rim, the fatigue-free
// corridors, the Mirrorshallow) that live in src/sim/world.ts and will drift.
// Sampling the REAL predicate on a few rings cannot drift: whatever the sim
// says, this reports.
//
// THE CONSTRAINT THAT PICKED THE SHAPE. paintTerrainRows guarantees a chunked
// render is byte-identical to a single-pass one, so a pixel's colour may depend
// only on its own coordinates: no post-pass blur of a lethality mask, however
// much cleaner that would be as a raster operation. Every function here is pure
// in (x, z), which is what keeps that guarantee.
//
// DOM-free / deterministic / injected predicate so tests/map_open_sea_edge_core.test.ts
// drives it with synthetic geometry instead of the real world.

/** The sim predicate this shaping reads: true where swim fatigue is lethal. */
export type OpenSeaPredicate = (x: number, z: number) => boolean;

/** How far ahead of the limit, in yards, the safe water starts deepening. */
export const NEARNESS_MAX_YD = 24;
/** Rungs on the distance ladder inside that reach. More rungs is a smoother
 *  ramp and more predicate calls; 8 puts a step at every 3 yd, which is finer
 *  than a plate pixel at the shipped resolution. */
export const NEARNESS_STEPS = 8;
/** Bracket halvings after the ladder finds its rung: 3 takes the distance
 *  resolution to under half a yard, which is finer than a plate pixel, so the
 *  ramp reads as continuous instead of as stripes. */
export const NEARNESS_REFINE = 3;

/** Half a diagonal step: the ring's 45 degree points sit at r/sqrt(2) on each axis. */
const DIAG = Math.SQRT1_2;

/**
 * Lethal water anywhere on the ring of radius r, sampled in eight directions.
 *
 * Four axis points are not enough, and the failure is not hypothetical: the
 * lethal regions are rectangles, so their CORNERS are approached diagonally, and
 * an axis-only ring standing off a corner finds nothing lethal in any direction.
 * That would leave every rect corner unsoftened while its sides eased, which
 * looks worse than the hard edge this replaces.
 */
function ringIsLethal(x: number, z: number, r: number, isOpenSea: OpenSeaPredicate): boolean {
  const d = r * DIAG;
  return (
    isOpenSea(x + r, z) ||
    isOpenSea(x - r, z) ||
    isOpenSea(x, z + r) ||
    isOpenSea(x, z - r) ||
    isOpenSea(x + d, z + d) ||
    isOpenSea(x + d, z - d) ||
    isOpenSea(x - d, z + d) ||
    isOpenSea(x - d, z - d)
  );
}

/**
 * How near (0..1) a point is to the lethal open sea: 0 with nothing lethal
 * within NEARNESS_MAX_YD, rising toward 1 as the limit closes. Meaningless for a
 * point that is ITSELF lethal, so the painter only asks about safe water.
 *
 * Measured as the smallest ring radius that finds lethal water, NOT as the
 * fraction of samples that come back lethal: at a straight boundary only the
 * samples on one side can ever be lethal, so a fraction saturates around a
 * quarter and the shading it drives is invisible. A radius ladder reports the
 * same distance whatever the boundary's shape.
 *
 * The wide-ring gate first means an ordinary patch of safe water costs four
 * predicate calls; only the band actually near the limit pays for the ladder.
 */
export function openSeaNearness(x: number, z: number, isOpenSea: OpenSeaPredicate): number {
  if (!ringIsLethal(x, z, NEARNESS_MAX_YD, isOpenSea)) return 0;
  const step = NEARNESS_MAX_YD / NEARNESS_STEPS;
  let lo = 0;
  let hi = NEARNESS_MAX_YD;
  for (let i = 1; i <= NEARNESS_STEPS; i++) {
    const r = i * step;
    if (ringIsLethal(x, z, r, isOpenSea)) {
      lo = r - step;
      hi = r;
      break;
    }
  }
  // Halve the bracket a few times. Without this the ladder's rungs paint as
  // visible stripes: a rung is 3 yd, which at plate resolution is a couple of
  // pixels wide, so the ramp reads as banding rather than as deepening water.
  for (let i = 0; i < NEARNESS_REFINE; i++) {
    const mid = (lo + hi) / 2;
    if (ringIsLethal(x, z, mid, isOpenSea)) hi = mid;
    else lo = mid;
  }
  return (NEARNESS_MAX_YD - hi) / NEARNESS_MAX_YD;
}
