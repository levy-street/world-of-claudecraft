// The Slope tool's ramp: right-click the ground to set the START (a point and
// its height), then press anywhere else and drag. The press point and the
// ground height under it are the END, and the stroke levels the ground toward
// the straight ramp between the two, so a path climbs smoothly from one height
// to the other. Pure (no DOM, no Three) so Vitest imports it directly.
//
// Each stamp is an ordinary LEVEL HeightStamp whose target is a tilted plane
// (HeightStamp.gx/gz, the same field Smooth uses): the ramp height at the
// stamp centre plus the ramp's gradient. Past either end the ramp holds that
// end's height, so painting beyond the end point lays a flat landing instead
// of extending the climb. A stamp centred just inside an end still tilts
// across its own footprint, so the incline can run on for up to one brush
// radius before the landing takes over.

import type { HeightStamp } from '../sim/types';

/** A ramp end: a ground point and the height the ramp reaches there. */
export interface SlopePoint {
  x: number;
  z: number;
  y: number;
}

export interface SlopeRamp {
  start: SlopePoint;
  end: SlopePoint;
}

/** Closer than this (yards) the two ends are one point and the ramp is flat. */
const MIN_RAMP_LENGTH = 0.5;
/** The steepest grade a saved stamp keeps (sim/map_doc.ts sanitizeStamp clamps
 *  gx/gz to this), so a live ramp never differs from its reloaded twin. */
export const MAX_SLOPE_GRADE = 20;
/** The furthest a ramp height may sit from zero: a level stamp's stored
 *  target is clamped to the same range on save. */
const MAX_RAMP_HEIGHT = 200;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Where (x, z) falls along the ramp: 0 at the start, 1 at the end, clamped.
 *  A ramp shorter than MIN_RAMP_LENGTH reads 0 everywhere (flat at the start). */
export function slopeProgress(ramp: SlopeRamp, x: number, z: number): number {
  const ax = ramp.end.x - ramp.start.x;
  const az = ramp.end.z - ramp.start.z;
  const len2 = ax * ax + az * az;
  if (!(len2 >= MIN_RAMP_LENGTH * MIN_RAMP_LENGTH)) return 0;
  return clamp(((x - ramp.start.x) * ax + (z - ramp.start.z) * az) / len2, 0, 1);
}

/** The ramp height at (x, z). */
export function slopeHeightAt(ramp: SlopeRamp, x: number, z: number): number {
  const t = slopeProgress(ramp, x, z);
  return clamp(ramp.start.y + (ramp.end.y - ramp.start.y) * t, -MAX_RAMP_HEIGHT, MAX_RAMP_HEIGHT);
}

/** The ramp's gradient (yards of height per yard along x and z), clamped to
 *  the grade a saved stamp keeps. Zero for a degenerate ramp. */
export function slopeGradient(ramp: SlopeRamp): { gx: number; gz: number } {
  const ax = ramp.end.x - ramp.start.x;
  const az = ramp.end.z - ramp.start.z;
  const len2 = ax * ax + az * az;
  if (!(len2 >= MIN_RAMP_LENGTH * MIN_RAMP_LENGTH)) return { gx: 0, gz: 0 };
  const rise = (ramp.end.y - ramp.start.y) / len2;
  return {
    gx: clamp(ax * rise, -MAX_SLOPE_GRADE, MAX_SLOPE_GRADE),
    gz: clamp(az * rise, -MAX_SLOPE_GRADE, MAX_SLOPE_GRADE),
  };
}

/**
 * One Slope stamp at (x, z): levels toward the ramp plane. Inside the ramp the
 * target carries the ramp's gradient so the whole brush follows the incline;
 * at or past an end the target is that end's flat height. `strength` (0..1) is
 * how far toward the target one stamp pulls, like Flatten's per-stamp easing.
 */
export function slopeStamp(
  x: number,
  z: number,
  radius: number,
  ramp: SlopeRamp,
  strength: number,
  hardEdge: boolean,
): HeightStamp {
  const t = slopeProgress(ramp, x, z);
  const stamp: HeightStamp = {
    x,
    z,
    radius,
    delta: slopeHeightAt(ramp, x, z),
    falloff: hardEdge ? 'flat' : 'smooth',
    mode: 'level',
    strength: clamp(strength, 0, 1),
  };
  if (t > 0 && t < 1) {
    const { gx, gz } = slopeGradient(ramp);
    if (gx !== 0) stamp.gx = gx;
    if (gz !== 0) stamp.gz = gz;
  }
  return stamp;
}
