// The upgrades the editor applies to every map it opens (EditorApp.loadMap):
// promote built-in world props to editable placements and repair legacy
// placement shapes and collision. They change the document, so a change-only
// push (map_push.ts) runs the SAME pass on its base before comparing: what
// the editor did on open is then not mistaken for the maker's own change.
//
// Items an upgrade adds get content-derived ids, so the editing copy and the
// re-upgraded base name them alike (map_item_ids.ts).
//
// Some upgrades sample the ACTIVE world (terrain height under a promoted
// prop, the zone a mushroom stands in), so the pass runs with the map's own
// world active and then puts the previous one back: the result never depends
// on which map happened to be open before.

import { getActiveWorldContent, setActiveWorldContent } from '../sim/data';
import { applyDefaultCollision } from './collision_defaults';
import { type CustomMap, customMapToWorldContent } from './custom_map';
import { promoteFeatureDressing } from './feature_prop_placements';
import { repairMissingTreeCollision, repairPlacedAssetShapes } from './map_asset_migration';
import { ensureMapItemIdsFromContent } from './map_item_ids';
import {
  promoteEditablePalms,
  promoteFarshorePalms,
  promoteMajorWorldProps,
  promoteStreetlamps,
  promoteWillows,
  repairDecorBuildingCollision,
  repairLegacyWorldPropFit,
  repairStretchedWorldProps,
} from './world_prop_placements';

/** Upgrade a just-opened map in place, exactly as the editor opens it. */
export function upgradeLoadedMap(map: CustomMap): void {
  if (map.meta.overworldBase) {
    ensureMapItemIdsFromContent(map);
    return;
  }
  const previous = getActiveWorldContent();
  setActiveWorldContent(customMapToWorldContent(map));
  try {
    applyUpgrades(map);
  } finally {
    setActiveWorldContent(previous);
  }
}

function applyUpgrades(map: CustomMap): void {
  promoteMajorWorldProps(map);
  promoteEditablePalms(map);
  promoteStreetlamps(map);
  promoteWillows(map);
  promoteFarshorePalms(map);
  promoteFeatureDressing(map);
  repairDecorBuildingCollision(map);
  repairLegacyWorldPropFit(map);
  repairStretchedWorldProps(map);
  repairPlacedAssetShapes(map);
  repairMissingTreeCollision(map, applyDefaultCollision);
  if (map.meta.id === 'woc-v041-world') {
    map.placements = map.placements.filter(
      (p) =>
        !(
          (p.assetId === 'biome/hexb_barracks' && p.x === 17.5 && p.z === -5.5) ||
          (p.assetId === 'biome/hexb_watchtower' && p.x === 27 && p.z === -13)
        ),
    );
    if (map.content.npcs.proving_shore_guide) {
      map.content.npcs.proving_shore_guide.dynamic = true;
    }
  }
  ensureMapItemIdsFromContent(map);
}
