// The world box the terrain chunk grid (and the far-vista tiles over it) is
// laid out on.
//
// The shipped world streams over its own fixed box: x +-WORLD_MAX_X by
// z WORLD_MIN_Z..WORLD_MAX_Z. An authored map is its own rect (worldHalfX by
// the zone band) and is sculpted past it freely, so a grid pinned to the
// shipped box clipped the maker's ground wherever the two disagree: one of
// SPACEY's maps (2026-09-15, "the outside of the terrain is cut off ... collapse
// into nothing") runs z -250..1120 against a grid that starts at z -180, and
// its peaks were sculpted out to x -631 against a grid that stops at -540.
// Past the grid only the water sheet ran on, over nothing.
//
// So an authored map's grid is ITS OWN rect widened by an outskirts margin and
// by every sculpt stamp (each clamped to a bounded reach, so a hostile
// document cannot demand an unbounded grid), snapped outward to the 2x2
// super-chunk lattice. The shipped world keeps its box exactly.

import {
  activeZoneList,
  getActiveWorldContent,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  zoneXBounds,
} from '../sim/data';
import { isAuthoredMapPresentation } from '../sim/map_presentation';

export interface GridBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Ground past an authored map's rect, so its edge meets more land or sea
 *  floor instead of a cliff into the sky. */
export const AUTHORED_OUTSKIRTS_YARDS = 240;
/** The farthest a sculpt stamp may widen the grid past the map's rect. */
export const AUTHORED_STAMP_REACH_YARDS = 600;

export const SHIPPED_GRID_BOX: GridBox = {
  minX: -WORLD_MAX_X,
  maxX: WORLD_MAX_X,
  minZ: WORLD_MIN_Z,
  maxZ: WORLD_MAX_Z,
};

/**
 * The grid box for an authored map with these zone rects and sculpt stamps,
 * or the shipped box when `authored` is false or there is no rect at all.
 * `cell` is the chunk edge; the box snaps outward to 2-cell multiples so the
 * far band's 2x2 super-chunks pair up on the same lattice everywhere.
 */
export function terrainGridBox(opts: {
  authored: boolean;
  rects: readonly GridBox[];
  stamps?: readonly { x: number; z: number; radius: number }[];
  cell: number;
  shipped?: GridBox;
}): GridBox {
  const shipped = opts.shipped ?? SHIPPED_GRID_BOX;
  if (!opts.authored || opts.rects.length === 0) return shipped;
  const rect = { ...opts.rects[0] };
  for (const r of opts.rects) {
    rect.minX = Math.min(rect.minX, r.minX);
    rect.maxX = Math.max(rect.maxX, r.maxX);
    rect.minZ = Math.min(rect.minZ, r.minZ);
    rect.maxZ = Math.max(rect.maxZ, r.maxZ);
  }
  const out = {
    minX: rect.minX - AUTHORED_OUTSKIRTS_YARDS,
    maxX: rect.maxX + AUTHORED_OUTSKIRTS_YARDS,
    minZ: rect.minZ - AUTHORED_OUTSKIRTS_YARDS,
    maxZ: rect.maxZ + AUTHORED_OUTSKIRTS_YARDS,
  };
  const reach = AUTHORED_STAMP_REACH_YARDS;
  for (const s of opts.stamps ?? []) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.z) || !(s.radius > 0)) continue;
    out.minX = Math.min(out.minX, Math.max(rect.minX - reach, s.x - s.radius));
    out.maxX = Math.max(out.maxX, Math.min(rect.maxX + reach, s.x + s.radius));
    out.minZ = Math.min(out.minZ, Math.max(rect.minZ - reach, s.z - s.radius));
    out.maxZ = Math.max(out.maxZ, Math.min(rect.maxZ + reach, s.z + s.radius));
  }
  const snap = opts.cell * 2;
  return {
    minX: Math.floor(out.minX / snap) * snap,
    maxX: Math.ceil(out.maxX / snap) * snap,
    minZ: Math.floor(out.minZ / snap) * snap,
    maxZ: Math.ceil(out.maxZ / snap) * snap,
  };
}

/** The grid box for the ACTIVE world content (one answer for the chunk grid
 *  and the far-vista tiles, so the two can never disagree about coverage). */
export function activeTerrainGridBox(cell: number): GridBox {
  const content = getActiveWorldContent();
  return terrainGridBox({
    authored: isAuthoredMapPresentation(content.presentationMode),
    rects: activeZoneList().map((zone) => {
      const [minX, maxX] = zoneXBounds(zone);
      return { minX, maxX, minZ: zone.zMin, maxZ: zone.zMax };
    }),
    stamps: content.terrainEdits,
    cell,
  });
}
