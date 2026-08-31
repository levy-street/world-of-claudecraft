// Pure sightline math for the hideable dungeon shell walls: does a wall
// footprint (an axis-aligned or ry-rotated box in plan view) cross the
// eye-to-camera segment below its top edge? DungeonInteriors.update
// (src/render/dungeon.ts) asks per wall per frame and fades any hit to 20%
// opacity instead of blanking the view. Three-free on purpose
// (RENDER_PURE_CORES): a Vitest drives it directly.

export interface ArenaWallFootprint {
  x: number;
  z: number;
  hw: number;
  hd: number;
  topY: number;
  ry?: number;
}

function pointInsideArenaWall(f: ArenaWallFootprint, x: number, z: number): boolean {
  const ry = f.ry ?? 0;
  const dx = x - f.x;
  const dz = z - f.z;
  const lx = Math.cos(ry) * dx - Math.sin(ry) * dz;
  const lz = Math.sin(ry) * dx + Math.cos(ry) * dz;
  return Math.abs(lx) < f.hw && Math.abs(lz) < f.hd;
}

function segmentArenaWallEntry(
  f: ArenaWallFootprint,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  if (pointInsideArenaWall(f, ax, az)) return 0;
  const ry = f.ry ?? 0;
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const adx = ax - f.x;
  const adz = az - f.z;
  const bdx = bx - f.x;
  const bdz = bz - f.z;
  const lax = c * adx - s * adz;
  const laz = s * adx + c * adz;
  const lbx = c * bdx - s * bdz;
  const lbz = s * bdx + c * bdz;
  const dx = lbx - lax;
  const dz = lbz - laz;
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lax < -f.hw || lax > f.hw) return Infinity;
  } else {
    let t1 = (-f.hw - lax) / dx;
    let t2 = (f.hw - lax) / dx;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dz) < 1e-9) {
    if (laz < -f.hd || laz > f.hd) return Infinity;
  } else {
    let t1 = (-f.hd - laz) / dz;
    let t2 = (f.hd - laz) / dz;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin;
}

export function arenaWallSegmentHits(
  f: ArenaWallFootprint,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  camX: number,
  camY: number,
  camZ: number,
): boolean {
  if (
    (eyeY < f.topY && pointInsideArenaWall(f, eyeX, eyeZ)) ||
    (camY < f.topY && pointInsideArenaWall(f, camX, camZ))
  ) {
    return true;
  }
  const t = segmentArenaWallEntry(f, eyeX, eyeZ, camX, camZ);
  if (t < 0 || t > 1) return false;
  return eyeY + (camY - eyeY) * t < f.topY;
}
