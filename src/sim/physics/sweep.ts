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

import { type Collider, type PrismCollider, prismPolyAt } from '../colliders';

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
const prismHit = { t: 0, nx: 0, nz: 0 };
const prismOverlap = { nx: 0, nz: 0, depth: 0 };

/**
 * Exact overlap of the body circle against a prism's convex outline.
 * Mirrors colliders.ts pushOutPrism feature-for-feature (CCW outline, outward
 * edge normal (ez, -ex)); reports the escape normal + depth the solver needs.
 *
 * This must be the OUTLINE, never the bounding box: placements bake their yaw
 * into the poly, so a rotated building's box is up to sqrt(2) larger than the
 * building, box-testing it planted an invisible axis-aligned wall yards off
 * every rotated Collision Master volume ("the collision doesn't match the
 * wireframe": the wireframe draws the outline, the box was what blocked).
 */
function overlapPrism(
  c: PrismCollider,
  x: number,
  z: number,
  r: number,
  out: { nx: number; nz: number; depth: number },
  feetY?: number,
): boolean {
  const px = x - c.x;
  const pz = z - c.z;
  const reach = c.br + r;
  if (px * px + pz * pz > reach * reach) return false;
  // Lofted prisms overlap against their authored section at the body's own
  // feet height (tapered volumes feel exactly as drawn in Collision Master).
  const poly = prismPolyAt(c, feetY);
  const n = poly.length;
  let inside = true;
  let bestFaceD = Number.NEGATIVE_INFINITY;
  let faceNx = 0;
  let faceNz = 0;
  let nearD2 = Infinity;
  let nearX = 0;
  let nearZ = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-12) continue;
    const len = Math.sqrt(len2);
    const nx = ez / len;
    const nz = -ex / len;
    const d = (px - ax) * nx + (pz - az) * nz;
    if (d > 0) inside = false;
    if (d > bestFaceD) {
      bestFaceD = d;
      faceNx = nx;
      faceNz = nz;
    }
    let t = ((px - ax) * ex + (pz - az) * ez) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t;
    const qz = az + ez * t;
    const dd = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
    if (dd < nearD2) {
      nearD2 = dd;
      nearX = qx;
      nearZ = qz;
    }
  }
  if (inside) {
    // Centre inside the outline: escape along the CLOSEST face (the least
    // negative signed distance), through it, plus the body radius.
    out.nx = faceNx;
    out.nz = faceNz;
    out.depth = -bestFaceD + r;
    return true;
  }
  const d = Math.sqrt(nearD2);
  if (d >= r) return false;
  if (d < 1e-9) {
    out.nx = faceNx;
    out.nz = faceNz;
  } else {
    out.nx = (px - nearX) / d;
    out.nz = (pz - nearZ) / d;
  }
  out.depth = r - d;
  return true;
}

/**
 * Exact TOI of the body circle against a prism's convex outline: the
 * Minkowski surface is each edge pushed out by r plus an arc of radius r at
 * each vertex. Start-inside is handled by the caller via overlapPrism.
 */
function sweepPointPrism(
  x: number,
  z: number,
  dx: number,
  dz: number,
  c: PrismCollider,
  r: number,
  out: { t: number; nx: number; nz: number },
  feetY?: number,
): boolean {
  const px = x - c.x;
  const pz = z - c.z;
  const poly = prismPolyAt(c, feetY);
  const n = poly.length;
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i];
    const az = poly[i + 1];
    // Vertex arc: a circle of radius r at the corner.
    if (sweepPointCircle(px, pz, dx, dz, ax, az, r, prismHit) && prismHit.t < best) {
      best = prismHit.t;
      bnx = prismHit.nx;
      bnz = prismHit.nz;
    }
    // Edge face, offset outward by r; the arcs above own the end caps.
    const ex = poly[j] - ax;
    const ez = poly[j + 1] - az;
    const len2 = ex * ex + ez * ez;
    if (len2 < 1e-12) continue;
    const len = Math.sqrt(len2);
    const nx = ez / len;
    const nz = -ex / len;
    const vn = dx * nx + dz * nz;
    if (vn >= -MIN_MOTION) continue; // moving away from or along the face
    const dist = (px - ax) * nx + (pz - az) * nz;
    const t = (dist - r) / -vn;
    if (t < 0 || t > 1 || t >= best) continue;
    const hx = px + dx * t;
    const hz = pz + dz * t;
    const s = ((hx - ax) * ex + (hz - az) * ez) / len2;
    if (s < 0 || s > 1) continue;
    best = t;
    bnx = nx;
    bnz = nz;
  }
  if (best === Infinity) return false;
  out.t = best;
  out.nx = bnx;
  out.nz = bnz;
  return true;
}

