// The walkable surface of an editor 'collider/plane' volume (moved out of
// world.ts groundHeightFor): its floor height at a point, or null outside the
// footprint. Pure, so world.ts folds it into the ground from above and
// deck_ceiling.ts reads the same surface from underneath.
import type { ColliderVolume } from './types';

/** The plane's floor at the offset (dx, dz) from its anchor, given the floor
 *  height at its centre (`base`: detached anchor or live terrain, plus the
 *  gizmo Y-lift and the size offset), or null outside its footprint. */
export function planeFloorAt(
  v: ColliderVolume,
  dx: number,
  dz: number,
  base: number,
): number | null {
  if (!v.rotX && !v.rotZ) {
    const c = Math.cos(v.rotY);
    const s = Math.sin(v.rotY);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) > v.sizeX / 2 || Math.abs(lz) > v.sizeZ / 2) return null;
    return base;
  }
  // Tilted (a ramp): invert the plane's own XZ basis to get the footprint
  // coordinates, then ride its two axes' vertical components to the surface.
  const ca = Math.cos(v.rotX ?? 0);
  const sa = Math.sin(v.rotX ?? 0);
  const cb = Math.cos(v.rotY);
  const sb = Math.sin(v.rotY);
  const cg = Math.cos(v.rotZ ?? 0);
  const sg = Math.sin(v.rotZ ?? 0);
  const ux = cb * cg;
  const uy = ca * sg + sa * sb * cg;
  const uz = sa * sg - ca * sb * cg;
  const wx = sb;
  const wy = -sa * cb;
  const wz = ca * cb;
  const det = ux * wz - wx * uz;
  if (Math.abs(det) < 1e-6) return null;
  const lx = (dx * wz - wx * dz) / det;
  const lz = (ux * dz - dx * uz) / det;
  if (Math.abs(lx) > v.sizeX / 2 || Math.abs(lz) > v.sizeZ / 2) return null;
  return base + lx * uy + lz * wy;
}
