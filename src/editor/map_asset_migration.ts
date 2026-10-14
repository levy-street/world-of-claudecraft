// Focused, idempotent repairs for placed GLB assets in saved editor maps.
// Terrain primitives, colliders, fluids, generated rocks, and grass are not
// catalogue models and are deliberately left untouched.

import { mushroomsAllowedAt } from '../sim/ground_dressing';
import type { MapPlacement } from '../sim/map_doc';
import { assetById } from './asset_catalog.generated';

export const WOC_MUSHROOM_ASSET_ID = 'foliage/mushroom_woc';

/**
 * Replace legacy placed mushrooms with the new WOC model and heal their
 * collision.
 *
 * Per-axis scale is intentionally left ALONE. The Scale gizmo lets makers
 * stretch a placed model on a single axis (a longer bridge, a wider wall, a
 * taller door), and the editor render, the playtest render, and the collider
 * bake all honor scaleX/scaleY/scaleZ. Flattening those back to natural aspect
 * here silently destroyed authored shapes on every load, the exact opposite of
 * a repair. Genuinely runaway auto-fit values (the stretched camp tents) are
 * healed surgically by repairStretchedWorldProps instead.
 */
export function repairPlacedAssetShapes(map: { placements: MapPlacement[] }): boolean {
  let changed = false;
  const retained = map.placements.filter((placement) => {
    const mushroom = placement.assetId.startsWith('foliage/mushroom');
    if (!mushroom || mushroomsAllowedAt(placement.x, placement.z)) return true;
    changed = true;
    return false;
  });
  if (retained.length !== map.placements.length)
    map.placements.splice(0, map.placements.length, ...retained);
  for (const placement of map.placements) {
    if (placement.assetId === 'foliage/mushroom') {
      placement.assetId = WOC_MUSHROOM_ASSET_ID;
      placement.name = placement.name?.replace(/mushroom/gi, 'WOC mushroom') ?? 'WOC mushroom';
      changed = true;
    }
    // Earlier procedural/editor foliage paths stamped mushrooms as
    // walk-through. The WOC mushroom is a solid placed prop: heal every saved
    // copy while preserving any richer baked/mesh collision already authored.
    if (placement.assetId === WOC_MUSHROOM_ASSET_ID) {
      if (!placement.collide) {
        placement.collide = true;
        changed = true;
      }
      if (placement.collisionMode === undefined || placement.collisionMode === 'none') {
        placement.collisionMode = 'basic';
        changed = true;
      }
    }
  }
  return changed;
}

// Trunk trees whose collision was authored off (usually the foliage brush's
// collide-off default sweeping trees along with ground cover). Ground cover
// itself (bush, fern, flower, grass) legitimately stays walk-through.
const TRUNK_TREE_RE = /(tree|oak|pine|birch|spruce|willow|palm|twisted)/;
const NOT_TRUNK_RE = /(cone|stump|log|sapling|bush|fern|flower|grass|hedge|leaf|leaves)/;

function isTrunkTree(assetId: string): boolean {
  const base = assetId.toLowerCase();
  return TRUNK_TREE_RE.test(base) && !NOT_TRUNK_RE.test(base);
}

/**
 * Heal trunk trees saved without collision: a tree the player walks through
 * is always a defect (the trunk should block), so collide-off tree placements
 * get collision re-enabled with the asset's simple-collision default. Same
 * in-place, idempotent contract as repairPlacedAssetShapes; persists on the
 * next save. Returns whether anything changed.
 */
export function repairMissingTreeCollision(
  map: { placements: MapPlacement[] },
  applyDefault: (p: MapPlacement) => void,
): boolean {
  let changed = false;
  for (const placement of map.placements) {
    if (placement.collide) continue;
    if (!assetById(placement.assetId)) continue;
    if (!isTrunkTree(placement.assetId)) continue;
    placement.collide = true;
    delete placement.collisionMode;
    applyDefault(placement);
    changed = true;
  }
  return changed;
}
