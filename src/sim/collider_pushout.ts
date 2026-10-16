// The static-collision push-out kernel, moved verbatim out of colliders.ts
// (the monolith ratchet) so the interior cell index (interior_collider_cells.ts)
// resolves through the very same loop: pushOut against one collider (circle,
// OBB, or an authored prism) and resolveAgainst, the sequential three-pass
// slide every collision arm runs, with the mover pass-over and pass-under
// gates. The shapes and the top sampler live in collider_shapes.ts, the
// pass-over gate in parkour_heights.ts, the prism and pass-under halves in
// colliders_authored/. No Sim state, no rng, and no import of colliders.ts
// itself (no import cycle).
import { type Collider, rotY } from './collider_shapes';
import { passesUnder, pushOutPrism } from './colliders_authored';
import { type MoverHeight, passesOver } from './parkour_heights';

// Push (x,z) out of one collider. Returns the corrected point, or null if clear.
export function pushOut(
  c: Collider,
  x: number,
  z: number,
  r: number,
  feetY?: number,
): { x: number; z: number } | null {
  if (c.type === 'circle') {
    const dx = x - c.x,
      dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: c.x + min, z: c.z };
    const k = min / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }
  if (c.type === 'prism') return pushOutPrism(c, x, z, r, feetY);
  // OBB: into local frame
  const local = rotY(x - c.x, z - c.z, -c.rot);
  const ex = c.hw + r,
    ez = c.hd + r;
  if (Math.abs(local.x) >= ex || Math.abs(local.z) >= ez) return null;
  const pushX = ex - Math.abs(local.x);
  const pushZ = ez - Math.abs(local.z);
  const out = { x: local.x, z: local.z };
  if (pushX < pushZ) out.x = Math.sign(local.x || 1) * ex;
  else out.z = Math.sign(local.z || 1) * ez;
  const world = rotY(out.x, out.z, c.rot);
  return { x: c.x + world.x, z: c.z + world.z };
}

/** A half-open box [minX, maxX) x [minZ, maxZ) a bounded resolve must stay in
 *  (the query cell of interior_collider_cells.ts). */
export interface ResolveBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Sequential push-out slide: up to three passes over the list in order, each
// collider nudging the point out of itself. With `within`, the resolve is
// BOUNDED: the moment a push carries the point out of that box it gives up
// and returns null (the caller then re-runs the full list), which is what lets
// a cell subset stand in for the full list exactly (see
// interior_collider_cells.ts for the completeness argument).
export function resolveAgainst(
  list: Collider[],
  x: number,
  z: number,
  r: number,
  ignoreFences?: boolean,
  mover?: MoverHeight,
): { x: number; z: number };
export function resolveAgainst(
  list: Collider[],
  x: number,
  z: number,
  r: number,
  ignoreFences: boolean,
  mover: MoverHeight | undefined,
  within: ResolveBox,
): { x: number; z: number } | null;
export function resolveAgainst(
  list: Collider[],
  x: number,
  z: number,
  r: number,
  ignoreFences = false,
  mover?: MoverHeight,
  within?: ResolveBox,
): { x: number; z: number } | null {
  let px = x,
    pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      if (ignoreFences && c.type === 'obb' && c.isFence) continue;
      // Height-less movers (mobs, pathing) never pass over or under: skip both calls.
      if (mover && (passesOver(c, mover, px, pz) || passesUnder(c, mover.y))) continue;
      const res = pushOut(c, px, pz, r, mover?.y);
      if (res) {
        px = res.x;
        pz = res.z;
        moved = true;
        if (
          within &&
          (px < within.minX || px >= within.maxX || pz < within.minZ || pz >= within.maxZ)
        ) {
          return null;
        }
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}
