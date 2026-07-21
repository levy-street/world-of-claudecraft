// Pure anchor-selection core for the fishing bobber visual (Professions 2.0
// Phase 12b): which facing-forward water point the bobber floats at. Three/DOM
// free and registered in RENDER_PURE_CORES so the decision logic (the sample
// walk and the fishable-depth rule) is Node-tested directly; the visual module
// (fishing_bobber.ts) is a thin consumer. Walks the sim's own exported
// FISHING_SAMPLE_DISTANCES ring with the sim's depth rule, so the bobber lands
// exactly where startFishing validated the cast.
import { PLAYER_SWIM_DEPTH } from '../sim/pathfind';
import { FISHING_SAMPLE_DISTANCES } from '../sim/professions/fishing';
import { groundHeight, waterLevelAt } from '../sim/world';

export interface BobberAnchor {
  x: number;
  y: number;
  z: number;
}

/**
 * Resolve the bobber anchor for an angler at (x, z) facing `facing` into the
 * caller-owned `out` (allocation-free per the render per-frame discipline).
 * Returns true when a sample clears the sim's fishable-depth rule; false hides
 * the bobber (the cast validated a sample, so false only happens after the
 * angler turned).
 */
export function bobberAnchorInto(
  out: BobberAnchor,
  x: number,
  z: number,
  facing: number,
  seed: number,
): boolean {
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  for (const d of FISHING_SAMPLE_DISTANCES) {
    const sx = x + sin * d;
    const sz = z + cos * d;
    const water = waterLevelAt(sx, sz);
    if (groundHeight(sx, sz, seed) < water - PLAYER_SWIM_DEPTH) {
      out.x = sx;
      out.y = water;
      out.z = sz;
      return true;
    }
  }
  return false;
}
