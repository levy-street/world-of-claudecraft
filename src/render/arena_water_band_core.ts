// Pure sizing for the Drowned Court's cosmetic flood: both side AISLES stand
// in ankle-deep water (the colonnades and reliquaries rise out of it, kelp at
// their feet) while the processional nave and both spawn approaches stay dry,
// so the fighting lane the spawns face down reads as raised stone above the
// flood. End pools close the flood across the nave behind each spawn line.
// Strictly visual: no collider, no sim effect; the strips abut exactly (no
// double-blended translucency seams).
//
// RENDER_PURE_CORES module: no three.js, no DOM; the renderer consumes the
// returned rects verbatim (see DungeonInteriors.placeArenaWaterBands).
import { DUNGEON_WALL_HW, DUNGEON_WALL_X, type DungeonLayout } from '../sim/dungeon_layout';

export interface ArenaWaterBand {
  /** strip centre, instance-local */
  x: number;
  z: number;
  /** full extents along x / z */
  width: number;
  depth: number;
}

/** The nave stays dry inside this |x| (the colonnades stand at |x|=8). */
export const ARENA_WATER_NAVE_HALF_X = 7;
/** z depth of the end pools closing the flood across the nave. */
export const ARENA_WATER_END_DEPTH = 4;

export function arenaWaterBands(
  layout: DungeonLayout,
  naveHalfX = ARENA_WATER_NAVE_HALF_X,
  endDepth = ARENA_WATER_END_DEPTH,
): ArenaWaterBand[] {
  const innerX = (layout.wallX ?? DUNGEON_WALL_X) - DUNGEON_WALL_HW;
  const zMin = layout.zMin + DUNGEON_WALL_HW;
  const zMax = layout.zMax - DUNGEON_WALL_HW;
  // clamped so a hypothetical nave wider than the room degenerates to
  // nothing instead of a negative-width plane
  const aisleWidth = Math.max(0, innerX - naveHalfX);
  return [
    // flooded aisles run the full pit length from the nave edge to each wall
    {
      x: -(naveHalfX + aisleWidth / 2),
      z: (zMin + zMax) / 2,
      width: aisleWidth,
      depth: zMax - zMin,
    },
    {
      x: naveHalfX + aisleWidth / 2,
      z: (zMin + zMax) / 2,
      width: aisleWidth,
      depth: zMax - zMin,
    },
    // end pools span exactly the dry nave width, behind each spawn line
    { x: 0, z: zMin + endDepth / 2, width: 2 * naveHalfX, depth: endDepth },
    { x: 0, z: zMax - endDepth / 2, width: 2 * naveHalfX, depth: endDepth },
  ];
}
