// The Smith's Heart's cliff faces' vertex paint (phase 2C): in the Hammer
// vein, the field's own cliffs (the gallery's drops, the pit's skirts, the
// Slab stair's sides) take the quarry's cool granite, mid grey with warm and
// cool beds drifting through it and a shallow darkening with depth (never the
// near-black basalt the rest of the main map's storm faces use: the painted
// world's shadows lean blue-violet, never black). Elsewhere the shared
// cliff tint is kept until each vein's own phase.
//
// Three-free, DOM-free, deterministic.

import { smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import type { FieldCliffRun } from '../../sim/instances/authored_field';
import { cliffColor, fieldNoise, type Rgb } from '../authored_field/field_mesh_core';
import { heatCliffPaint, inHeatSoot } from './heat_soot_core';
import { inQuenchFrost, quenchCliffPaint } from './quench_frost_core';

/** The quarry granite's beds: a cool grey and a warm grey (sRGB-ish linear
 *  vertex colours, multiplied into the strata texture). Phase 2D lifted them
 *  to a true mid grey: the strata texture's dark grooves multiply in, and at
 *  2C's values the faces read as near-black with orange flecks (the
 *  descent's foreground rock most of all). */
export const HAMMER_CLIFF_COOL: Rgb = [0.46, 0.46, 0.51];
export const HAMMER_CLIFF_WARM: Rgb = [0.53, 0.48, 0.46];
/** The darkest a Hammer face gets with depth (a share of its lit tone). */
export const HAMMER_CLIFF_FLOOR = 0.5;

/** The Hammer vein's mountain rock (phase 2D): the shared mountain's tint is
 *  pulled toward this mid granite grey and lifted, so the fissure's walls
 *  read as rock in their cool shadow, never a near-black navy. */
export const HAMMER_ROCK_TONE = 0x6b6a70;
/** How far the tint moves toward HAMMER_ROCK_TONE, and the gain on top. */
export const HAMMER_ROCK_MIX = 0.5;
export const HAMMER_ROCK_GAIN = 1.08;
/** How far round a point the lift samples the area (yards): the edge of the
 *  vein fades over about this distance instead of stepping at the line. */
export const HAMMER_ROCK_BLEND = 24;

/** The share (0 to 1) of the Hammer vein's lift at (x, z): the fraction of
 *  nine samples (the point and eight round it) that fall in the vein. */
export function hammerRockLift(x: number, z: number): number {
  let n = smithHeartAreaAt(x, z) === 'hammer' ? 1 : 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (
      smithHeartAreaAt(x + Math.cos(a) * HAMMER_ROCK_BLEND, z + Math.sin(a) * HAMMER_ROCK_BLEND) ===
      'hammer'
    )
      n++;
  }
  return n / 9;
}

/** The Hammer granite's bedding at height y (a gain, about -0.3 to +0.25):
 *  level beds of uneven thickness with crisp partings, warped a little
 *  across the vein so no bed runs dead level for long, a dark parting at the
 *  foot of every few beds. Strong enough to read in full sun (the slope's
 *  lit facets washed a gentler banding out). */
export function hammerRockBed(x: number, y: number, z: number): number {
  const warp = fieldNoise(x * 0.02, z * 0.02, 2) * 5;
  const u = (y + warp) * 0.42;
  const bed = Math.sin(u) + 0.45 * Math.sin(u * 2.3 + 1.9);
  // Squared toward its sign: a bed is a band, not a gradient.
  const band = Math.sign(bed) * Math.min(1, Math.abs(bed) * 1.8);
  const parting = Math.abs(Math.sin(u * 0.5 + 0.7)) < 0.12 ? -0.18 : 0;
  return 0.2 * band + parting;
}

/** How much darker a Hammer mountain face is for its steepness (rise over
 *  run): ledges and gentle slopes keep their tone, sheer risers lose up to
 *  a third of it. */
export function hammerRiserShade(steep: number): number {
  const t = Math.max(0, Math.min(1, (steep - 0.8) / 2.2));
  return 0.32 * t * t * (3 - 2 * t);
}

/** The paint of a cliff face at (x, y, z) under a lip at height `top`. */
export function heartCliffPaint(
  run: FieldCliffRun,
  x: number,
  y: number,
  z: number,
  top: number,
): Rgb {
  // The Quench's frost granite (phase 2H), snow along its lips.
  if (inQuenchFrost(x, z)) return quenchCliffPaint(x, y, z, top);
  // The Heat's columnar basalt (phase 2I), ash along its lips.
  if (inHeatSoot(x, z)) return heatCliffPaint(x, y, z, top);
  if (smithHeartAreaAt(x, z) !== 'hammer') return cliffColor(run, x, y, z, top);
  const depth = Math.max(0, top - y);
  const bed = 0.5 + 0.5 * Math.sin(y * 0.9 + fieldNoise(x * 0.05, z * 0.05, 2) * 5);
  const n = fieldNoise(x * 0.25 + y * 0.15, z * 0.25 - y * 0.1, 3);
  const dark = Math.max(HAMMER_CLIFF_FLOOR, 1 - depth / 60);
  const k = (0.78 + n * 0.32) * dark;
  return [
    (HAMMER_CLIFF_COOL[0] + (HAMMER_CLIFF_WARM[0] - HAMMER_CLIFF_COOL[0]) * bed) * k,
    (HAMMER_CLIFF_COOL[1] + (HAMMER_CLIFF_WARM[1] - HAMMER_CLIFF_COOL[1]) * bed) * k,
    (HAMMER_CLIFF_COOL[2] + (HAMMER_CLIFF_WARM[2] - HAMMER_CLIFF_COOL[2]) * bed) * k,
  ];
}
