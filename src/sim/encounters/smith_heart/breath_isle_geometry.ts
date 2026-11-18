// The Islands of the Wind's geometry (design doc 7.2, the 50 percent phase),
// pure over the layout and the authored field: each side's Updraft on the
// Cornice, where a ride sets a body down on each isle, each isle's Updraft on
// to the next, where its adds rise and its Stillstone stands, where the ride
// home sets a body down, and the ride's FIXED arc (scripted, never physics:
// every host draws the same curve from the same seconds). Instance-local
// yards. No SimContext, no rng, so the renderer and the bots read the very
// same spots.

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
  side: 0 | 1;
  step: number;
  /** Where a ride from the step before (the Cornice or an isle) sets a
   *  body down. */
  land: { x: number; z: number };
  /** The Updraft on to the next isle (the last isle: null). */
  pad: { x: number; z: number } | null;
  /** Where the adds rise (the isle's far half). */
  adds: readonly { x: number; z: number }[];
  /** The Stillstone's spot (the last isle of each side), or null. */
  stone: { x: number; z: number } | null;
  /** Where the ride home sets a body down on the Cornice. */
  back: { x: number; z: number };
}

/** The isle's floor along the unit (ux, uz) from its middle: the last
 *  half-yard on its floor (yards). */
export function isleReach(i: number, ux: number, uz: number): number {
  const isle = BREATH_ISLES[i];
  let rim = 0;
  for (let t = 0; t <= 30; t += 0.5) {
    if (isleAt(isle.x + ux * t, isle.z + uz * t) !== i) break;
    rim = t;
  }
  return rim;
}

/** Does a disc of `r` yards round (x, z) lie wholly on isle `i`'s floor? */
function discOnIsle(i: number, x: number, z: number, r: number): boolean {
  if (isleAt(x, z) !== i) return false;
  for (let k = 0; k < 36; k++) {
    const a = (k / 36) * Math.PI * 2;
    if (isleAt(x + Math.sin(a) * r, z + Math.cos(a) * r) !== i) return false;
  }
  return true;
}

/** (x, z) drawn toward isle `i`'s middle until a disc of `r` round it lies
 *  on its floor (the middle at worst). */
function inward(i: number, x: number, z: number, r: number): { x: number; z: number } {
  const isle = BREATH_ISLES[i];
  const d = Math.hypot(x - isle.x, z - isle.z);
  for (let t = d; t > 0; t -= 0.5) {
    const k = t / (d || 1);
    const px = isle.x + (x - isle.x) * k;
    const pz = isle.z + (z - isle.z) * k;
    if (discOnIsle(i, px, pz, r)) return { x: px, z: pz };
  }
  return { x: isle.x, z: isle.z };
}

/** The Cornice's floor along the unit from its middle: its last half-yard. */
function corniceReach(ux: number, uz: number): number {
  let rim = 0;
  for (let t = 0; t <= 80; t += 0.5) {
    if (!inBreathArena(C.x + ux * t, C.z + uz * t)) break;
    rim = t;
  }
  return rim;
}

function unit(ax: number, az: number, bx: number, bz: number): { ux: number; uz: number } {
  const d = Math.hypot(bx - ax, bz - az) || 1;
  return { ux: (bx - ax) / d, uz: (bz - az) / d };
}

/** Each side's Updraft on the Cornice (east, west): inside the rim on the
 *  line to its first isle. */
function cornicePad(side: 0 | 1): { x: number; z: number } {
  const first = BREATH_ISLES[side * 3];
  const { ux, uz } = unit(C.x, C.z, first.x, first.z);
  const at = corniceReach(ux, uz) - T.padInset;
  return { x: C.x + ux * at, z: C.z + uz * at };
}

let padCache: readonly { x: number; z: number }[] | null = null;

/** The two Updrafts Thessaly raises on the Cornice: [east, west]. */
export function cornicePads(): readonly { x: number; z: number }[] {
  if (!padCache) padCache = [cornicePad(0), cornicePad(1)];
  return padCache;
}

