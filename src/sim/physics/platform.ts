// Kinematic platforms: collider sets that are NOT in the static collider grid
// because they move (a sailing ship's deck, src/sim/transport_deck.ts). The
// grid stays static; the movement kernel hands a platform's colliders, already
// placed at the platform's current pose, to the solver alongside the grid's
// (`CharacterMoveParams.platform`, `floorHeightAt`'s `platform`), and asks the
// two queries below for the surfaces a body stands and walks on. Carrying the
// body with the platform between ticks is the platform owner's job (a rigid
// transform before the step), so to the solver a platform is simply more
// geometry, exact in this tick's frame.
//
// Both queries mirror their grid twins in colliders.ts predicate for
// predicate (`supportHeightAt`'s best standable top, `slopeGlueHeight`'s
// surface-underfoot glue), over a caller-supplied list instead of grid cells,
// so a deck plank and a stone quay seat a body identically. Pure leaf: no
// SimContext, no rng, no allocation.

import { type Collider, colliderTopAt, SUPPORT_OVERLAP } from '../colliders';

/** Height comparisons against a platform top (the grid's MOVE_TOP_EPS). */
const TOP_EPS = 1e-3;

/** Does a body disc of reach `reachR` at (x, z) overlap collider `c`'s footprint? */
function withinFootprint(c: Collider, x: number, z: number, reachR: number): boolean {
  if (c.type === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.r + reachR;
    return dx * dx + dz * dz < reach * reach;
  }
  const cos = Math.cos(-c.rot);
  const sin = Math.sin(-c.rot);
  const dx = x - c.x;
  const dz = z - c.z;
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  return Math.abs(lx) < c.hw + reachR && Math.abs(lz) < c.hd + reachR;
}

/**
 * Highest standable platform top under (x, z) at or below `maxY`, or
 * -Infinity. The same support rule as the grid's (a body is held up while
 * its disc overlaps a top by SUPPORT_OVERLAP of its radius).
 */
export function platformSupportAt(
  platform: readonly Collider[] | null | undefined,
  x: number,
  z: number,
  r: number,
  maxY: number,
): number {
  if (!platform) return -Infinity;
  let best = -Infinity;
  const reachR = r * SUPPORT_OVERLAP;
  for (let i = 0; i < platform.length; i++) {
    const c = platform[i];
    if (!c.standable || c.moveTopY === undefined) continue;
    if (!withinFootprint(c, x, z, reachR)) continue;
    const top = colliderTopAt(c, x, z);
    if (top > maxY + TOP_EPS || top <= best) continue;
    best = top;
  }
  return best;
}

/**
 * The platform surface a grounded body was standing on at (fromX, fromZ),
 * sampled where it is now, while any of its disc still covers it: the grid's
 * slope glue over the platform list (it walks a body to a top's very edge and
 * never drops it embedded). -Infinity when no platform top was underfoot.
 */
export function platformGlueAt(
  platform: readonly Collider[] | null | undefined,
  fromX: number,
  fromZ: number,
  x: number,
  z: number,
  r: number,
  feetY: number,
): number {
  if (!platform) return -Infinity;
  let best = -Infinity;
  for (let i = 0; i < platform.length; i++) {
    const c = platform[i];
    if (!c.standable || c.moveTopY === undefined) continue;
    if (Math.abs(colliderTopAt(c, fromX, fromZ) - feetY) > 0.05) continue;
    if (!withinFootprint(c, x, z, r)) continue;
    best = Math.max(best, colliderTopAt(c, x, z));
  }
  return best;
}
