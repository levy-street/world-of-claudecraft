// The Breath vein's storm granite (the AAA pass of 2026-11-04, the audit's
// points 3 and 4: the Breath's mouth and its link read as a flat brown wall
// and walls of unpainted grey triangles): the field's cliff faces and the
// mountain mass round the Breath painted as wind-scoured slate. A cool
// blue-grey stone in thin slanting beds carved by the wind, pale where the
// gale scours its lips and ledges, its depth falling to a blue-violet
// shadow (the painted world's shadows lean blue-violet, never black, never
// a warm brown). Faded in from the Ring's mouth, out at the Quench.
//
// PURE: three-free, DOM-free, deterministic. Vertex paint only (no program).

import { inSmithHeartRoom, RING } from '../../sim/content/smith_heart_layout';
import { fieldNoise, type Rgb } from '../authored_field/field_mesh_core';

/** Where the storm granite holds (instance-local yards): from the Ring's
 *  mouth north (z), out to the Quench's side (x), and never on the Ring's own
 *  approved walls (past its outer rim by `ring0` to `ring1`). */
export const BREATH_STONE = { z0: 74, z1: 92, x0: 74, x1: 96, ring0: 4, ring1: 16 } as const;

/** The stone's values (sRGB-ish linear vertex colour, multiplied into the
 *  field's strata texture): its shadow, its body, its scoured lips. */
export const BREATH_CLIFF_DEEP: Rgb = [0.33, 0.35, 0.45];
export const BREATH_CLIFF_SLATE: Rgb = [0.5, 0.53, 0.6];
export const BREATH_CLIFF_PALE: Rgb = [0.72, 0.73, 0.77];

/** The mountain mass's tint toward the slate, and its lift. */
export const BREATH_ROCK_TONE = 0x6f7787;
export const BREATH_ROCK_MIX = 0.6;
export const BREATH_ROCK_GAIN = 1.15;

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** How much of the Breath's storm granite holds at (x, z) (0..1). */
export function breathStoneWeight(x: number, z: number): number {
  if (inSmithHeartRoom(x, z)) return 0;
  const B = BREATH_STONE;
  const ring = Math.hypot(x - RING.x, z - RING.z) - RING.outerR;
  return smooth(B.z0, B.z1, z) * (1 - smooth(B.x0, B.x1, x)) * smooth(B.ring0, B.ring1, ring);
}

/** Is (x, z) the Breath's stone (the cliff paint's switch)? */
export function inBreathStone(x: number, z: number): boolean {
  return breathStoneWeight(x, z) > 0.5;
}

/** The wind's carving at height y (a gain about -0.25 to +0.2): thin beds
 *  slanting with the gale (they climb toward the east), a crisp dark groove
 *  every few, warped so none runs ruler straight. */
export function breathStoneBed(x: number, y: number, z: number): number {
  const warp = fieldNoise(x * 0.03, z * 0.03, 2) * 4;
  const u = (y + x * 0.08 + warp) * 0.75;
  const bed = Math.sin(u) + 0.4 * Math.sin(u * 2.2 + 1.3);
  const band = Math.sign(bed) * Math.min(1, Math.abs(bed) * 1.6);
  const groove = Math.abs(Math.sin(u * 0.5 + 0.4)) < 0.1 ? -0.16 : 0;
  return 0.16 * band + groove;
}

function mix3(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The paint of a Breath cliff face at (x, y, z) under a lip at height `top`. */
export function breathCliffPaint(x: number, y: number, z: number, top: number): Rgb {
  const depth = Math.max(0, top - y);
  const n = fieldNoise(x * 0.2 + y * 0.1, z * 0.2 - y * 0.1, 3);
  const k = (1 + breathStoneBed(x, y, z)) * (0.86 + 0.26 * n);
  // The body: slate in its beds, a paler bed now and then.
  const pale = Math.min(1, Math.max(0, breathStoneBed(x, y + 1.7, z)) * 2.2);
  const b = mix3(BREATH_CLIFF_SLATE, BREATH_CLIFF_PALE, pale * 0.5);
  // Its structure, so a tall face never reads as one pane: broad value groups
  // (a lit buttress, a shadowed recess) and irregular vertical joints.
  const along = x * 0.7 + z * 0.7;
  const group = fieldNoise(along * 0.045, y * 0.03, 2);
  const jw = fieldNoise(along * 0.11, y * 0.02, 2) * 3.2;
  const joint = Math.abs(Math.sin((along + jw) * 0.62)) < 0.07 ? 0.72 : 1;
  const g = (0.78 + 0.42 * group) * joint;
  const body: Rgb = [b[0] * k * g, b[1] * k * g, b[2] * k * g];
  // Its depth falls to the blue-violet shadow, never black.
  const c = mix3(body, BREATH_CLIFF_DEEP, smooth(0, 70, depth) * 0.7);
  // The lip scoured pale by the gale, ragged.
  const rim = Math.max(0, 1 - (depth - fieldNoise(x * 0.3, z * 0.3, 2) * 1.4) / 1.8);
  return mix3(c, BREATH_CLIFF_PALE, Math.min(1, rim) * 0.7);
}