function build(i: number): IsleSpots {
  const isle = BREATH_ISLES[i];
  const side = isle.side;
  const step = isle.step;
  // The place a body comes from: the Cornice's pad, or the isle before.
  const prev = step === 0 ? cornicePads()[side] : BREATH_ISLES[i - 1];
  const fromPrev = unit(isle.x, isle.z, prev.x, prev.z);
  const landAt = isleReach(i, fromPrev.ux, fromPrev.uz) * 0.45;
  const land = { x: isle.x + fromPrev.ux * landAt, z: isle.z + fromPrev.uz * landAt };
  let pad: IsleSpots['pad'] = null;
  // The far side: away from where the riders come in.
  let fx = -fromPrev.ux;
  let fz = -fromPrev.uz;
  if (step < 2) {
    const next = BREATH_ISLES[i + 1];
    const to = unit(isle.x, isle.z, next.x, next.z);
    // As near the rim toward the next isle as a whole pad's disc (and a
    // half yard round it) stays on the floor.
    let at = isleReach(i, to.ux, to.uz) - T.padR;
    while (at > 0 && !discOnIsle(i, isle.x + to.ux * at, isle.z + to.uz * at, T.padR * 1.2 + 1))
      at -= 0.5;
    at = Math.max(0, at);
    pad = { x: isle.x + to.ux * at, z: isle.z + to.uz * at };
    // The adds stand off the line between the landing and the next pad.
    const m = unit(0, 0, -fromPrev.ux - to.ux, -fromPrev.uz - to.uz);
    if (Math.hypot(-fromPrev.ux - to.ux, -fromPrev.uz - to.uz) > 0.3) {
      fx = m.ux;
      fz = m.uz;
    }
  }
  const far = isleReach(i, fx, fz);
  // The last isle's adds stand on the middle's near side, clear of the
  // Stillstone on the far side (they never rise on top of it).
  const mid = step === 2 ? -Math.max(1.5, far * 0.15) : Math.max(2, far * 0.35);
  const px = -fz;
  const pz = fx;
  // Each drawn in toward the middle until a melee ring round it stays on
  // the floor (the bays bite deep).
  const adds = [
    inward(i, isle.x + fx * mid + px * 2.8, isle.z + fz * mid + pz * 2.8, 2.6),
    inward(i, isle.x + fx * mid - px * 2.8, isle.z + fz * mid - pz * 2.8, 2.6),
    inward(i, isle.x + fx * (mid + 2.5), isle.z + fz * (mid + 2.5), 2.6),
  ];
  const stone =
    step === 2 ? inward(i, isle.x + fx * far * 0.55, isle.z + fz * far * 0.55, 3) : null;
  // Home: beside the side's Cornice pad, a step toward the middle, fanned
  // by the isle so three groups never land on one spot.
  const cp = cornicePads()[side];
  const toMid = unit(cp.x, cp.z, C.x, C.z);
  const fan = (step - 1) * 3.2;
  const back = {
    x: cp.x + toMid.ux * 6 - toMid.uz * fan,
    z: cp.z + toMid.uz * 6 + toMid.ux * fan,
  };
  return { x: isle.x, z: isle.z, h: isle.h, r: isle.r, side, step, land, pad, adds, stone, back };
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

/** How far along the unit (ux, uz) from (x, z) a body may slide on isle `i`
 *  and still stand `margin` in from its rim (half-yard steps, at most
 *  `yards`). */
export function isleSafeReach(
  i: number,
  x: number,
  z: number,
  ux: number,
  uz: number,
  yards: number,
  margin: number,
): number {
  let ok = 0;
  for (let d = 0.5; d <= yards + 1e-9; d += 0.5) {
    const px = x + ux * d;
    const pz = z + uz * d;
    if (isleAt(px, pz) !== i) break;
    // The rim within `margin` along the line: stop short.
    if (isleAt(px + ux * margin, pz + uz * margin) !== i) break;
    ok = d;
  }
  return Math.min(ok, yards);
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
