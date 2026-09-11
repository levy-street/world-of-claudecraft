// The ground sheets a mover can stand on, and the rule that picks between
// them. Pure decision logic: no RNG, no DOM/Three, no world reads. world.ts
// binds it to the active content and the real heightfield.
//
// Sheet 1 is the terrain surface. Sheet 2 is the walkable floor of a cave tube
// (sim/caves.ts), which exists wherever a bore runs, at whatever height it was
// authored. Sheet 3 is the floor of a CARVED CAVITY: the walkable bottom of a
// boolean cut (sim/terrain_cuts.ts) where it removed ground below the surface,
// which is what turns the Carve tool's solids into rooms and tunnels rather
// than bottomless holes. A terrain cut removes sheet 1 at a point, which is
// what turns a cave mouth into a way in rather than a picture of one.
//
// Movers pick the sheet closest to their PREVIOUS height, so walking through a
// mouth transfers layers with no teleport and no per-mover state. Inside a cut
// the terrain sheet is ABSENT: a tube or cavity floor below catches the mover,
// and a cut with nothing underneath walls the step off (there is nothing to
// stand on, so the sheet reports a height no step can climb).
//
// The one rule that must never bend: the renderer's dropped quads, the cavity
// interior mesh, and this function read the SAME cut list through the SAME
// evaluator (carveFieldAt). A cut the renderer honours and the sim does not is
// an invisible wall.

import { caveFloorAt, caveMouthCuts } from './caves';
import {
  carveFieldAt,
  cutBounds,
  cutVerticalBounds,
  HOLE_WALL_RISE,
  inTerrainCut,
} from './terrain_cuts';
import type { CaveDef, TerrainCut } from './types';

export interface GroundSheet {
  /** The height the mover stands at. */
  height: number;
  /** True when that height is a cave tube's floor rather than the terrain. */
  cave: boolean;
  /** True when that height is a carved cavity's floor. */
  cavity: boolean;
  /** True when the terrain sheet is cut away at this point. */
  cut: boolean;
}

/** A body needs this much clearance to occupy a cavity: floors under lower
 *  ceilings read as rock, so the wall band of a carve is solid instead of a
 *  crawlspace the movement gates cannot express. */
export const MIN_CAVITY_HEADROOM = 1.6;

// Scan resolution for the cavity floor search. The scan finds sign changes of
// the carve field along Y, the bisection then sharpens each crossing; a
// feature thinner than the step can be missed, but MIN_CAVITY_HEADROOM already
// rejects anything that thin as unwalkable.
const FLOOR_SCAN_STEP = 0.8;
const FLOOR_BISECT_ITERS = 8;

export interface CavitySheet {
  /** The walkable cavity floor height. */
  floor: number;
  /** The cavity ceiling above that floor (rock or the open surface). */
  ceiling: number;
}

// Scratch lists for the per-point cut narrowing below: movement calls
// cavitySheetAt several times per entity per tick, so the filter must not
// allocate. Truncated and refilled on every call; never escapes this module.
const scratchCuts: TerrainCut[] = [];
const scratchPatches: TerrainCut[] = [];

/**
 * The carved-cavity ground sheet at (x, z), or null when no cavity offers a
 * standable floor there. The cavity is the carve field's negative region
 * BELOW the terrain surface; its floor is the downward field crossing, its
 * ceiling the upward one (or the open surface where the cavity breaches it,
 * i.e. at a mouth or an open pit).
 *
 * With several stacked cavities the one whose floor sits closest to `prevY`
 * wins, the same continuity rule resolveGroundSheet applies between sheets.
 * Floors with less than MIN_CAVITY_HEADROOM of ROCK ceiling are not sheets at
 * all, the wall band of a carve stays solid, but a cavity open to the sky
 * (a walk-in pit) has no ceiling to duck under and is always standable.
 */
