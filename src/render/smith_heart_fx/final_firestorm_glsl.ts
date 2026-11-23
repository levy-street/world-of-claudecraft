// Firestorm's wall of flame in GLSL (final_firestorm_fx.ts; the plan
// final_firestorm_core.ts). The fragment programs are the Heat guardian's own
// wall of fire (heat_lava_wall_glsl.ts: the curtain's fire and dark body, its
// glow, smoke, haze, tongues and embers), so both fires read as one family;
// this file holds the STRAIGHT lane's vertex programs and the burnt lane's
// floor:
//   FS_SHEET_VERT   a curtain standing across the lane at the front (or a
//                   sheet behind it), on the floor's own heights across, its
//                   ends tapering inside the lane's edges, leaning back from
//                   the way it runs, clipped to the Anvil's floor;
//   FS_TRAIL_VERT   the low fire still burning down the lane behind the wall
//                   (baked on the floor once per lane), dying with distance;
//   FS_TONGUE_VERT  tongues of flame leaping off the wall (camera-facing
//                   ribbons round a bent spine), trailing back;
//   FS_EMBER_VERT   embers swirling up off the wall and the trail, sparks
//                   flung ahead (never past the light ahead);
//   FS_FLOOR_VERT / FS_FLOOR_FRAG   the burnt lane on the floor: the molten
//                   seam at the wall's foot, the floor lit ahead, the burning
//                   char behind with its cracks, the crisp hot line on both
//                   edges (the danger edge), the char fading once it is out.
// Strings only.

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { FIRESTORM_LOOK as L } from './final_firestorm_core';

const N = L.groundSamples;

/** The wall's shared uniforms: where its front stands, which way it runs,
 *  the lane's half width, the floor under it, the room it is clipped to. */
const FS_COMMON = /* glsl */ `
uniform vec3 uFront;
uniform vec2 uDir;
uniform float uHalf;
uniform float uRise;
uniform float uTime;
uniform vec3 uRoom;
uniform float uGround[${N}];
float fsGround(float xs) {
  float f = clamp(xs * 0.5 + 0.5, 0.0, 1.0) * ${(N - 1).toFixed(1)};
  int i = int(min(floor(f), ${(N - 2).toFixed(1)}));
  float a = uGround[0];
  float b = uGround[1];
  for (int k = 0; k < ${N - 1}; k++) {
    if (k == i) { a = uGround[k]; b = uGround[k + 1]; }
  }
  return mix(a, b, f - float(i));
}
float fsOnFloor(vec2 xz) {
  float d = length(xz - uRoom.xy);
  return 1.0 - smoothstep(uRoom.z - 1.0, uRoom.z, d);
}
vec2 fsSide() { return vec2(uDir.y, -uDir.x); }
`;

/** A curtain across the lane: position.x 0..1 across, position.y 0..1 up;
 *  aSheet (yards behind the front, seed). */
