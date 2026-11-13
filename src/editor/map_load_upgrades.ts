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

import { BUILTIN_WORLD, getActiveWorldContent, setActiveWorldContent } from '../sim/data';
import { insideAnyZone, missingLateZones } from './builtin_zone_match_core';
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
  // A full-world map saved before a built-in zone existed does not carry that
  // zone: nothing an upgrade adds may land on its ground (builtin_zone_match_core.ts).
  const absent = missingLateZones(map.content.zones, BUILTIN_WORLD.zones);
  const before = absent.length ? new Set(map.placements) : null;
  setActiveWorldContent(customMapToWorldContent(map));
  try {
    applyUpgrades(map, (m) => {
      if (!before) return;
      m.placements = m.placements.filter((p) => before.has(p) || !insideAnyZone(absent, p.x, p.z));
    });
  } finally {
    setActiveWorldContent(previous);
  }
}

function applyUpgrades(map: CustomMap, beforeIds: (map: CustomMap) => void): void {
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
  beforeIds(map);
  ensureMapItemIdsFromContent(map);
}
