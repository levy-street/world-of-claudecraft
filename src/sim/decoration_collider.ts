// The scatter decorations' collision bodies (rocks and tree trunks), moved out
// of colliders.ts under the monolith ratchet (its private topY helper inlined
// as the same groundHeight + height sum, operands in the same order); colliders.ts
// materializes them per grid cell on demand. Pure leaf.

import type { Collider } from './colliders';
import {
  decorationHasCollider,
  ROCK_RADIUS_PER_SCALE,
  rockHeight,
  rockRadius,
} from './decoration_dims';
import { type Decoration, groundHeight } from './world';

// Decoration scale is `0.7 + hash * 0.9` (world.ts), and rocks have the
// largest collision multiplier (ROCK_RADIUS_PER_SCALE). This conservative
// bound selects every candidate whose circle could be assigned to a queried
// grid cell.
export const MAX_DECORATION_COLLIDER_RADIUS = 1.6 * ROCK_RADIUS_PER_SCALE;

export function decorationCollider(seed: number, d: Decoration): Collider | null {
  if (d.kind === 'rock') {
    if (!decorationHasCollider(d)) return null;
    // Height comes from decoration_dims (the one source the renderer scales
    // the rock GLB to), so the collision top IS the silhouette top: a squat
    // field stone is inside the character step height and gets walked over,
    // instead of carrying an invisible wall above it.
    const height = rockHeight(d.x, d.z, d.scale, seed);
    const top = groundHeight(d.x, d.z, seed) + height;
    return {
      type: 'circle',
      x: d.x,
      z: d.z,
      r: rockRadius(d.scale),
      cameraTopY: top,
      moveTopY: top,
      standable: true,
    };
  }
  // tree trunks only; canopies don't block
  return {
    type: 'circle',
    x: d.x,
    z: d.z,
    r: 0.55 * d.scale,
    cameraTopY: groundHeight(d.x, d.z, seed) + 7.5 * d.scale,
  };
}
