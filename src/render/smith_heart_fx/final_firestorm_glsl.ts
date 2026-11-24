// Firestorm's trail and burnt floor in GLSL (final_firestorm_fx.ts; the plan
// final_firestorm_core.ts). The wall itself is line_fire_glsl.ts's (the Heat
// guardian's fire on a straight front); this file holds what is Firestorm's
// own:
//   FS_TRAIL_VERT   the low fire still burning down the lane behind the wall
//                   (baked on the floor once per lane), dying with distance;
//   FS_TRAIL_FLAME_VERT  soft flames (soft_flame_glsl.ts) standing down the
//                   burning lane, tall at the wall's heel, low far behind;
//   FS_FLOOR_VERT / FS_FLOOR_FRAG   the burnt lane on the floor: the molten
//                   seam at the wall's foot, the floor lit ahead, the burning
//                   char behind with its cracks, the crisp hot line on both
//                   edges (the danger edge), the char fading once it is out.
// Strings only.

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { FIRESTORM_LOOK as L } from './final_firestorm_core';
import { LINE_FIRE_COMMON } from './line_fire_glsl';
import { SOFT_FIRE_COMMON } from './soft_flame_glsl';

/** The trail's low fire: a strip baked along the lane on the floor
 *  (aBase: the floor point, aTrail: yards from the lane's start, seed),
 *  position.y 0..1 up. */
