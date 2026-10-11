import type * as THREE from 'three';
import { type FloorVfxLayer, floorVfxRenderOrder } from './floor_vfx_layer_core';

// The Three-side half of the floor VFX ladder (policy and numbers live in
// ./floor_vfx_layer_core.ts). Floor modules import the seam from here so the
// pins in tests/floor_vfx_layer.test.ts can find every consumer by one path.
export {
  FLOOR_VFX_LAYER_BASE,
  FLOOR_VFX_LAYER_SPAN,
  FLOOR_VFX_LAYERS,
  type FloorVfxLayer,
  floorVfxLayerOf,
  floorVfxLayerTopOrder,
  floorVfxRenderOrder,
} from './floor_vfx_layer_core';

/**
 * Place a whole floor-VFX subtree on one rung of the ladder.
 *
 * Sets the order on every renderable (mesh, points, sprite, line) under `root`
 * and RESETS it to 0 on every Group, root included. three.js promotes a
 * Group's renderOrder to the `groupOrder` sort key, which outranks every
 * renderOrder in the scene: a player effect parked in a Group at 3 would paint
 * over a boss telegraph mesh at 30. The ladder therefore lives on leaves only,
 * and a module that needs a stack inside its subtree calls this once per rung
 * on the pieces of that rung, or sets `floorVfxRenderOrder` on each leaf.
 *
 * Returns the order applied, for callers that pin or log it.
 */
export function applyFloorVfxLayer(root: THREE.Object3D, layer: FloorVfxLayer, step = 0): number {
  const order = floorVfxRenderOrder(layer, step);
  root.traverse((object) => {
    object.renderOrder = (object as THREE.Group).isGroup ? 0 : order;
  });
  return order;
}
