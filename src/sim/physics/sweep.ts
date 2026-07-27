// Swept-volume collision math: continuous time-of-impact (TOI) for a moving
// body circle against the world's static shapes, with the contact normal the
// slide solver needs. Pure functions, no state, no rng.
//
// The world's collision geometry is EXTRUDED 2D: every obstacle is a circle or
// an oriented box in XZ, rising from the ground to a known top (`moveTopY`,
// absent = full height). So a body capsule reduces exactly to a circle sweep
// in XZ plus a scalar height test, which is both cheaper and more robust than
// a general 3D solver, and is exact for this geometry rather than approximate.
//
// Everything here returns a fraction t of the requested motion in [0, 1], with
// Infinity meaning "no impact". Callers advance to t (minus a skin), then
// project the remainder along the returned normal (see character.ts).

import type { Collider } from '../colliders';

/** Contact gap kept between the body and a surface (yards). Prevents the
 *  next tick's sweep from starting exactly on the surface, where float error
 *  decides between "touching" and "inside". */
export const SKIN_WIDTH = 0.01;
/** Below this the motion is treated as stationary. */
const MIN_MOTION = 1e-9;

export interface SweepHit {
  /** Fraction of the motion travelled before contact (0..1). */
  t: number;
  /** Outward unit contact normal in world XZ (points from surface to body). */
  nx: number;
  nz: number;
}

// Rotate a world offset into an OBB's local frame (three.js rotation.y
// convention, matching colliders.ts rotY), writing into `out`: this runs
// two to three times per OBB sweep on the per-tick hot path, so it must not
// allocate.
function rotYInto(lx: number, lz: number, rot: number, out: { x: number; z: number }): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  out.x = lx * c + lz * s;
  out.z = -lx * s + lz * c;
}

// Scratch, module-local: this runs per body per tick, allocation-free.
const localStart = { x: 0, z: 0 };
const localDelta = { x: 0, z: 0 };
const worldNormal = { x: 0, z: 0 };

/**
 * TOI of a point moving (dx, dz) from (px, pz) against a circle of radius R
 * (already the Minkowski sum of the obstacle and the body). Returns Infinity
 * on a miss, and 0 with an escape normal when the start is already inside.
 */
function sweepPointCircle(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  cx: number,
  cz: number,
  R: number,
  out: { t: number; nx: number; nz: number },
): boolean {
  const fx = px - cx;
  const fz = pz - cz;
  const c = fx * fx + fz * fz - R * R;
  if (c <= 0) {
    // Already overlapping: report an immediate hit whose normal escapes the
    // penetration (depenetration is the caller's job, but the normal must be
    // sane so a slide never drives deeper).
    const d = Math.hypot(fx, fz);
    out.t = 0;
    out.nx = d > 1e-9 ? fx / d : 1;
    out.nz = d > 1e-9 ? fz / d : 0;
    return true;
  }
  const a = dx * dx + dz * dz;
  if (a < MIN_MOTION) return false;
  const b = 2 * (fx * dx + fz * dz);
  if (b >= 0) return false; // moving away from the circle
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > 1) return false;
  const hx = px + dx * t - cx;
  const hz = pz + dz * t - cz;
  const hl = Math.hypot(hx, hz);
  out.t = t;
  out.nx = hl > 1e-9 ? hx / hl : 1;
  out.nz = hl > 1e-9 ? hz / hl : 0;
  return true;
}

/**
 * TOI of the body circle against one collider. `r` is the body radius; the
 * obstacle is inflated by it (Minkowski sum), reducing the body to a point.
 * OBBs become rounded rectangles: slab test for the faces, corner circles for
 * the rounded corners, which is what keeps a body from catching on a box edge.
 */
