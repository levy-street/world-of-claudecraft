// Where an authored field surface's rock skirt may be drawn: only along the
// stretch of its outline where the surface still OWNS the ground just inside.
//
// The sim gives a point to the LAST surface that contains it, and the tops are
// drawn clipped to what each surface owns (field_clip_core.ts). The skirt used
// to be dropped along a surface's WHOLE outline, so where a later surface runs
// across that outline (a stair cut down through a terrace's lip, a lake shelf
// laid over a shore's inner edge) a wall stood across ground the later surface
// owns, a wall with no collider behind it that a body walks straight through
// (the Gravewyrm Sanctum's vault exit and lake stair, playtest 2026-10-03).
// The later surface draws its own sides there (its risers, its own skirt), so
// the earlier skirt is simply left out along that stretch.
//
// Three-free, DOM-free, deterministic.

import { type AuthoredFieldDef, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';

/** How far inside the outline the owner is probed (yards). */
const OWNER_PROBE = 0.05;
/** Half the gap left at an ownership change (yards): the skirt ends this
 *  close to where the later surface's ground begins. */
const BOUNDARY_GAP = 0.002;

/** A closed ring refined at every change of owner along it, with a flag per
 *  point: true where the surface owns the ground just inside its outline. */
export interface OwnedSkirtRing {
  ring: [number, number][];
  owned: boolean[];
}

/** Does surface `index` own the ground just inside its outline at (x, z),
 *  given the outline's OUTWARD normal (nx, nz)? A later surface (the sim's
 *  winner) takes it; a hidden one (a bridge drawn by its gate) never does. */
export function skirtOwned(
  def: AuthoredFieldDef,
  index: number,
  x: number,
  z: number,
  nx: number,
  nz: number,
): boolean {
  const s = def.surfaces[index];
  const at = authoredFieldSurfaceAt(def, x - nx * OWNER_PROBE, z - nz * OWNER_PROBE);
  if (!at || at === s || at.hidden) return true;
  return def.surfaces.indexOf(at) < index;
}

/**
 * Split a counter-clockwise outline ring (positive shoelace in x, z) where its
 * owner changes, so a skirt can stop exactly at the edge of the ground a later
 * surface takes over. Each change becomes a pair of points a hair either side
 * of it (found by bisection along the edge); every point carries its flag.
 */
export function ownedSkirtRing(
  def: AuthoredFieldDef,
  index: number,
  ring: readonly (readonly [number, number])[],
): OwnedSkirtRing {
  const out: [number, number][] = [];
  const owned: boolean[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    // The edge's outward normal (a CCW ring: the edge direction turned right).
    const nx = len > 0 ? (bz - az) / len : 0;
    const nz = len > 0 ? -(bx - ax) / len : 0;
    const oa = skirtOwned(def, index, ax, az, nx, nz);
    out.push([ax, az]);
    owned.push(oa);
    if (len <= 0) continue;
    const ob = skirtOwned(def, index, bx, bz, nx, nz);
    if (oa === ob) continue;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const om = skirtOwned(def, index, ax + (bx - ax) * mid, az + (bz - az) * mid, nx, nz);
      if (om === oa) lo = mid;
      else hi = mid;
    }
    const gap = BOUNDARY_GAP / len;
    const t0 = Math.max(lo - gap, 0);
    const t1 = Math.min(hi + gap, 1);
    if (t0 > 0) {
      out.push([ax + (bx - ax) * t0, az + (bz - az) * t0]);
      owned.push(oa);
    }
    if (t1 < 1) {
      out.push([ax + (bx - ax) * t1, az + (bz - az) * t1]);
      owned.push(ob);
    }
  }
  return { ring: out, owned };
}
