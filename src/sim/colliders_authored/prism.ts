// Convex banded PRISM geometry: the shape a Collision Master volume collides
// as. Outline sampling at the feet height (the loft), the covering box, the
// containment test, and the push-out the movement resolver runs. Pure: reads
// only the collider record it is handed. Extracted out of colliders.ts.

import type { PrismCollider } from '../collider_shapes';

// Scratch for prismPolyAt: consumed immediately by the caller, never held.
let prismOutlineView: number[] = [];

/**
 * The prism's effective outline for a body whose FEET are at `feetY`:
 * the loft interpolated at that height when the prism carries one, else the
 * union hull. Returns a shared scratch view - consume before the next call.
 */
export function prismPolyAt(c: PrismCollider, feetY: number | undefined): readonly number[] {
  const lo = c.polyLo;
  const hi = c.polyHi;
  if (
    feetY === undefined ||
    !lo ||
    !hi ||
    c.baseY === undefined ||
    c.moveTopY === undefined ||
    c.moveTopY - c.baseY < 1e-6 ||
    lo.length !== hi.length
  ) {
    return c.poly;
  }
  const t = Math.min(1, Math.max(0, (feetY - c.baseY) / (c.moveTopY - c.baseY)));
  const n = lo.length;
  if (prismOutlineView.length !== n) prismOutlineView = new Array(n);
  for (let i = 0; i < n; i++) {
    prismOutlineView[i] = lo[i] + (hi[i] - lo[i]) * t;
  }
  return prismOutlineView;
}

/**
 * The axis-aligned box that covers a prism's outline. Consumers that can only
 * reason about rectangles (minimap, the coarse camera sweep) read this rather
 * than every face.
 */
export function prismBox(c: PrismCollider): {
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
} {
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < c.poly.length; i += 2) {
    const u = c.poly[i];
    const v = c.poly[i + 1];
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (minU > maxU) return { x: c.x, z: c.z, hw: c.br, hd: c.br, rot: 0 };
  return {
    x: c.x + (minU + maxU) / 2,
    z: c.z + (minV + maxV) / 2,
    hw: (maxU - minU) / 2,
    hd: (maxV - minV) / 2,
    rot: 0,
  };
}

/** Is (x,z) inside the prism's outline (no body-radius inflation)? */
export function insidePrism(c: PrismCollider, x: number, z: number): boolean {
  const px = x - c.x;
  const pz = z - c.z;
  if (px * px + pz * pz > c.br * c.br) return false;
  const poly = c.poly;
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    if ((px - ax) * ez - (pz - az) * ex > 0) return false;
  }
  return true;
}

/**
 * Push a body of radius `r` out of a convex prism: the nearest face for a body
 * outside it, the SHALLOWEST face for one already inside (the exit it is
 * closest to), so a mover that spawns in a wall walks out the near side rather
 * than being flung through the far one.
 */
export function pushOutPrism(
  c: PrismCollider,
  x: number,
  z: number,
  r: number,
  feetY?: number,
): { x: number; z: number } | null {
  const px = x - c.x;
  const pz = z - c.z;
  const reach = c.br + r;
  if (px * px + pz * pz > reach * reach) return null; // O(1) reject
  // Height-aware: a lofted prism collides with its authored section at the
  // mover's own feet height, so a tapered volume feels exactly as drawn.
  const poly = prismPolyAt(c, feetY);
  const n = poly.length;
  let inside = true;
  let faceD = Number.NEGATIVE_INFINITY;
  let faceNx = 0;
  let faceNz = 0;
  let nearX = 0;
  let nearZ = 0;
  let nearD2 = Infinity;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-12) continue;
    const len = Math.sqrt(len2);
    // Counter-clockwise outline: the outward normal of a->b is (ez, -ex).
    const nx = ez / len;
    const nz = -ex / len;
    const d = (px - ax) * nx + (pz - az) * nz;
    if (d > 0) inside = false;
    if (d > faceD) {
      faceD = d;
      faceNx = nx;
      faceNz = nz;
    }
    let t = ((px - ax) * ex + (pz - az) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cz = az + ez * t;
    const d2 = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
    if (d2 < nearD2) {
      nearD2 = d2;
      nearX = cx;
      nearZ = cz;
    }
  }
  if (nearD2 === Infinity) return null; // degenerate outline
  if (inside) {
    // faceD is negative inside: clear the face by the body radius on top of it.
    const push = r - faceD;
    return { x: c.x + px + faceNx * push, z: c.z + pz + faceNz * push };
  }
  const dist = Math.sqrt(nearD2);
  if (dist >= r) return null;
  if (dist < 1e-6) {
    return { x: c.x + nearX + faceNx * r, z: c.z + nearZ + faceNz * r };
  }
  const k = r / dist;
  return { x: c.x + nearX + (px - nearX) * k, z: c.z + nearZ + (pz - nearZ) * k };
}
