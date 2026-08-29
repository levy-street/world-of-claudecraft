// The dungeon arena walls' camera-occluder fade, lifted out of dungeon.ts: the
// wall footprints, the eye-to-camera hit test, and the per-frame step every
// arena hideable takes through the shared gated fade (occluder_fade.ts).
import type * as THREE from 'three';
import {
  advanceOccluderFade,
  type OccluderFadeMat,
  prefetchOccluderFadeWithin,
} from './occluder_fade';

export interface ArenaWallFootprint {
  x: number;
  z: number;
  hw: number;
  hd: number;
  topY: number;
}

export interface ArenaHideable {
  group: THREE.Group;
  mats: OccluderFadeMat[];
  hidden: boolean;
  alpha: number;
  footprint: ArenaWallFootprint;
}

function pointInsideArenaWall(f: ArenaWallFootprint, x: number, z: number): boolean {
  return Math.abs(x - f.x) < f.hw && Math.abs(z - f.z) < f.hd;
}

function segmentArenaWallEntry(
  f: ArenaWallFootprint,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  if (pointInsideArenaWall(f, ax, az)) return 0;
  const lax = ax - f.x;
  const laz = az - f.z;
  const lbx = bx - f.x;
  const lbz = bz - f.z;
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

/** One frame of every arena wall's fade: prefetch within reach, hit-test the
 *  eye-to-camera segment, and step the gated fade. */
export function advanceArenaWallFades(
  hideables: readonly ArenaHideable[],
  camX: number,
  camY: number,
  camZ: number,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  dt: number,
  reducedMotion: boolean,
): void {
  for (const h of hideables) {
    prefetchOccluderFadeWithin(h.mats, h.footprint.x, h.footprint.z, camX, camZ);
    const hide = arenaWallSegmentHits(h.footprint, eyeX, eyeY, eyeZ, camX, camY, camZ);
    h.hidden = hide;
    h.alpha = advanceOccluderFade(h.mats, h.alpha, hide, dt, reducedMotion);
  }
}
