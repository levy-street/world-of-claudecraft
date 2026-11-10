// The Masterless Strength's arrival shaders (final_arrival_beam.ts paints
// them; the timeline is final_arrival_core.ts). Every one is additive and
// unclamped (toneMapped off), so the bloom catches the light: the four veins
// running over the floor, the beam's swirl and its white core, the pool of
// light at its foot.

import { HEART_VEIN_GROOVE } from '../smith_heart/heart_vein_groove_core';

/** A ribbon down a vein's groove: `aAlong` 0 at the altar to 1 at the boss
 *  (by length), `aSide` the signed yards across the groove's centreline,
 *  `aVein` the vein's index, `aRise` -1 on the floor's ribbon and 0 to 1 up
 *  the veil standing on its centreline. */
export const ARRIVAL_STREAM_VERT = /* glsl */ `
attribute float aAlong;
attribute float aSide;
attribute float aVein;
attribute float aRise;
varying float vAlong;
varying float vSide;
varying float vVein;
varying float vRise;
void main() {
  vAlong = aAlong;
  vSide = aSide;
  vVein = aVein;
  vRise = aRise;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GROOVE_HALF = HEART_VEIN_GROOVE.halfWidth.toFixed(3);

/** Each vein's light running down its groove: a white-hot head at its front
 *  flaring past the groove's lips, the groove's bed filled behind it with
 *  flowing light in the vein's colour and a hot line down its middle, a soft
 *  glow spilt over the floor either side. */
export const ARRIVAL_STREAM_FRAG = /* glsl */ `
uniform vec4 uFront;
uniform vec4 uLevel;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uLength;
varying float vAlong;
varying float vSide;
varying float vVein;
varying float vRise;
float h1(float p) { return fract(sin(p * 127.1) * 43758.5453); }
float n1(float p) {
  float i = floor(p);
  float f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(h1(i), h1(i + 1.0), f);
}
void main() {
  int v = int(vVein + 0.5);
  float front = v == 0 ? uFront.x : v == 1 ? uFront.y : v == 2 ? uFront.z : uFront.w;
  float level = v == 0 ? uLevel.x : v == 1 ? uLevel.y : v == 2 ? uLevel.z : uLevel.w;
  vec3 c = v == 0 ? uC0 : v == 1 ? uC1 : v == 2 ? uC2 : uC3;
  if (front < 0.0 || level < 0.002) discard;
  // Yards behind the front (negative: ahead of it, still dark).
  float behind = (front - vAlong) * uLength;
  if (behind < -3.5) discard;
  float lit = smoothstep(-0.8, 1.6, behind);
  float head = exp(-behind * behind * 0.1);
  // The head's glare reaches a little ahead of it, licking down the groove.
  float lead = exp(-max(-behind, 0.0) * 1.6) * (1.0 - lit);
  float yd = vAlong * uLength;
  float flow = 0.55 + 0.45 * n1(yd * 0.5 - uTime * 10.0) + 0.3 * sin(yd * 0.8 - uTime * 15.0);
  // Packets of brighter light racing down behind the head.
  float packet = smoothstep(0.78, 1.0, sin(yd * 0.32 - uTime * 11.0)) * lit;
  // Far behind the head the trail settles a little (it never goes out).
  float settle = 0.72 + 0.28 * exp(-max(behind, 0.0) * 0.06);
  if (vRise >= 0.0) {
    // The veil standing on the groove: soft, fading up, flickering, taller
    // and white at the head.
    float up = clamp(vRise, 0.0, 1.0);
    float fadeUp = (1.0 - up) * (1.0 - up);
    float flick = 0.6 + 0.4 * n1(yd * 0.7 - uTime * 6.0 + up * 3.0);
    vec3 veil = c * (lit * settle * 0.45 * fadeUp * flick + head * 1.5 * (1.0 - up))
      + vec3(1.0, 0.96, 0.88) * head * 0.8 * fadeUp;
    gl_FragColor = vec4(veil * level, 1.0);
    #include <colorspace_fragment>
    return;
  }
  float s = abs(vSide);
  float chan = 1.0 - smoothstep(${GROOVE_HALF} - 0.3, ${GROOVE_HALF} + 0.12, s);
  float core = exp(-s * s * 5.0);
  float spill = exp(-s * s * 0.3);
  vec3 col = c * (lit * settle * ((1.3 * chan + 0.42 * spill) * flow + 1.2 * packet * chan)
    + head * (4.5 * chan + 2.4 * spill) + lead * 1.4 * chan);
  col += vec3(1.0, 0.96, 0.88) * (lit * settle * core * 0.9 * flow + head * (6.0 * core + 1.2 * chan));
  gl_FragColor = vec4(col * level, 1.0);
  #include <colorspace_fragment>
}
`;

/** The beam's cylinders: the uv's height share and how square-on the
 *  surface faces the eye (its middle burns, its rim fades). */
export const ARRIVAL_BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

/** The swirl: the four colours wound up the column in helices turning as
 *  they climb, streaks of light racing up it, the foot flaring, the top
 *  dissolving into the sky. */
export const ARRIVAL_SWIRL_FRAG = /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uHeight;
uniform float uGlow;
uniform float uDetail;
varying vec2 vUv;
varying float vFacing;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float yy = vUv.y * uHeight;
  float a = vUv.x * 6.2831853;
  vec3 vc[4];
  vc[0] = uC0; vc[1] = uC1; vc[2] = uC2; vc[3] = uC3;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float ph = a + float(i) * 1.5707963 - yy * 0.07 + uTime * 3.0;
    float band = pow(max(0.5 + 0.5 * sin(ph), 0.0), 6.0);
    col += vc[i] * band;
  }
  float streak = n2(vec2(vUv.x * 44.0, yy * 0.035 - uTime * 2.6));
  streak = mix(0.75, 0.35 + 1.1 * streak * streak, uDetail);
  float body = pow(clamp(vFacing, 0.0, 1.0), 1.1);
  float top = 1.0 - smoothstep(0.7, 1.0, vUv.y);
  float foot = 1.0 + 1.4 * exp(-yy * 0.09);
  vec3 c = col * 1.9 * streak * body * top * foot * uGlow;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

/** The white-hot core: brightest square-on, flickering as it pours up. */
export const ARRIVAL_CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uGlow;
varying vec2 vUv;
varying float vFacing;
void main() {
  float yy = vUv.y * uHeight;
  float flick = 0.85 + 0.15 * sin(yy * 0.4 - uTime * 30.0) * sin(yy * 0.13 - uTime * 11.0);
  float body = pow(clamp(vFacing, 0.0, 1.0), 2.5);
  float top = 1.0 - smoothstep(0.8, 1.0, vUv.y);
  vec3 hot = mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.98, 0.94), pow(clamp(vFacing, 0.0, 1.0), 2.0));
  gl_FragColor = vec4(hot * body * top * flick * 2.4 * uGlow, 1.0);
  #include <colorspace_fragment>
}
`;

/** A flat disc's local position (its radius in x, z: -1 to 1). */
export const ARRIVAL_POOL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The pool of light at the beam's foot: the four colours turning round a
 *  white heart, falling away to the rim. */
export const ARRIVAL_POOL_FRAG = /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uGlow;
varying vec2 vP;
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float a = atan(vP.y, vP.x);
  vec3 vc[4];
  vc[0] = uC0; vc[1] = uC1; vc[2] = uC2; vc[3] = uC3;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float ph = a + float(i) * 1.5707963 + r * 5.0 - uTime * 2.4;
    col += vc[i] * pow(max(0.5 + 0.5 * sin(ph), 0.0), 4.0);
  }
  float fall = pow(max(1.0 - r, 0.0), 2.2);
  float heart = exp(-r * r * 30.0);
  vec3 c = col * fall * 1.3 + vec3(1.0, 0.95, 0.86) * heart * 2.2;
  gl_FragColor = vec4(c * uGlow, 1.0);
  #include <colorspace_fragment>
}
`;