export const FS_SHEET_VERT = /* glsl */ `
uniform float uH;
uniform float uLift;
attribute vec2 aSheet;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
${FS_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  float xs = position.x * 2.0 - 1.0;
  float v = position.y;
  vec2 side = fsSide();
  float lateral = xs * uHalf;
  vec2 xz = uFront.xz - uDir * aSheet.x + side * lateral;
  // Its ends taper inside the lane's edges (never a straight card edge).
  float ends = 1.0 - smoothstep(0.72, 1.0, abs(xs));
  float m = ends * fsOnFloor(xz) * uRise;
  vMask = m;
  vSeed = aSheet.y;
  float s = aSheet.y * 37.0;
  // It leans back off its run and sways in the draught it makes; the lean
  // only ever goes back (behind the front, inside the burnt lane).
  float sway = sin(lateral * 0.41 + uTime * 1.9 + s) * 0.35 + sin(lateral * 0.97 - uTime * 3.1 + s * 1.3) * 0.18;
  xz -= uDir * (1.1 + 0.4 * sin(uTime * 1.3 + s)) * v * v;
  xz += side * sway * v * v * 0.6;
  float h = uH * (0.3 + 0.7 * m);
  float g = fsGround(xs);
  vec3 w = vec3(xz.x, uFront.y + g - 0.3 + uLift * uH + v * (h + 0.3), xz.y);
  vUv = vec2(lateral + s, v);
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

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
${FS_COMMON}
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

/** A tongue of flame leaping off the wall (instanced ribbons; aTongue:
 *  across -1..1, seed). It swells, licks up, breaks off and fades. */
export const FS_TONGUE_VERT = /* glsl */ `
uniform float uTongue;
attribute vec2 aTongue;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${FS_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  vUv = vec2(position.x + 0.5, position.y + 0.5);
  vSeed = aTongue.y;
  float xs = aTongue.x;
  vec2 side = fsSide();
  float back = fract(aTongue.y * 5.17) * 2.4;
  vec2 foot = uFront.xz - uDir * back + side * xs * uHalf * 0.94;
  float m = (1.0 - smoothstep(0.7, 1.0, abs(xs))) * fsOnFloor(foot) * uRise;
  float period = 0.75 + 0.8 * fract(aTongue.y * 7.31);
  float ph = fract(uTime / period + aTongue.y * 3.7);
  float grow = sin(min(ph, 0.75) / 0.75 * 3.14159);
  float lift = smoothstep(0.6, 1.0, ph) * 0.55;
  float hgt = uTongue * (0.45 + 0.55 * fract(aTongue.y * 13.7)) * (0.35 + 0.65 * grow) * m;
  vAlpha = m * (1.0 - smoothstep(0.62, 0.92, ph)) * smoothstep(0.0, 0.1, ph);
  if (vAlpha <= 0.002 || hgt < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 base = vec3(foot.x, uFront.y + fsGround(xs) + 0.1 + lift * hgt * 0.9, foot.y);
  float v = vUv.y;
  vec3 up = vec3(0.0, hgt, 0.0);
  // Trailing back from the run.
  vec3 lean = vec3(-uDir.x, 0.0, -uDir.y) * hgt * 0.45;
  vec3 spine = base + up * v + lean * v * v;
  vec3 tangent = normalize(up + 2.0 * lean * v);
  vec3 toCam = normalize(cameraPosition - spine);
  vec3 sd = cross(tangent, toCam);
  float sl = length(sd);
  sd = sl > 1e-4 ? sd / sl : vec3(1.0, 0.0, 0.0);
  float s = aTongue.y * 40.0;
  float sBend = sin(v * 5.2 - uTime * 3.6 + s) * (0.6 + 0.4 * sin(uTime * 1.3 + s * 0.7));
  float flick = sin(uTime * 9.3 + s * 2.1) * 0.5 + sin(uTime * 13.7 + s * 3.3) * 0.3;
  spine += sd * (sBend * 0.14 * v + flick * 0.1 * v * v * v) * hgt;
  float width = hgt * (0.4 + 0.2 * fract(aTongue.y * 3.3)) * (1.0 - 0.45 * lift);
  vec3 w = spine + sd * position.x * width;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

/** Embers (points; aEmber: across -1..1, seed, speed, size). Most rise off
 *  the wall and the burnt lane on the updraft; some sparks are flung a few
 *  yards ahead and fall. */
export const FS_EMBER_VERT = /* glsl */ `
uniform float uPx;
uniform float uFrontAlong;
uniform float uTrail;
attribute vec4 aEmber;
varying float vLife;
varying float vSpark;
varying float vAlpha;
${FS_COMMON}
${CAMERA_RELATIVE_GLSL}
void main() {
  float seed = aEmber.y;
  float life = fract(uTime * aEmber.z + seed * 11.0);
  vLife = life;
  float spark = step(seed, 0.22);
  vSpark = spark;
  vec2 side = fsSide();
  float xs = aEmber.x;
  float m;
  vec3 p;
  if (spark > 0.5) {
    float tau = life * 1.0;
    float out_ = 2.5 + 4.0 * fract(seed * 7.7);
    float up = 4.0 + 6.0 * fract(seed * 3.9);
    vec2 xz = uFront.xz + uDir * out_ * tau + side * (xs * uHalf * 0.9 + (fract(seed * 5.3) - 0.5) * 2.0 * tau);
    float y = uFront.y + fsGround(xs) + 0.6 + up * tau - 6.0 * tau * tau;
    p = vec3(xz.x, y, xz.y);
    m = uRise * fsOnFloor(xz) * step(uFront.y + fsGround(xs) + 0.05, y);
  } else {
    // A third rise off the burnt lane behind, the rest off the wall.
    float trail = step(0.62, fract(seed * 4.3));
    float back = trail > 0.5 ? 3.0 + fract(seed * 9.1) * min(28.0, uFrontAlong) : fract(seed * 9.1) * 2.5;
    float hgt = life * (trail > 0.5 ? 3.0 + 4.0 * fract(seed * 2.3) : 6.0 + 9.0 * fract(seed * 2.3));
    float curl = sin(uTime * 1.3 + seed * 40.0 + hgt * 0.4) * (0.5 + hgt * 0.12);
    vec2 xz = uFront.xz - uDir * (back + hgt * 0.15) + side * (xs * uHalf * 0.95 + curl);
    p = vec3(xz.x, uFront.y + fsGround(xs) + 0.4 + hgt, xz.y);
    m = fsOnFloor(xz) * (trail > 0.5 ? uTrail * step(back, uFrontAlong) : uRise);
  }
  vAlpha = m * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
  vec4 mv = wocCamRelView(p);
  gl_Position = projectionMatrix * mv;
  float sz = aEmber.w * (spark > 0.5 ? 0.7 : 1.0) * (1.0 - 0.5 * life);
  gl_PointSize = vAlpha > 0.002 ? clamp(sz * uPx / max(1.0, -mv.z), 1.0, 36.0) : 0.0;
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
  float a = burnt * mix(0.8, 0.94, seam) * uChar;
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
  a *= smoothstep(-0.6, 0.6, along) * (1.0 - smoothstep(uLength - 0.6, uLength + 0.4, along));
  gl_FragColor = vec4(col, clamp(a * onFloor, 0.0, 0.96));
}
`;
