// The dungeon kit is drawn under TWO different scale conventions, and this is
// the one place that converts between them.
//
//   MODULE scale   The battleground and dungeon renderers instance the merged
//                  source geometry as-is (render/dungeon.ts extractModule does
//                  no normalization), so scale 1 is the GLB's actual size. A
//                  floor_tile_large is 4yd, which is exactly one floor cell.
//   PLACEMENT scale  A catalogue asset dropped in the editor is normalized so
//                  its largest dimension is 2.2yd first (render/asset_scale.ts
//                  targetHeightFor), so scale 1 is 2.2yd whatever the model is.
//
// Copying a module's scale straight onto a placement therefore shrinks a
// 4yd wall to 2.2yd while leaving it on a 4yd grid, the gapped floor and
// undersized walls a region map showed before this existed. Both directions of
// the region round trip (editor/shipped_maps.ts on the way in,
// sim/regions/authored_region.ts on the way out) go through here.

import { DUNGEON_KIT_MAX_DIM } from './dungeon_kit_dims.generated';

/**
 * What a placed catalogue asset's largest dimension becomes at scale 1. Mirrors
 * render/asset_scale.ts TARGET_HEIGHT; restated rather than imported so the sim
 * layer keeps no dependency on the renderer (tests/editor_region_kit_scale
 * asserts the two agree, and that no dungeon/ path takes a special case).
 */
export const PLACED_TARGET_SIZE = 2.2;

/**
 * Yards per unit of MODULE scale for one kit module, its native largest
 * dimension. Unknown kinds fall back to the placed target, which makes the
 * conversion the identity: a module the build does not know about keeps
 * whatever scale it was given rather than being silently resized.
 */
export function dungeonKitMaxDim(kind: string): number {
  return DUNGEON_KIT_MAX_DIM[kind] ?? PLACED_TARGET_SIZE;
}

/** Module scale -> the placement scale that renders at the SAME world size. */
export function dungeonKitPlacementScale(kind: string, moduleScale: number): number {
  return (moduleScale * dungeonKitMaxDim(kind)) / PLACED_TARGET_SIZE;
}

/** Placement scale -> the module scale that renders at the SAME world size. */
export function dungeonKitModuleScale(kind: string, placementScale: number): number {
  return (placementScale * PLACED_TARGET_SIZE) / dungeonKitMaxDim(kind);
}
