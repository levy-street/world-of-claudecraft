// Where an authored spawn actually stands when it was placed inside a cave.
//
// Camps and props are authored as XZ points. The sim grounds them on the
// surface (placementFloorHeight -> terrain), which is right everywhere except
// INSIDE a bore: a mine dug under a mountain would spawn its kobolds on the
// summit, two hundred yards above the tunnel the maker put them in. This is
// the one pure rule that decides: a point inside a tube whose floor sits
// clearly below the surface belongs to the tube.

import { caveFloorAt } from './caves';
import { cavitySheetAt } from './ground_sheets';
import type { CaveDef, TerrainCut } from './types';

/** How far under the surface a tube floor must be before a spawn prefers it.
 *  A flush mouth (floor within this of the ground) keeps the surface, so a
 *  camp at a cave entrance still stands outside it. */
export const CAVE_SPAWN_MIN_DEPTH = 2;

/**
 * The tube floor a spawn at (x, z) should stand on, or null to keep the
 * surface. Reads the same sample the movers walk on (caveFloorAt trims the
 * outer 2% sliver where the arch meets the floor), so a grounded spawn is
 * already on its sheet and groundHeightNear keeps it there.
 */
export function caveSpawnFloor(
  caves: readonly CaveDef[] | undefined,
  x: number,
  z: number,
  surfaceY: number,
): number | null {
  const s = caveFloorAt(caves, x, z);
  if (!s || s.mouth) return null;
  if (s.floor > surfaceY - CAVE_SPAWN_MIN_DEPTH) return null;
  return s.floor;
}

/**
 * The carved-cavity floor a spawn at (x, z) should stand on, or null to keep
 * the surface: the carve-system twin of caveSpawnFloor (a mine dug with the
 * Studio's Caves tool is TerrainCut carves, not tubes). The deepest sheet
 * under the column wins, so a camp authored over a two-storey carve lands on
 * the lower floor; a walk-in pit whose floor is within CAVE_SPAWN_MIN_DEPTH of
 * the ground keeps the surface, like a flush tube mouth.
 */
export function carveSpawnFloor(
  holes: readonly TerrainCut[] | undefined,
  patches: readonly TerrainCut[] | undefined,
  x: number,
  z: number,
  surfaceY: number,
): number | null {
  if (!holes || holes.length === 0) return null;
  const sheet = cavitySheetAt(holes, patches, x, z, surfaceY, surfaceY - 1000);
  if (!sheet) return null;
  if (sheet.floor > surfaceY - CAVE_SPAWN_MIN_DEPTH) return null;
  return sheet.floor;
}
