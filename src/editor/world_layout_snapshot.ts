import { generateGroundDressing } from '../sim/ground_dressing';
import { MAX_PLACEMENTS } from '../sim/map_doc';
import { generateDecorationsInBounds } from '../sim/world';
import { mapBounds, newCustomMap } from './custom_map';
import {
  ambientDecorationKey,
  ambientDecorationsToPlacements,
  closestAmbientDecorations,
} from './foliage_edit_core';

/** A complete fresh authoring view of current content; no old published ZIP or random IDs. */
export function currentLayoutScenery() {
  const map = newCustomMap('Layout reconciliation', 'layout-reconciliation', 0);
  const size = mapBounds(map);
  const bounds = { minX: -size.halfW, maxX: size.halfW, minZ: size.zMin, maxZ: size.zMax };
  const decorations = [
    ...generateDecorationsInBounds(map.meta.seed, bounds),
    ...generateGroundDressing(map.meta.seed, { leanFoliage: false, bounds }),
  ];
  if (map.placements.length + decorations.length > MAX_PLACEMENTS)
    throw new Error(
      'Current scenery exceeds the Studio placement cap; a truncated baseline is unsafe.',
    );
  const ordered = closestAmbientDecorations(
    decorations,
    { x: 0, z: (bounds.minZ + bounds.maxZ) / 2 },
    MAX_PLACEMENTS - map.placements.length,
  );
  map.placements.push(
    ...ambientDecorationsToPlacements(ordered).map((placement, index) => ({
      ...placement,
      uid: `decoration:${ambientDecorationKey(ordered[index])}`,
    })),
  );
  return map.placements;
}