export function cavitySheetAt(
  cuts: readonly TerrainCut[] | undefined,
  patches: readonly TerrainCut[] | undefined,
  x: number,
  z: number,
  surfaceY: number,
  prevY: number,
  /** A cave tube's open interval at this column, when one runs here: its air
   *  is VOID to the scan, so a carve that breaks into a tube has no phantom
   *  floor across the tube's mouth, the mover falls through into the tube,
   *  whose own sheet then catches it. */
  tubeVoid?: { floor: number; ceiling: number } | null,
): CavitySheet | null {
  if (!cuts || cuts.length === 0) return null;
  // Narrow to the CARVE solids whose padded footprint reaches this point,   // legacy holes are pure sheet cutouts with no interior of their own, and
  // the bounds rule is the mesher's narrowCutSet rule: outside its own bounds
  // a cut's distance exceeds its blend radius, so the smooth union
  // degenerates to the other operand and dropping it changes nothing. This
  // keeps the scan's field evaluations O(local carves), not O(document).
  scratchCuts.length = 0;
  let rangeMin = Number.POSITIVE_INFINITY;
  let rangeMax = Number.NEGATIVE_INFINITY;
  for (const cut of cuts) {
    if (cut.carve !== true) continue;
    const b = cutBounds(cut);
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    scratchCuts.push(cut);
    const v = cutVerticalBounds(cut);
    if (v.minY < rangeMin) rangeMin = v.minY;
    if (v.maxY > rangeMax) rangeMax = v.maxY;
  }
  if (scratchCuts.length === 0) return null;
  // Only the underground part of a cut is a cavity: above the surface the
  // "inside" of a solid is open air the terrain never occupied.
  const top = Math.min(rangeMax, surfaceY);
  const bottom = rangeMin;
  if (top <= bottom) return null;
  scratchPatches.length = 0;
  if (patches) {
    for (const patch of patches) {
      const b = cutBounds(patch);
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) scratchPatches.push(patch);
    }
  }
  const near = scratchCuts;
  const nearPatches = scratchPatches.length > 0 ? scratchPatches : undefined;
  const inVoid = (y: number): boolean => {
    if (carveFieldAt(near, nearPatches, x, y, z) < 0) return true;
    return tubeVoid != null && y >= tubeVoid.floor - 0.05 && y <= tubeVoid.ceiling + 0.05;
  };
  let best: CavitySheet | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  // March downward from the surface so each cavity interval is seen once:
  // enter at an upward crossing (or the open surface), leave at the floor.
  let yAbove = top;
  let inAbove = inVoid(yAbove);
  // A crossing between a void sample (yIn) and a rock sample (yOut), sharpened
  // by bisection over the SAME predicate the scan uses.
  const bisect = (yIn: number, yOut: number): number => {
    let lo = yIn;
    let hi = yOut;
    for (let i = 0; i < FLOOR_BISECT_ITERS; i++) {
      const mid = (lo + hi) / 2;
      if (inVoid(mid)) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // Starting inside the cavity at the surface height = the pit is open to the
  // sky above this point: its first floor needs no headroom check.
  let skyOpen = inAbove && top >= surfaceY - 1e-6;
  let ceiling = inAbove ? top : Number.NaN;
  for (let y = top - FLOOR_SCAN_STEP; y >= bottom - FLOOR_SCAN_STEP; y -= FLOOR_SCAN_STEP) {
    const yClamped = Math.max(y, bottom);
    const inHere = inVoid(yClamped);
    if (inHere && !inAbove) {
      // Entered a cavity from rock above: the crossing is its ceiling.
      ceiling = bisect(yClamped, yAbove);
    } else if (!inHere && inAbove) {
      // Left a cavity going down: the crossing is a floor (the void endpoint
      // is ABOVE the rock endpoint here, the mirror of the ceiling case).
      const floor = bisect(yAbove, yClamped);
      if (Number.isFinite(ceiling) && (skyOpen || ceiling - floor >= MIN_CAVITY_HEADROOM)) {
        const dist = Math.abs(floor - prevY);
        if (dist < bestDist) {
          bestDist = dist;
          best = { floor, ceiling };
        }
      }
      ceiling = Number.NaN;
      skyOpen = false;
    }
    inAbove = inHere;
    yAbove = yClamped;
    if (y <= bottom) break;
  }
  return best;
}

// A map's effective cut list is its authored cuts plus every self-carving
// cave's bore cut. Both inputs are stable arrays owned by the document, so
// memoizing on the cave list keeps the concat off the per-tick path; the
// editor swaps whole arrays on every mutation, which invalidates the entry.
const effectiveCutCache = new WeakMap<readonly CaveDef[], WeakMap<object, TerrainCut[]>>();
const NO_CUTS: readonly TerrainCut[] = [];
// WeakMap keys must be objects, so an absent cut list needs a stand-in.
const NO_HOLES_KEY: readonly TerrainCut[] = [];

/**
 * Every cut that removes terrain on this map: the maker's own, plus the mouth
 * each `autoMouth` cave carves for itself out of its bore. Returns the
 * authored list unchanged when no cave carves, so the common map allocates
 * nothing.
 */
export function effectiveTerrainCuts(
  caves: readonly CaveDef[] | undefined,
  holes: readonly TerrainCut[] | undefined,
): readonly TerrainCut[] {
  if (!caves || caves.length === 0) return holes ?? NO_CUTS;
  let byHoles = effectiveCutCache.get(caves);
  const holeKey = (holes ?? NO_HOLES_KEY) as object;
  const hit = byHoles?.get(holeKey);
  if (hit) return hit;
  const mouths = caveMouthCuts(caves);
  if (mouths.length === 0) return holes ?? NO_CUTS;
  const merged = holes && holes.length > 0 ? [...holes, ...mouths] : mouths;
  if (!byHoles) {
    byHoles = new WeakMap<object, TerrainCut[]>();
    effectiveCutCache.set(caves, byHoles);
  }
  byHoles.set(holeKey, merged);
  return merged;
}

/**
 * Which sheet a mover at (x, z) stands on, given where it was last tick.
 * `surfaceY` is the terrain height there (the caller's own heightfield, so
 * dungeon floors and sculpt edits are already in it).
 */
export function resolveGroundSheet(
  caves: readonly CaveDef[] | undefined,
  cuts: readonly TerrainCut[] | undefined,
  patches: readonly TerrainCut[] | undefined,
  x: number,
  z: number,
  surfaceY: number,
  prevY: number,
): GroundSheet {
  const tube = caveFloorAt(caves, x, z);
  const cavity = cavitySheetAt(cuts, patches, x, z, surfaceY, prevY, tube);
  const cut = inTerrainCut(cuts, x, z, surfaceY, patches);
  // Candidate floors, nearest-to-previous-height wins. The terrain sheet only
  // competes where it exists (not cut away).
  let best: GroundSheet | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const consider = (height: number, isCave: boolean, isCavity: boolean): void => {
    const dist = Math.abs(height - prevY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { height, cave: isCave, cavity: isCavity, cut };
    }
  };
  if (!cut) consider(surfaceY, false, false);
  if (tube) consider(tube.floor, true, false);
  if (cavity) consider(cavity.floor, false, true);
  if (best) return best;
  // The terrain sheet is gone and nothing below catches the mover: the step
  // is walled off (a height no gate reads as climbable).
  return { height: surfaceY + HOLE_WALL_RISE, cave: false, cavity: false, cut };
}