/**
 * TOI of a point moving (dx, dz) from (px, pz) against a circle of radius R
 * (already the Minkowski sum of the obstacle and the body). Returns Infinity
 * on a miss, and 0 with an escape normal when the start is already inside.
 * Strictly inside (`c < 0`), not merely touching: a start EXACTLY on the
 * boundary must fall through to the ordinary quadratic below, whose own
 * `b >= 0` check lets departing or tangential motion miss. Treating touching
 * as overlapping here would report a hit regardless of direction, freezing a
 * body caught at exact zero clearance in every direction, including away.
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
  if (c < 0) {
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
  feetY?: number,
): boolean {
  if (c.type === 'circle') return sweepPointCircle(x, z, dx, dz, c.x, c.z, c.r + r, out);

  // Collision Master prism: sweep the EXACT convex outline. It used to sweep
  // the prism's bounding box "conservatively", but a placement bakes its yaw
  // into the poly, a building rotated 45 degrees had a box sqrt(2) its size,
  // and the sweep stopped the body at that phantom axis-aligned wall yards
  // before the drawn face (depenetration and the debug wireframe both use the
  // outline, so nothing ever drew or pushed where the body stopped).
  if (c.type === 'prism') {
    if (overlapPrism(c, x, z, r, prismOverlap, feetY)) {
      out.t = 0;
      out.nx = prismOverlap.nx;
      out.nz = prismOverlap.nz;
      return true;
    }
    return sweepPointPrism(x, z, dx, dz, c, r, out, feetY);
  }

  // OBB: work in the box's local frame, where it is an axis-aligned rounded
  // rectangle of extents (hw + r, hd + r) with corner radius r.
  const b = c;
  rotYInto(x - b.x, z - b.z, -b.rot, localStart);
  rotYInto(dx, dz, -b.rot, localDelta);
  const ex = b.hw + r;
  const ez = b.hd + r;
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
    rotYInto(lnx, lnz, b.rot, worldNormal);
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
  if (r > 0 && Math.abs(hx) > b.hw && Math.abs(hz) > b.hd) {
    const cornerX = Math.sign(hx) * b.hw;
    const cornerZ = Math.sign(hz) * b.hd;
    if (!sweepPointCircle(sx, sz, vx, vz, cornerX, cornerZ, r, out)) return false;
    rotYInto(out.nx, out.nz, b.rot, worldNormal);
    out.nx = worldNormal.x;
    out.nz = worldNormal.z;
    return true;
  }

  const lnx = enterAxis === 1 ? enterSign : 0;
  const lnz = enterAxis === 2 ? enterSign : 0;
  rotYInto(lnx, lnz, b.rot, worldNormal);
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
  feetY?: number,
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
  // Prism: exact outline (see overlapPrism - the box version planted
  // invisible walls off every rotated authored volume).
  if (c.type === 'prism') return overlapPrism(c, x, z, r, out, feetY);
  const b = c;
  rotYInto(x - b.x, z - b.z, -b.rot, localStart);
  const ex = b.hw + r;
  const ez = b.hd + r;
  const lx = localStart.x;
  const lz = localStart.z;
  if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return false;
  const px = ex - Math.abs(lx);
  const pz = ez - Math.abs(lz);
  const lnx = px <= pz ? Math.sign(lx || 1) : 0;
  const lnz = px <= pz ? 0 : Math.sign(lz || 1);
  rotYInto(lnx, lnz, b.rot, worldNormal);
  out.nx = worldNormal.x;
  out.nz = worldNormal.z;
  out.depth = Math.min(px, pz);
  return true;
}