export const FS_TRAIL_VERT = /* glsl */ `
uniform float uFrontAlong;
uniform float uTrail;
uniform float uTrailH;
uniform float uTrailRun;
uniform float uTrailFloor;
uniform float uHeelH;
uniform float uHeelRun;
attribute vec3 aBase;
attribute vec2 aTrail;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
${LINE_FIRE_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  float v = position.y;
  float behind = uFrontAlong - aTrail.x;
  // Only the lane the wall has burnt (it starts a yard behind the heel).
  float lit = smoothstep(0.2, 1.6, behind) * smoothstep(-0.5, 2.0, aTrail.x);
  float k = clamp(behind / uTrailRun, 0.0, 1.0);
  // The same height as firestormTrailHeight (final_firestorm_core.ts).
  float h = (uTrailFloor + (uTrailH - uTrailFloor) * (1.0 - k) * (1.0 - k) + uHeelH * exp(-max(behind, 0.0) / uHeelRun)) * lit;
  float m = lit * uTrail * fsOnFloor(aBase.xz);
  vMask = m * (0.6 + 0.4 * (1.0 - k));
  vSeed = aTrail.y;
  vec3 w = aBase + vec3(0.0, -0.2 + v * (h + 0.2), 0.0);
  // A lick of sway, the tips trailing back.
  w.xz -= uDir * 0.35 * v * v * h;
  vUv = vec2(aTrail.x * 1.1 + aTrail.y * 13.0, v);
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

/** A soft flame down the burning lane (instanced cards): aFoot its point on
 *  the lane's centre line (baked once per lane), aT (yards from the lane's
 *  start, its share across -1..1, seed). Its height is the trail's (tall at
 *  the wall's heel, low far behind); its foot stays inside the lane by its
 *  own half width and behind the front. */
export const FS_TRAIL_FLAME_VERT = /* glsl */ `
uniform float uFrontAlong;
uniform float uTrail;
uniform float uTrailH;
uniform float uTrailRun;
uniform float uTrailFloor;
uniform float uHeelH;
uniform float uHeelRun;
attribute vec3 aFoot;
attribute vec3 aT;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHeat;
${LINE_FIRE_COMMON}
${SOFT_FIRE_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  float seed = aT.z;
  vSeed = seed;
  float period = 1.1 + 1.0 * fract(seed * 7.31);
  float ph0 = uTime / period + seed * 3.7;
  float cyc = floor(ph0);
  float ph = ph0 - cyc;
  float life = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.6, 1.0, ph));
  float along = aT.x + 1.2 * (sfHash(cyc + seed * 91.0) - 0.5);
  float behind = uFrontAlong - along;
  float lit = smoothstep(0.6, 1.8, behind) * step(0.0, along);
  float k = clamp(behind / uTrailRun, 0.0, 1.0);
  // The trail's height (firestormTrailHeight, final_firestorm_core.ts).
  float h = uTrailFloor + (uTrailH - uTrailFloor) * (1.0 - k) * (1.0 - k) + uHeelH * exp(-max(behind, 0.0) / uHeelRun);
  float tall = fract(seed * 13.7);
  float hMax = h * (0.55 + 0.6 * tall);
  float halfW = hMax * 0.42;
  vec2 side = fsSide();
  vec2 foot = aFoot.xz + uDir * (along - aT.x) + side * sign(aT.y) * min(abs(aT.y) * uHalf, max(0.0, uHalf - halfW * 0.7));
  vAlpha = lit * uTrail * life * fsOnFloor(foot) * (0.65 + 0.35 * (1.0 - k));
  vHeat = 0.75 + 0.25 * (1.0 - k);
  if (vAlpha <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = seed * 40.0;
  vec2 lean = -uDir * hMax * 0.25 + side * sin(uTime * 1.1 + s) * hMax * 0.08;
  vec3 w = sfFlameCard(vec3(foot.x, aFoot.y - 0.05, foot.y), hMax * (0.75 + 0.25 * life), halfW, lean, vec2(position.x * 2.0, vUv.y));
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

/** The burnt lane's floor, baked on the floor once per lane: position the
 *  floor point (world), aLane (across -1..1, yards from the lane's start). */
export const FS_FLOOR_VERT = /* glsl */ `
attribute vec2 aLane;
varying vec2 vLane;
varying vec3 vW;
${CAMERA_RELATIVE_GLSL}
void main() {
  vLane = aLane;
  vW = position;
  gl_Position = projectionMatrix * wocCamRelView(position);
}
`;

export const FS_FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFrontAlong;
uniform float uLength;
uniform float uHalf;
uniform float uLive;
uniform float uChar;
uniform float uBurn;
uniform vec3 uRoom;
uniform vec3 uEdge;
varying vec2 vLane;
varying vec3 vW;
float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), u.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ffbm(vec2 p) { return fn(p) * 0.55 + fn(p * 2.03 + 1.7) * 0.3 + fn(p * 4.01 + 3.1) * 0.15; }
vec3 burnRamp(float m) {
  vec3 c = mix(vec3(0.045, 0.034, 0.03), vec3(0.5, 0.08, 0.02), smoothstep(0.06, 0.36, m));
  c = mix(c, vec3(1.0, 0.42, 0.08), smoothstep(0.34, 0.68, m));
  return mix(c, vec3(1.0, 0.8, 0.42), smoothstep(0.74, 1.0, m));
}
void main() {
  float d = length(vW.xz - uRoom.xy);
  float onFloor = 1.0 - smoothstep(uRoom.z - 1.0, uRoom.z, d);
  if (onFloor < 0.01) discard;
  float along = vLane.y;
  float across = abs(vLane.x);
  // Nothing past the sim's lane: its half width across, its two ends along.
  if (across > 1.0 || along < 0.0 || along > uLength) discard;
  float yards = (1.0 - across) * uHalf;
  float ahead = along - uFrontAlong;
  float behind = -ahead;
  float burnt = step(0.0, behind) * smoothstep(-0.5, 0.8, along);
  vec2 q = vW.xz;
  // The molten seam at the wall's foot: churning, white-gold at its heart.
  float seam = burnt * (1.0 - smoothstep(0.3, ${L.seamBack.toFixed(2)}, behind)) * uBurn;
  float flow = ffbm(q * 0.7 + vec2(0.0, uTime * 0.9));
  // The burning char behind: ragged glowing cracks, flickering patches of
  // flame, cooling with distance but alight while the lane lives.
  vec2 w = vec2(fn(q * 0.35 + 3.7), fn(q * 0.35 + 9.1)) - 0.5;
  float ridge = 1.0 - abs(fn(q * 0.62 + w * 2.4) * 2.0 - 1.0);
  float crack = smoothstep(0.86, 0.97, ridge);
  float heat = exp(-behind / 26.0) * uLive + 0.18 * uLive;
  float flick = 0.6 + 0.4 * fn(q * 0.9 + vec2(uTime * 2.1, -uTime * 1.3));
  float flare = smoothstep(0.55, 0.85, ffbm(q * 0.45 + vec2(0.0, -uTime * 0.6))) * heat * flick;
  float m = max(seam * (0.62 + 0.38 * flow), burnt * max(crack * (0.25 + 0.6 * heat) * flick, flare * 0.7));
  vec3 col = burnRamp(clamp(m, 0.0, 1.0)) * 1.2;
  // Translucent enough that another floor warning under the burnt lane
  // still reads (graphics never hide a mark a player reacts to).
  float a = burnt * mix(0.5, 0.8, seam) * uChar;
  // Ahead: the floor lit by the fire coming (a warm wash, no hard line).
  float light = (1.0 - smoothstep(0.0, ${L.lightAhead.toFixed(2)}, ahead)) * step(0.0, ahead) * uBurn;
  light *= step(along, uLength + 0.5);
  col = mix(col, vec3(1.0, 0.52, 0.16) * 1.3, light * (1.0 - a));
  a = max(a, light * 0.38);
  // The danger edge: one crisp hot line on each side of the lane (the sim's
  // half width exactly), alight while the lane lives.
  float edge = (1.0 - smoothstep(0.0, 0.22, yards)) * uLive;
  float edgeGlow = (1.0 - smoothstep(0.0, 1.1, yards)) * uLive * 0.35;
  col = mix(col, uEdge * 1.5, max(edge, edgeGlow * (1.0 - a)));
  a = max(a, max(edge * 0.95, edgeGlow));
  // Ragged ends inside the lane's length.
  a *= smoothstep(0.0, 0.6, along) * (1.0 - smoothstep(uLength - 0.6, uLength, along));
  gl_FragColor = vec4(col, clamp(a * onFloor, 0.0, 0.96));
}
`;
