// The Mirefen tavern's walkable floor (content/mirefen_tavern.ts): one ABSOLUTE surface
// height per point over its footprint, folded into groundHeight by walk_lifts.ts like the
// Forgefather stair ramps, so the terrain the renderer draws (terrainHeight) is untouched
// and the floor the feet walk is what the model draws.
//
// The surface, over the ground floor (TAVERN_FLOOR_Y): one storey, no upper floor anywhere.
//  - the hall: level, but one step down (ramped over half a yard) in the hearth pit, half a
//    yard up on the bar platform and on the bard's stage (each ramped at its open edges);
//  - the tower's nook, level, open to the hall through its arch;
//  - the wing (the closed kitchen and cellar), level;
//  - the porch at the ground floor, and the steps falling from it toward the road until
//    they meet the ground (the fold is a max, so the terrain takes over where they end).
// No face in it is sheer: every change of height is a ramp the climb gate walks.
//
// Pure leaf (content and the active-world flag only, no world.ts: world.ts reaches this
// through walk_lifts.ts), built-in world only,
// deterministic, allocation-free, with an axis-aligned early-out so the rest of the world
// pays two comparisons per groundHeight call.

import {
  TAVERN_BAR_PLATFORM,
  TAVERN_FLOOR_Y,
  TAVERN_HALL,
  TAVERN_ORIGIN,
  TAVERN_PIT,
  TAVERN_PORCH,
  TAVERN_STAGE,
  TAVERN_STEPS_MAX_RUN,
  TAVERN_TOWER,
  TAVERN_WING,
} from './content/mirefen_tavern';
import { isBuiltinWorldActive } from './data';

/** The footprint's world bounds (local z maps to world x, local x to world -z). */
const BOUNDS = {
  x0: TAVERN_ORIGIN.x + TAVERN_WING.z0,
  x1: TAVERN_ORIGIN.x + TAVERN_PORCH.z1 + TAVERN_STEPS_MAX_RUN,
  z0: TAVERN_ORIGIN.z - TAVERN_HALL.x1,
  z1: TAVERN_ORIGIN.z - TAVERN_HALL.x0,
} as const;

/** The hall's floor over the ground floor at a local point inside its outer walls. */
export function tavernHallHeight(lx: number, lz: number): number {
  const pit = TAVERN_PIT;
  const d = Math.hypot(lx - pit.x, lz - pit.z);
  if (d < pit.rim)
    return d <= pit.r ? -pit.depth : -pit.depth * ((pit.rim - d) / (pit.rim - pit.r));
  const b = TAVERN_BAR_PLATFORM;
  if (lz >= b.z0) {
    const ox = Math.max(0, b.x0 - lx);
    const oz = Math.max(0, lz - b.z1);
    if (ox === 0 && oz === 0) return b.lift;
    const e = Math.hypot(ox, oz);
    if (e < b.rim) return b.lift * (1 - e / b.rim);
  }
  // the stage, the bar platform's mirror: ramped at its front and right edges
  const s = TAVERN_STAGE;
  if (lz >= s.z0) {
    const ox = Math.max(0, lx - s.x1);
    const oz = Math.max(0, lz - s.z1);
    if (ox === 0 && oz === 0) return s.lift;
    const e = Math.hypot(ox, oz);
    if (e < s.rim) return s.lift * (1 - e / s.rim);
  }
  return 0;
}

/** The floor over the ground floor at a local point, or NaN off the tavern's footprint. */
export function tavernLocalHeight(lx: number, lz: number): number {
  const h = TAVERN_HALL;
  if (lx >= h.x0 && lx <= h.x1 && lz >= h.z0 && lz <= h.z1) return tavernHallHeight(lx, lz);
  const t = TAVERN_TOWER;
  const dx = lx - t.x;
  const dz = lz - t.z;
  // the tower's nook and the closed wing: level with the hall
  if (dx * dx + dz * dz <= t.rOut * t.rOut) return 0;
  const w = TAVERN_WING;
  if (lx >= w.x0 && lx <= w.x1 && lz >= w.z0 && lz <= w.z1) return 0;
  const p = TAVERN_PORCH;
  if (lx >= p.x0 && lx <= p.x1 && lz >= p.z0 && lz <= p.z1) return 0;
  if (Math.abs(lx) <= p.stepHalfWidth && lz > p.z1 && lz <= p.z1 + TAVERN_STEPS_MAX_RUN) {
    return -(lz - p.z1) * p.stepSlope;
  }
  return Number.NaN;
}

/**
 * The tavern's absolute walk surface at world (x, z), or -Infinity off its footprint (the
 * walk_lifts fold is a max, so -Infinity leaves the ground alone).
 */
export function mirefenTavernSurface(x: number, z: number): number {
  if (x < BOUNDS.x0 || x > BOUNDS.x1 || z < BOUNDS.z0 || z > BOUNDS.z1) return -Infinity;
  // built-in world only: a custom map keeps its own ground here
  if (!isBuiltinWorldActive()) return -Infinity;
  const v = tavernLocalHeight(TAVERN_ORIGIN.z - z, x - TAVERN_ORIGIN.x);
  return Number.isNaN(v) ? -Infinity : TAVERN_FLOOR_Y + v;
}

/** Whether world (x, z) stands on the building (hall, tower, wing, porch and the run of its
 *  steps), grown by `pad`: the footprint the scatter and the grass keep off. */
export function mirefenTavernCovers(x: number, z: number, pad = 0): boolean {
  if (x < BOUNDS.x0 - pad || x > BOUNDS.x1 + pad || z < BOUNDS.z0 - pad || z > BOUNDS.z1 + pad) {
    return false;
  }
  const lx = TAVERN_ORIGIN.z - z;
  const lz = x - TAVERN_ORIGIN.x;
  const h = TAVERN_HALL;
  if (lx >= h.x0 - pad && lx <= h.x1 + pad && lz >= h.z0 - pad && lz <= h.z1 + pad) return true;
  const w = TAVERN_WING;
  if (lx >= w.x0 - pad && lx <= w.x1 + pad && lz >= w.z0 - pad && lz <= w.z1 + pad) return true;
  const t = TAVERN_TOWER;
  if (Math.hypot(lx - t.x, lz - t.z) <= t.rOut + pad) return true;
  const p = TAVERN_PORCH;
  return (
    lx >= p.x0 - pad && lx <= p.x1 + pad && lz >= p.z0 - pad && lz <= p.z1 + TAVERN_STEPS_MAX_RUN
  );
}
