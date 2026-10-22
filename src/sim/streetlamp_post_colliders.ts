import type { Collider } from './collider_shapes';
import type { PlacedStreetlamp } from './streetlamp_layout';
import { STREETLAMP_COLLIDER_RADIUS, STREETLAMP_FIXTURE_HEIGHT } from './streetlamp_style';

/** Lamp meshes may overlap NPC anchors; only their solid posts stand down. */
export function streetlampPostColliders(
  lamps: readonly PlacedStreetlamp[],
  standsOnNpc: (x: number, z: number, radius: number) => boolean,
): Collider[] {
  const posts: Collider[] = [];
  for (const lamp of lamps) {
    const r = STREETLAMP_COLLIDER_RADIUS[lamp.style];
    if (standsOnNpc(lamp.x, lamp.z, r)) continue;
    posts.push({
      type: 'circle',
      x: lamp.x,
      z: lamp.z,
      r,
      cameraTopY: lamp.y + STREETLAMP_FIXTURE_HEIGHT,
    });
  }
  return posts;
}
