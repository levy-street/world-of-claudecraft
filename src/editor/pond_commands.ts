import { MAX_PLACEMENTS, MAX_TERRAIN_EDITS } from '../sim/map_doc';
import type { CustomMap } from './custom_map';
import { clampToCap } from './edit_caps_core';
import type { PondPlan, PondRegion } from './pond_core';
import type { EditorCommand } from './undo_core';

/** The basin and its water always enter or leave the document together.
 *  Like other building commands, creation only plans; call redo before push. */
export function createPondCommand(
  map: CustomMap,
  plan: PondPlan,
  onChanged: (region: PondRegion) => void,
): EditorCommand | null {
  const { stamps, water, region } = structuredClone(plan);
  const hasCapacity = (): boolean =>
    !clampToCap(stamps, map.terrainEdits.length, MAX_TERRAIN_EDITS).truncated &&
    !clampToCap([water], map.placements.length, MAX_PLACEMENTS).truncated;
  if (stamps.length === 0 || !hasCapacity()) return null;
  const terrainIndex = map.terrainEdits.length;
  const placementIndex = map.placements.length;
  let applied = false;
  return {
    label: 'add-pond',
    redo: () => {
      if (applied || !hasCapacity()) return;
      map.terrainEdits.splice(terrainIndex, 0, ...stamps);
      map.placements.splice(placementIndex, 0, water);
      applied = true;
      onChanged({ ...region });
    },
    undo: () => {
      if (!applied) return;
      for (const stamp of stamps) {
        const index = map.terrainEdits.indexOf(stamp);
        if (index >= 0) map.terrainEdits.splice(index, 1);
      }
      const index = map.placements.indexOf(water);
      if (index >= 0) map.placements.splice(index, 1);
      applied = false;
      onChanged({ ...region });
    },
  };
}
