import type { PlacedAsset, WorldContent } from './types';

/** Collision additions reuse already-rendered canonical scenery, avoiding duplicate models. */
export function worldCollisionPlacements(content: WorldContent): readonly PlacedAsset[] {
  const visible = content.placements ?? [];
  return content.sceneryCollisions?.length ? [...visible, ...content.sceneryCollisions] : visible;
}