export function sweepCollider(
  c: Collider,
  x: number,
  z: number,
  dx: number,
  dz: number,
  r: number,
  out: { t: number; nx: number; nz: number },
): boolean {
  if (c.type === 'circle') return sweepPointCircle(x, z, dx, dz, c.x, c.z, c.r + r, out);

  // OBB: work in the box's local frame, where it is an axis-aligned rounded
  // rectangle of extents (hw + r, hd + r) with corner radius r.
  rotYInto(x - c.x, z - c.z, -c.rot, localStart);
  rotYInto(dx, dz, -c.rot, localDelta);
  const ex = c.hw + r;
  const ez = c.hd + r;
  const sx = localStart.x;
  const sz = localStart.z;
  const vx = localDelta.x;
  const vz = localDelta.z;

  if (Math.abs(sx) <= ex && Math.abs(sz) <= ez) {
    // Start inside the inflated box: escape along the shallowest axis.
    const px = ex - Math.abs(sx);
    const pz = ez - Math.abs(sz);
    const lnx = px <= pz ? Math.sign(sx || 1) : 0;
    const lnz = px <= pz ? 0 : Math.sign(sz || 1);
    rotYInto(lnx, lnz, c.rot, worldNormal);
    out.t = 0;
    out.nx = worldNormal.x;
    out.nz = worldNormal.z;
    return true;
  }

  // Slab test against the inflated box.
  let tEnter = 0;
  let tExit = 1;
  let enterAxis = 0; // 1 = x slab, 2 = z slab
  let enterSign = 0;
  if (Math.abs(vx) < MIN_MOTION) {
    if (sx < -ex || sx > ex) return false;
  } else {
    const inv = 1 / vx;
    let t1 = (-ex - sx) * inv;
    let t2 = (ex - sx) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      enterAxis = 1;
      enterSign = sign;
    }
    if (t2 < tExit) tExit = t2;
  }
  if (Math.abs(vz) < MIN_MOTION) {
    if (sz < -ez || sz > ez) return false;
  } else {
    const inv = 1 / vz;
    let t1 = (-ez - sz) * inv;
    let t2 = (ez - sz) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      enterAxis = 2;
      enterSign = sign;
    }
    if (t2 < tExit) tExit = t2;
  }
  if (tEnter > tExit || tEnter > 1 || tEnter < 0) return false;

  const hx = sx + vx * tEnter;
  const hz = sz + vz * tEnter;
  // Corner region: the inflated box overstates the shape there, so fall back
  // to the exact rounded corner (a circle of the body radius at the box
  // corner). Without this a body clips the phantom square corner.
  if (r > 0 && Math.abs(hx) > c.hw && Math.abs(hz) > c.hd) {
    const cornerX = Math.sign(hx) * c.hw;
    const cornerZ = Math.sign(hz) * c.hd;
    if (!sweepPointCircle(sx, sz, vx, vz, cornerX, cornerZ, r, out)) return false;
    rotYInto(out.nx, out.nz, c.rot, worldNormal);
    out.nx = worldNormal.x;
    out.nz = worldNormal.z;
    return true;
  }

  const lnx = enterAxis === 1 ? enterSign : 0;
  const lnz = enterAxis === 2 ? enterSign : 0;
  rotYInto(lnx, lnz, c.rot, worldNormal);
  out.t = tEnter;
  out.nx = worldNormal.x;
  out.nz = worldNormal.z;
  return true;
}

/**
 * Minimum-translation push of the body circle out of one collider it overlaps.
 * Returns false when clear. Mirrors colliders.ts `pushOut`, but reports the
 * escape normal and depth so the solver can depenetrate along a stable axis.
 */
export function overlapCollider(
  c: Collider,
  x: number,
  z: number,
  r: number,
  out: { nx: number; nz: number; depth: number },
): boolean {
  if (c.type === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2);
    if (d < 1e-9) {
      out.nx = 1;
      out.nz = 0;
      out.depth = min;
      return true;
    }
    out.nx = dx / d;
    out.nz = dz / d;
    out.depth = min - d;
    return true;
  }
  rotYInto(x - c.x, z - c.z, -c.rot, localStart);
  const ex = c.hw + r;
  const ez = c.hd + r;
  const lx = localStart.x;
  const lz = localStart.z;
  if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return false;
  const px = ex - Math.abs(lx);
  const pz = ez - Math.abs(lz);
  const lnx = px <= pz ? Math.sign(lx || 1) : 0;
  const lnz = px <= pz ? 0 : Math.sign(lz || 1);
  rotYInto(lnx, lnz, c.rot, worldNormal);
  out.nx = worldNormal.x;
  out.nz = worldNormal.z;
  out.depth = Math.min(px, pz);
  return true;
}
