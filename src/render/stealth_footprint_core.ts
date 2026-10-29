// Stealth Rework footprints: the pure placement half of the ground prints
// (stealth_footprint_visual.ts is the Three painter). A print's age picks one
// of FOOTPRINT_FADE_BUCKETS fade steps (newest darkest, linear across the
// readable window), and its foot offsets it to the left or right of the path.
// The prints are ACTIONABLE information (where an enemy stealther went), so
// the plan is identical on every graphics tier: no tier knob reads it.
//
// A print is drawn as a dent, not a stain: a shallow foot-shaped cup with a
// raised lip, shaded by the world sun. The decal itself stays flat on the
// ground (so it never sinks into the terrain or fights it); the dent lives in
// its normals, from footprintCraterNormalInto below, and the painter only
// darkens what faces away from the sun and lightens what faces it.

import {
  FOOTPRINT_LAG,
  FOOTPRINT_LIFETIME,
  type VisibleFootprint,
} from '../sim/stealth_footprints';

export const FOOTPRINT_FADE_BUCKETS = 4;
/** Opacity of each fade bucket, newest first: a subtle trail, readable by a
 *  player watching the ground rather than one that jumps out. */
export const FOOTPRINT_FADE_OPACITY: readonly number[] = [0.6, 0.46, 0.32, 0.18];
/** Yards each print sits to the side of the stealther's path. */
export const FOOTPRINT_SIDE_OFFSET = 0.3;
/** Half-width and half-length of one print, in yards. Larger than a real
 *  boot on purpose: the chase camera looks along the ground at a shallow
 *  pitch, which squashes a print's depth to a few pixels at 15 yd, so a
 *  life-size oval read as a sliver nobody could follow. */
export const FOOTPRINT_HALF_WIDTH = 0.28;
export const FOOTPRINT_HALF_LENGTH = 0.42;

export interface FootprintPlacement {
  x: number;
  z: number;
  /** Rotation about +Y that turns the print's long axis (+Z) to its facing. */
  yaw: number;
  bucket: number;
}

export function newFootprintPlacement(): FootprintPlacement {
  return { x: 0, z: 0, yaw: 0, bucket: 0 };
}

/** 0 = freshest readable print, FOOTPRINT_FADE_BUCKETS - 1 = about to vanish. */
export function footprintFadeBucket(age: number): number {
  const span = FOOTPRINT_LIFETIME - FOOTPRINT_LAG;
  const t = (age - FOOTPRINT_LAG) / span;
  if (!(t > 0)) return 0;
  return Math.min(FOOTPRINT_FADE_BUCKETS - 1, Math.floor(t * FOOTPRINT_FADE_BUCKETS));
}

/** Fill `out` for one print: forward is (sin f, cos f) and right is
 *  (-cos f, sin f) in the world's x/z (the movement kernel's axes,
 *  sim/player_motion.ts), so the left foot steps to -right, the right to +right. */
export function footprintPlacementInto(
  out: FootprintPlacement,
  print: VisibleFootprint,
): FootprintPlacement {
  const side = print.foot === 1 ? FOOTPRINT_SIDE_OFFSET : -FOOTPRINT_SIDE_OFFSET;
  out.x = print.x - Math.cos(print.facing) * side;
  out.z = print.z + Math.sin(print.facing) * side;
  out.yaw = print.facing;
  out.bucket = footprintFadeBucket(print.age);
  return out;
}

/** Depth of the cup, height of the lip, and where the cup ends (as a fraction
 *  of the print's radius), all in yards except the last. */
export const FOOTPRINT_CUP_DEPTH = 0.05;
export const FOOTPRINT_RIM_HEIGHT = 0.02;
export const FOOTPRINT_CUP_RADIUS = 0.72;

/** Height of the dent at normalized radius `r` (0 centre, 1 edge): a bowl
 *  down to the cup radius, then a lip that rises and settles back to flat. */
export function footprintCraterHeight(r: number): number {
  if (r < FOOTPRINT_CUP_RADIUS) {
    const k = r / FOOTPRINT_CUP_RADIUS;
    return -FOOTPRINT_CUP_DEPTH * (1 - k * k);
  }
  if (r >= 1) return 0;
  return (
    FOOTPRINT_RIM_HEIGHT *
    Math.sin((Math.PI * (r - FOOTPRINT_CUP_RADIUS)) / (1 - FOOTPRINT_CUP_RADIUS))
  );
}

/** dHeight/dr of footprintCraterHeight. */
function craterSlope(r: number): number {
  if (r < FOOTPRINT_CUP_RADIUS) {
    return (2 * FOOTPRINT_CUP_DEPTH * r) / (FOOTPRINT_CUP_RADIUS * FOOTPRINT_CUP_RADIUS);
  }
  if (r >= 1) return 0;
  const span = 1 - FOOTPRINT_CUP_RADIUS;
  return (
    ((FOOTPRINT_RIM_HEIGHT * Math.PI) / span) *
    Math.cos((Math.PI * (r - FOOTPRINT_CUP_RADIUS)) / span)
  );
}

/** The dent's unit normal at a point of the print, in the print's own frame
 *  (x across, z along, +y up). `u`/`v` are the point over the half-width and
 *  half-length, so (u, v) on the unit circle is the print's edge. Flat (0,1,0)
 *  at the centre and outside the print. */
export function footprintCraterNormalInto(
  out: { x: number; y: number; z: number },
  u: number,
  v: number,
): { x: number; y: number; z: number } {
  const r = Math.hypot(u, v);
  if (r < 1e-6 || r >= 1) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    return out;
  }
  const slope = craterSlope(r);
  const gx = (slope * (u / r)) / FOOTPRINT_HALF_WIDTH;
  const gz = (slope * (v / r)) / FOOTPRINT_HALF_LENGTH;
  const len = Math.hypot(gx, 1, gz);
  out.x = -gx / len;
  out.y = 1 / len;
  out.z = -gz / len;
  return out;
}
