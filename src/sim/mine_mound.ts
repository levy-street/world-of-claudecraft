// A mine's spoil mound behind its timber portal: where it lies and how wide, shared by the
// collider set (colliders.ts) and the renderer (src/render/props.ts) so the heap that is
// drawn and the heap that is walked round cannot drift apart. Pure: no rng, no clock.
import { rotY } from './collider_shapes';

// default backward offset/radius for a mine's spoil mound behind the timber portal
export const MINE_MOUND_DEFAULT_OFFSET = 3.4;
export const MINE_MOUND_DEFAULT_RADIUS = 5;

export function mineMoundFootprint(m: {
  x: number;
  z: number;
  rot: number;
  moundOffset?: number;
  moundRadius?: number;
}): { x: number; z: number; r: number } {
  const r = m.moundRadius ?? MINE_MOUND_DEFAULT_RADIUS;
  const mound = rotY(0, -(m.moundOffset ?? MINE_MOUND_DEFAULT_OFFSET), m.rot);
  return { x: m.x + mound.x, z: m.z + mound.z, r };
}
