// The Guardian of the Heat's lip clip: every mark the fight lays on the
// Hearth's floor (the telegraphs, the seeds' field, the Wheel's slices,
// Wakefire's bands, the patches, the lava waves' foot and fire, the swells'
// wakes, the craters) stops at the lip wall's outer face (Jose's playtest of
// 2026-11-24: the spread circles and the waves' fire bled over the boss's
// disc). Nothing a player can stand on lies inside the wall (the sim's
// colliders, smith_heart_layout.ts HEARTH_LIP_WALLS), so the clip never hides
// a square yard that can hurt anyone: what is drawn and what strikes agree.
//
// The same varying is the floor shaders' precise local frame. The Hearth
// stands a hundred thousand yards out, where a float32 world coordinate is
// good to a hundredth of a yard and interpolating one per pixel shimmers as
// the camera moves; noise sampled on it crawled (the floor's flicker under
// the safe zones). `vLipL` is the world point minus the wellspring's middle,
// taken per vertex (two nearby float32 values subtract exactly) and
// interpolated small, so it is steady to the pixel.
//
// One uniform object shared by every Heat floor material (one Hearth is drawn
// at a time); HeatWellFx sets it where it lays the pool, and clears the clip
// (radius 0) when the pool goes. Its value is a plain {x, y, z} (three uploads
// a vec3 from any such object), so this module stays Three-free: the GLSL is
// strings, the test is the pure twin.

import { HEAT_LIP_WALL } from '../../sim/encounters/smith_heart/heat_ids';

/** The clip's radius (yards from the well's middle): the wall's outer face,
 *  a hand under it so a mark's edge tucks beneath the stumps. */
export const HEAT_LIP_CLIP_R = HEAT_LIP_WALL.outer - 0.2;

/** The clip as the shaders read it: world x (`x`), world z (`y`), radius
 *  (`z`; 0: no clip). */
export interface HeatLipClip {
  x: number;
  y: number;
  z: number;
}

/** The one uniform every Heat floor material shares. */
export const heatLipClipUniform: { value: HeatLipClip } = { value: { x: 0, y: 0, z: 0 } };

/** Lay the clip round the wellspring's middle at world (x, z). */
export function placeHeatLipClip(x: number, z: number): void {
  const v = heatLipClipUniform.value;
  v.x = x;
  v.y = z;
  v.z = HEAT_LIP_CLIP_R;
}

/** No clip (the frame stays where it was laid). */
export function clearHeatLipClip(): void {
  heatLipClipUniform.value.z = 0;
}

/** The shader's test (its pure twin): is world (x, z) under the clip? */
export function heatLipClipped(x: number, z: number, clip: HeatLipClip): boolean {
  return clip.z > 0 && Math.hypot(x - clip.x, z - clip.y) < clip.z;
}

/** Vertex: `heatLipLocal(world)` writes `vLipL`. Splice at global scope. */
export const HEAT_LIP_VERT_GLSL = /* glsl */ `
#ifndef HEAT_LIP_VERT
#define HEAT_LIP_VERT
uniform vec3 uLipClip;
varying vec2 vLipL;
void heatLipLocal(vec3 world) { vLipL = world.xz - uLipClip.xy; }
#endif
`;

/** Fragment: `heatLipClipped()`, and `vLipL` the precise local frame. */
export const HEAT_LIP_FRAG_GLSL = /* glsl */ `
#ifndef HEAT_LIP_FRAG
#define HEAT_LIP_FRAG
uniform vec3 uLipClip;
varying vec2 vLipL;
bool heatLipClipped() { return uLipClip.z > 0.0 && dot(vLipL, vLipL) < uLipClip.z * uLipClip.z; }
#endif
`;
