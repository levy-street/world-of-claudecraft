// Pure sizing for the Drowned Court's cosmetic water: four thin ankle-deep
// strips hugging the pit's walls, reusing the temple water sheet material.
// The nave and both aisles stay dry (arena floors are gameplay-flat; the
// water is strictly visual and never gets a collider), so the bands stop
// well short of the fighting lanes and the corner strips do not overlap the
// side strips (no double-blended translucency seams).
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

/** Band width in yards, from the wall's inner face toward the pit. */
export const ARENA_WATER_BAND_WIDTH = 3;

export function arenaWaterBands(
  layout: DungeonLayout,
  bandWidth = ARENA_WATER_BAND_WIDTH,
): ArenaWaterBand[] {
  const innerX = (layout.wallX ?? DUNGEON_WALL_X) - DUNGEON_WALL_HW;
  const zMin = layout.zMin + DUNGEON_WALL_HW;
  const zMax = layout.zMax - DUNGEON_WALL_HW;
  return [
    // side strips run the full pit length along each side wall
    { x: -(innerX - bandWidth / 2), z: (zMin + zMax) / 2, width: bandWidth, depth: zMax - zMin },
    { x: innerX - bandWidth / 2, z: (zMin + zMax) / 2, width: bandWidth, depth: zMax - zMin },
    // end strips span exactly between the side strips
    { x: 0, z: zMin + bandWidth / 2, width: 2 * (innerX - bandWidth), depth: bandWidth },
    { x: 0, z: zMax - bandWidth / 2, width: 2 * (innerX - bandWidth), depth: bandWidth },
  ];
}
