// A round low wall (types.ts FieldRingWall) as the boxes a map draws its band
// with: `segments` boxes round it, each spanning the band from `inner` to
// `outer` and overlapping its neighbours so the drawn ring has no gap. Its
// collider is not these boxes (field_colliders.ts: one circle). Pure.

import type { FieldRingWall, FieldWall } from './types';

/** How many boxes a ring wall's band is drawn with. */
export const RING_WALL_SEGMENTS = 32;

/** The ring's band as `segments` boxes (three.js yaw: local x along the ring,
 *  local z out from its middle). */
export function ringWallBoxes(w: FieldRingWall, segments = RING_WALL_SEGMENTS): FieldWall[] {
  const mid = (w.inner + w.outer) / 2;
  const half = w.outer * Math.tan(Math.PI / segments) + 0.15;
  const out: FieldWall[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    out.push({
      id: `${w.id}_${i}`,
      x: w.x + Math.sin(a) * mid,
      z: w.z + Math.cos(a) * mid,
      hw: half,
      hd: (w.outer - w.inner) / 2,
      rot: a,
      height: w.height,
      ...(w.sightClear ? { sightClear: true } : {}),
    });
  }
  return out;
}
