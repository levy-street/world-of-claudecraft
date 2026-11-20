// The Masterless Strength's death shaders (final_death_fx.ts paints them;
// the timeline is final_death_core.ts). Additive and unclamped (toneMapped
// off) so the bloom catches the light, like the arrival's
// (final_arrival_glsl.ts, whose ribbon vertex shader, pool and beam shaders
// the death reuses: one program each, already linked by the arrival).

import { HEART_VEIN_GROOVE } from '../smith_heart/heart_vein_groove_core';

const GROOVE_HALF = HEART_VEIN_GROOVE.halfWidth.toFixed(3);

/** A groove the essence races down (on final_groove_ribbon.ts's ribbon and
 *  the arrival's vertex shader): a white-hot comet head at its front throwing
 *  its glare ahead, the groove burning behind it in its vein's colour with
 *  packets of light chasing the head, a flare of white at the impact; then
 *  the light cooling into broken coals (`uEmber`) and dying out (`uLevel`). */
export const DEATH_TRAIL_FRAG = /* glsl */ `
uniform vec4 uFront;
uniform vec4 uLevel;
uniform vec4 uHead;
uniform vec4 uEmber;
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
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  int v = int(vVein + 0.5);
  float front = v == 0 ? uFront.x : v == 1 ? uFront.y : v == 2 ? uFront.z : uFront.w;
  float level = v == 0 ? uLevel.x : v == 1 ? uLevel.y : v == 2 ? uLevel.z : uLevel.w;
  float headK = v == 0 ? uHead.x : v == 1 ? uHead.y : v == 2 ? uHead.z : uHead.w;
  float ember = v == 0 ? uEmber.x : v == 1 ? uEmber.y : v == 2 ? uEmber.z : uEmber.w;
  vec3 c = v == 0 ? uC0 : v == 1 ? uC1 : v == 2 ? uC2 : uC3;
  if (front < 0.0 || level < 0.002) discard;
  float behind = (front - vAlong) * uLength;
  if (behind < -6.0) discard;
  float yd = vAlong * uLength;
  float lit = smoothstep(-0.6, 1.2, behind);
  float head = exp(-behind * behind * 0.14) * headK;
  // The comet's glare licks a long way down the groove ahead of it.
  float lead = exp(-max(-behind, 0.0) * 0.9) * (1.0 - lit) * headK;
  // A wake hotter near the head, the far trail settling.
  float wake = 0.6 + 0.9 * exp(-max(behind, 0.0) * 0.08 / max(headK, 0.25));
  float flow = 0.55 + 0.45 * n1(yd * 0.6 + uTime * 14.0) + 0.3 * sin(yd * 0.9 + uTime * 19.0);
  float packet = smoothstep(0.8, 1.0, sin(yd * 0.28 - uTime * 16.0)) * lit * headK;
  // The embers: the light broken into coals that breathe, cooling from the
  // vein's colour to a deep forge red.
  // Coals scattered over the groove's bed in two dimensions (never bands
  // across it), a few bright, most a dull glow, each breathing on its own.
  vec2 cp = vec2(yd * 0.9 + vVein * 31.0, vSide * 1.6);
  float coal = smoothstep(0.45, 0.85, n2(cp) * 0.65 + n2(cp * 2.7 + 7.0) * 0.35);
  float breathe = 0.6 + 0.4 * sin(uTime * 2.3 + n2(cp * 0.5) * 9.0);
  vec3 emberCol = mix(vec3(0.9, 0.22, 0.04), vec3(1.0, 0.55, 0.16), coal);
  vec3 hue = mix(c, emberCol, ember);
  float body = mix(1.0, coal * breathe * 1.3, ember);
  if (vRise >= 0.0) {
    // The veil standing on the groove: tall and white at the head, soft
    // behind it, gone as the light cools.
    float up = clamp(vRise, 0.0, 1.0);
    float fadeUp = (1.0 - up) * (1.0 - up);
    float flick = 0.6 + 0.4 * n1(yd * 0.7 + uTime * 8.0 + up * 3.0);
    vec3 veil = hue * (lit * wake * 0.42 * fadeUp * flick * (1.0 - ember))
      + c * head * 2.2 * (1.0 - up * 0.6)
      + vec3(1.0, 0.97, 0.9) * head * 1.4 * fadeUp;
    gl_FragColor = vec4(veil * level, 1.0);
    #include <colorspace_fragment>
    return;
  }
  float s = abs(vSide);
  float chan = 1.0 - smoothstep(${GROOVE_HALF} - 0.3, ${GROOVE_HALF} + 0.12, s);
  float core = exp(-s * s * 5.0);
  float spill = exp(-s * s * 0.3) * (1.0 - 0.7 * ember);
  vec3 col = hue * body * (lit * wake * ((1.25 * chan + 0.4 * spill) * mix(flow, 1.0, ember) + 1.3 * packet * chan))
    + c * (head * (5.0 * chan + 3.0 * spill) + lead * 1.8 * chan);
  col += vec3(1.0, 0.97, 0.9) * (lit * core * 0.8 * flow * (1.0 - ember) + head * (7.0 * core + 1.5 * chan));
  gl_FragColor = vec4(col * level, 1.0);
  #include <colorspace_fragment>
}
`;

/** The vortex over the well: a lathe from its mouth (uv.y 1) to its throat
 *  in the pit (uv.y 0). */
export const DEATH_FUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

/** The four colours wound down the vortex in tightening spirals, turning
 *  faster toward the throat, streaked, the mouth's lip soft and the throat
 *  burning white. */
export const DEATH_FUNNEL_FRAG = /* glsl */ `
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uTime;
uniform float uGlow;
uniform float uSpin;
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
  float a = vUv.x * 6.2831853;
  float y = vUv.y;
  vec3 vc[4];
  vc[0] = uC0; vc[1] = uC1; vc[2] = uC2; vc[3] = uC3;
  vec3 col = vec3(0.0);
  // Spirals winding tighter toward the throat (the twist grows as y falls).
  float twist = (1.0 - y) * (1.0 - y) * 9.0;
  float spin = uTime * uSpin * (1.0 + 2.0 * (1.0 - y));
  for (int i = 0; i < 4; i++) {
    float ph = a + float(i) * 1.5707963 + twist - spin;
    // Each arm torn into wisps (never a clean painted stripe).
    float tear = n2(vec2(a * 2.5 + float(i) * 5.0 + twist * 1.5, y * 5.0 - spin * 0.6));
    col += vc[i] * pow(max(0.5 + 0.5 * sin(ph), 0.0), 3.0) * (0.15 + 1.1 * tear * tear);
  }
  float streak = n2(vec2(vUv.x * 36.0 + twist * 3.0, y * 6.0 + uTime * 5.0));
  float lip = smoothstep(1.0, 0.45, y);
  float throat = exp(-y * 9.0);
  float body = 0.3 + 0.7 * pow(clamp(vFacing, 0.0, 1.0), 0.8);
  vec3 c = col * (0.5 + 0.8 * streak) * body * lip * 1.5 + vec3(1.0, 0.95, 0.86) * throat * 2.0;
  gl_FragColor = vec4(c * uGlow, 1.0);
  #include <colorspace_fragment>
}
`;
