// A wall of fire standing across a straight lane in GLSL (line_fire_wall.ts):
// the vertex programs of the Heat guardian's wall of fire (heat_lava_wall_glsl.ts,
// whose fragments it shares) laid on a straight front instead of a ring. Used
// by Firestorm's wall (final_firestorm_fx.ts) and the Molten Swells' crests
// (heat_swell_fx.ts).
//   LINE_FIRE_COMMON  the front, its heading, the lane's half width, the floor
//                     (or the crest) under it across, the room it is clipped to;
//   LINE_SHEET_VERT   a curtain standing across the lane at the front (or a
//                     sheet behind it), its ends tapering inside the lane's
//                     edges, leaning back from the way it runs;
//   LINE_TONGUE_VERT  tongues of flame leaping off it (camera-facing ribbons
//                     round a bent spine), trailing back;
//   LINE_EMBER_VERT   embers swirling up off it (and the burnt lane behind, when
//                     `uTrail`), sparks flung a few yards ahead.
// Strings only.

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';

/** Samples across the lane of the floor (or crest) the wall stands on. */
export const LINE_FIRE_SAMPLES = 9;

const N = LINE_FIRE_SAMPLES;

/** The wall's shared uniforms: where its front stands, which way it runs,
 *  the lane's half width, the floor under it, the room it is clipped to. */
export const LINE_FIRE_COMMON = /* glsl */ `
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
export const LINE_SHEET_VERT = /* glsl */ `
uniform float uH;
uniform float uLift;
attribute vec2 aSheet;
varying vec2 vUv;
varying float vMask;
varying float vSeed;
${LINE_FIRE_COMMON}
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

/** A tongue of flame leaping off the wall (instanced ribbons; aTongue:
 *  across -1..1, seed). It swells, licks up, breaks off and fades. */
export const LINE_TONGUE_VERT = /* glsl */ `
uniform float uTongue;
attribute vec2 aTongue;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${LINE_FIRE_COMMON}
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
export const LINE_EMBER_VERT = /* glsl */ `
uniform float uPx;
uniform float uFrontAlong;
uniform float uTrail;
attribute vec4 aEmber;
varying float vLife;
varying float vSpark;
varying float vAlpha;
${LINE_FIRE_COMMON}
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
