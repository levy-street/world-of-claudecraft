// The static-collision push-out kernel, moved verbatim out of colliders.ts
// (the monolith ratchet) so the interior cell index (interior_collider_cells.ts)
// resolves through the very same loop: pushOut against one collider, the
// mover pass-over gate, the standable top sampler, and resolveAgainst, the
// sequential three-pass slide every collision arm runs. Pure leaf: no Sim
// state, no rng, type-only imports from colliders.ts (no import cycle).
import type { Collider, MoverHeight } from './colliders';

/**
 * The standable surface height of a collider at a point: `moveTopY` for flat
 * tops, the pitched surface for sloped ones (never above `moveTopY`, never
 * below the eaves). Infinity for full-height colliders, which have no top.
 */
export function colliderTopAt(c: Collider, x: number, z: number): number {
  const top = c.moveTopY;
  if (top === undefined) return Infinity;
  const s = c.topSlope;
  if (!s) return top;
  let run: number;
  if (s.kind === 'cone' || c.type === 'circle') {
    run = Math.hypot(x - c.x, z - c.z);
  } else {
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = (x - c.x) * cos + (z - c.z) * sin;
    const lz = -(x - c.x) * sin + (z - c.z) * cos;
    // The surface falls across the axis PERPENDICULAR to the ridge line.
    run = s.axis === 'z' ? Math.abs(lx) : Math.abs(lz);
  }
  return Math.max(s.eaveY, top - run * s.pitch);
}

/** Float slack when comparing feet height against a collider top. */
export const MOVE_TOP_EPS = 1e-3;

/** Head clearance a mover with height needs to walk beneath an elevated slab
 *  (`passUnderY`): a touch above the tallest body so a deck one yard overhead
 *  still walls, while a real balcony admits the walk below. */
const PASS_UNDER_HEADROOM = 2.1;

// Does the mover pass clean over this collider at (x, z)? Full-height
// colliders (moveTopY undefined) never pass; standable tops grant the mantle
// lift. Sloped tops are sampled at the mover's own point, so the eaves of a
// roof pass a body the ridge would still wall. An elevated slab that carries
// `passUnderY` also passes the mover walking BENEATH it when their head
// clears its underside (the balcony-walk contract); height-less movers never
// reach here, so mobs and pathfinding still see a full-height solid.
function passesOver(c: Collider, mover: MoverHeight | undefined, x: number, z: number): boolean {
  if (!mover || c.moveTopY === undefined) return false;
  if (c.passUnderY !== undefined && mover.y + PASS_UNDER_HEADROOM <= c.passUnderY) return true;
  return colliderTopAt(c, x, z) <= mover.y + (c.standable ? mover.lift : 0) + MOVE_TOP_EPS;
}

// rotate a local offset by a three.js rotation.y angle
export function rotY(lx: number, lz: number, rot: number): { x: number; z: number } {
  const c = Math.cos(rot),
    s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

// Push (x,z) out of one collider. Returns the corrected point, or null if clear.
export function pushOut(
  c: Collider,
  x: number,
  z: number,
  r: number,
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
      if (passesOver(c, mover, px, pz)) continue;
      const res = pushOut(c, px, pz, r);
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
