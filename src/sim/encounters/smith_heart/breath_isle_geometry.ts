// The Islands of the Wind's geometry (design doc 7.2), pure over the layout
// and the authored field: where each isle's Gale Path stands on the Cornice,
// where a ride sets a body down (on the isle, back home), the Homeward
// Gale's spot, where the adds rise, and the ride's FIXED arc (scripted, never
// physics: every host draws the same curve from the same seconds).
// Instance-local yards. No SimContext, no rng, so the renderer and the bots
// read the very same spots.

import { isIsleFloorOf } from '../../content/smith_heart_isle_floor';
import { BREATH, BREATH_ISLES, SMITH_HEART_FIELD } from '../../content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../instances/authored_field';
import { inBreathArena } from './breath_geometry';
import { ISLE_TUNING as T } from './breath_isle_ids';

const C = BREATH.cornice;

export interface IsleSpots {
  /** The isle's middle and floor height. */
  x: number;
  z: number;
  h: number;
  r: number;
  /** The Gale Path on the Cornice (inside the rim, toward the isle). */
  path: { x: number; z: number };
  /** Where a ride out sets a body down on the isle. */
  land: { x: number; z: number };
  /** The Homeward Gale on the isle (its near edge). */
  home: { x: number; z: number };
  /** Where a ride home sets a body down (beside the Gale Path, off it). */
  back: { x: number; z: number };
  /** Where the adds rise (the isle's far half). */
  adds: readonly { x: number; z: number }[];
}

function build(i: number): IsleSpots {
  const isle = BREATH_ISLES[i];
  const dx = isle.x - C.x;
  const dz = isle.z - C.z;
  const d = Math.hypot(dx, dz);
  const ux = dx / d;
  const uz = dz / d;
  // The rim on the line to the isle: the last spot of the Cornice's floor.
  let rim = 0;
  for (let t = 0; t <= d; t += 0.5) {
    if (!inBreathArena(C.x + ux * t, C.z + uz * t)) break;
    rim = t;
  }
  const pathAt = rim - T.pathInset;
  const path = { x: C.x + ux * pathAt, z: C.z + uz * pathAt };
  // Home beside the path, a quarter turn off the line, clear of its circle.
  const back = { x: path.x - uz * 5, z: path.z + ux * 5 };
  const land = { x: isle.x - ux * (isle.r * 0.35), z: isle.z - uz * (isle.r * 0.35) };
  const home = { x: isle.x - ux * (isle.r - 3.2), z: isle.z - uz * (isle.r - 3.2) };
  const adds = [
    { x: isle.x + ux * 3 - uz * 2.6, z: isle.z + uz * 3 + ux * 2.6 },
    { x: isle.x + ux * 3 + uz * 2.6, z: isle.z + uz * 3 - ux * 2.6 },
  ];
  return { x: isle.x, z: isle.z, h: isle.h, r: isle.r, path, land, home, back, adds };
}

let cache: IsleSpots[] | null = null;

/** Every isle's spots, in BREATH_ISLES order (built once). */
export function isleSpots(): readonly IsleSpots[] {
  if (!cache) cache = BREATH_ISLES.map((_, i) => build(i));
  return cache;
}

/** The isle whose floor (x, z) stands on (its outline or a ledge), or -1. */
export function isleAt(x: number, z: number): number {
  const id = authoredFieldSurfaceAt(SMITH_HEART_FIELD, x, z)?.id;
  if (!id) return -1;
  return BREATH_ISLES.findIndex((b) => isIsleFloorOf(id, b.id));
}

/** A ride's arc: from `a` to `b` (instance-local, y the floor height at
 *  each end) at `k` (0 to 1) of its seconds: eased along the ground, lifted
 *  on a parabola `apex` yards over the higher end. Pure, the same on every
 *  host. */
export function rideArc(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  k: number,
  apex: number = T.rideApex,
): { x: number; y: number; z: number } {
  const t = Math.max(0, Math.min(1, k));
  // Ease in and out along the ground (a slow lift, a fast glide, a soft set
  // down), a little quicker off the ground than onto it.
  const e = t * t * (3 - 2 * t);
  const y0 = a.y + (b.y - a.y) * e;
  const lift = Math.max(a.y, b.y) - y0 + apex;
  return {
    x: a.x + (b.x - a.x) * e,
    y: y0 + lift * 4 * t * (1 - t),
    z: a.z + (b.z - a.z) * e,
  };
}
