// The chase-boom clamp against placed-asset colliders (authored maps only):
// which colliders the boom can hit, and the march along the eye->camera
// segment that finds the last clear distance. Extracted out of colliders.ts,
// which keeps the gate (authored map, open world) and the grid query in its
// `cameraBoomMaxDist` and hands the queried list here. Pure: the list and the
// narrow-phase push-out come in as arguments.

import type { Collider } from '../collider_shapes';

/** The narrow phase the boom samples with (colliders.ts `pushOut`). */
export type BoomPushOut = (
  c: Collider,
  x: number,
  z: number,
  r: number,
) => { x: number; z: number } | null;

// A collider thin enough that the chase boom should slide past it rather than
// snap in: tree trunks, lamp posts, barrels, fence posts. Walls are thin in ONE
// axis only, so an OBB is judged by its long side; prisms are authored volumes
// (Collision Master) and always count.
const CAMERA_SOLID_MIN_RADIUS = 0.9;
const CAMERA_SOLID_MIN_SPAN = 1.2;
export function cameraSolid(c: Collider): boolean {
  if (c.type === 'circle') return c.r >= CAMERA_SOLID_MIN_RADIUS;
  if (c.type === 'obb') return Math.max(c.hw, c.hd) >= CAMERA_SOLID_MIN_SPAN;
  return true;
}
export const CAMERA_BOOM_STEP = 0.3;

/**
 * How far along the eye->camera segment the chase boom may pull before the
 * camera would sit inside a placed asset: Infinity when nothing solid crosses
 * the boom, else the last clear distance. The terrain clamp's twin for the
 * open world's colliders (SPACEY, 2026-09-19: "make the camera work with our
 * assets colliion just like the terrain"). A collider the boom passes OVER
 * (cameraTopY at or under the sample) or UNDER (baseY above it) is not in the
 * way, and one that already holds the eye (a deck underfoot, a doorway the
 * player stands in) can never be escaped by shortening, so it is ignored.
 *
 * NOTHING ABOVE THE PLAYER'S HEAD stops the boom (SPACEY, 2026-09-21: "its
 * getting caught on the assets above ... the camera shouldnt be influenced by
 * whats above the player"). A ceiling, an upper deck or a yardarm the player
 * is standing UNDER is not an obstacle between the eye and the camera; only
 * the pitch-up arc ever reached it, and snapping the boom there threw the view
 * into the deck. Geometry beside the player still stops it: a mast's box
 * starts at the deck, well below `ey`, so it keeps blocking. Overhead solids
 * that end up between the camera and the player are handled where they belong,
 * by the occluder-fade passes.
 *
 * `list` is the caller's broad-phase result over the segment's padded bounds;
 * it is FILTERED IN PLACE (kept colliders compacted to the front, query order
 * preserved). Infinity for a segment shorter than one march step.
 */
export function cameraBoomClearDistance(
  list: Collider[],
  ex: number,
  ey: number,
  ez: number,
  cx: number,
  cy: number,
  cz: number,
  pad: number,
  pushOut: BoomPushOut,
): number {
  const dx = cx - ex;
  const dy = cy - ey;
  const dz = cz - ez;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < CAMERA_BOOM_STEP) return Infinity;
  let kept = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!cameraSolid(c)) continue;
    if (c.cameraTopY !== undefined && c.cameraTopY <= Math.min(ey, cy)) continue;
    // `ey` is the eye, which on this body sits at the crown: a collider whose
    // base is at or above it is overhead, never in the way.
    if (c.baseY !== undefined && c.baseY >= ey) continue;
    if (c.baseY !== undefined && c.baseY > Math.max(ey, cy)) continue;
    if (pushOut(c, ex, ez, pad) !== null) continue; // already holds the eye
    list[kept++] = c;
  }
  list.length = kept;
  if (kept === 0) return Infinity;
  const steps = Math.ceil(dist / CAMERA_BOOM_STEP);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ex + dx * t;
    const y = ey + dy * t;
    const z = ez + dz * t;
    for (let k = 0; k < kept; k++) {
      const c = list[k];
      if (c.cameraTopY !== undefined && c.cameraTopY <= y) continue;
      if (c.baseY !== undefined && c.baseY > y) continue;
      if (pushOut(c, x, z, pad) !== null) return Math.max(0, dist * t - CAMERA_BOOM_STEP);
    }
  }
  return Infinity;
}
