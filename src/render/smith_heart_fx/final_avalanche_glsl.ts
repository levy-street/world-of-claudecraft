// Avalanche's shaders (final_avalanche_fx.ts; Jose's playtest of 2026-11-20):
//   SPIKE_FRAG  the erupted spikes on SOLID_VERT (final_elements_glsl.ts): ice
//               deep blue at the foot to a pale lit tip, light caught in the
//               facets and a cold rim, glints; stone a grey-brown granite with
//               frost settled on its upward faces. `uIce` picks the material,
//               `vObj.y` (0 foot, 1 tip) the height.
//   SCAR_VERT / SCAR_FRAG  the floor torn open along a lane: a jagged
//               centre fissure and its branching cracks, frost in them, lit
//               cold as they open (`uGlow`), torn only behind the front
//               (`uFront`), fading out (`uAlpha`).
// No pow(): every curve is a smoothstep or a product (the pow-domain guard).

import { KIT_NOISE } from './final_kit_glsl';

export const SPIKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIce;
varying vec3 vN;
varying vec3 vView;
varying vec3 vCol;
varying vec3 vObj;
${KIT_NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float f1 = 1.0 - ndv;
  float fres = f1 * f1;
  float key = max(dot(n, normalize(vec3(-0.35, 0.85, 0.4))), 0.0);
  float back = max(dot(n, normalize(vec3(0.5, 0.3, -0.6))), 0.0);
  float hgt = clamp(vObj.y, 0.0, 1.0);
  vec3 col;
  if (uIce > 0.5) {
    // Ice: dense and dark blue in the foot, clearing to a lit pale tip; the
    // facets catch the key light flat, the edges glow through.
    float veins = kn(vec2(vObj.x * 3.0 + vObj.z * 2.0, vObj.y * 6.0));
    vec3 deep = vec3(0.04, 0.14, 0.34);
    vec3 mid = vCol * vec3(0.55, 0.8, 1.0);
    vec3 tip = vec3(0.8, 0.94, 1.0);
    col = mix(deep, mid, smoothstep(0.0, 0.6, hgt));
    col = mix(col, tip, smoothstep(0.8, 1.0, hgt));
    // Flat facets: the lit ones bright, the turned-away ones deep.
    col *= 0.45 + 0.75 * key;
    col += vec3(0.2, 0.5, 0.95) * back * 0.4;
    col += vec3(0.55, 0.85, 1.0) * fres * 0.75;
    col += vec3(0.5, 0.8, 1.0) * veins * 0.12 * (1.0 - hgt);
    float glint = smoothstep(0.92, 1.0, kn(vec2(vObj.x * 9.0 + uTime * 0.7, vObj.y * 9.0 - vObj.z * 5.0)));
    col += vec3(1.0) * glint * key * 0.8;
  } else {
    // Stone: broken granite, frost settled on what faces up.
    float g = kfbm(vec2(vObj.x * 4.0 + vObj.z * 3.0, vObj.y * 5.0));
    vec3 stone = mix(vCol * 0.85, vCol * 1.4, g);
    col = stone * (0.62 + 0.5 * key);
    float up = smoothstep(0.7, 0.95, n.y);
    col = mix(col, vec3(0.78, 0.86, 0.94), up * 0.3);
    col += vec3(0.4, 0.55, 0.7) * fres * 0.18;
  }
  // The foot darkened where it meets the torn floor.
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.12, hgt);
  // Authored in display space; the renderer's output is sRGB: square it back
  // to linear so the ice keeps its blue and the stone its weight.
  col = col * col * 1.15;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SCAR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SCAR_FRAG = /* glsl */ `
uniform float uFront;
uniform float uAlpha;
uniform float uGlow;
uniform float uSeed;
uniform float uLength;
varying vec2 vUv;
${KIT_NOISE}
void main() {
  // u across the lane (-1..1), t along it (0 start, 1 end).
  float u = vUv.x * 2.0 - 1.0;
  float t = vUv.y;
  if (t > uFront) discard;
  float along = t * uLength;
  // The centre fissure, wandering.
  float wob = (kn(vec2(along * 0.35, uSeed)) - 0.5) * 0.7 + (kn(vec2(along * 1.4, uSeed + 3.0)) - 0.5) * 0.25;
  float d = abs(u - wob);
  float fissure = 1.0 - smoothstep(0.05, 0.16, d);
  float lip = 1.0 - smoothstep(0.16, 0.45, d);
  // Branching cracks off it, cell edges in a stretched noise.
  vec2 q = vec2(u * 2.2, along * 0.55);
  float r1 = kridge(q + vec2(uSeed, 0.0));
  float r2 = kridge(q * 2.1 + vec2(0.0, uSeed));
  float cracks = smoothstep(0.86, 0.97, r1) * (1.0 - smoothstep(0.2, 0.95, abs(u))) +
    smoothstep(0.9, 0.98, r2) * 0.6 * (1.0 - smoothstep(0.1, 0.8, abs(u)));
  float side = 1.0 - smoothstep(0.65, 1.0, abs(u));
  // The torn ground: darkened, frosted at the lips.
  float frost = kfbm(vec2(u * 3.0, along * 0.8 + uSeed));
  float shade = clamp(lip * 0.75 + cracks * 0.5, 0.0, 1.0) * side;
  vec3 dark = vec3(0.01, 0.015, 0.03);
  vec3 rime = vec3(0.45, 0.62, 0.8) * (0.55 + 0.45 * frost);
  vec3 glowCol = vec3(0.12, 0.45, 0.9);
  // The fissure's heart dark, its walls lit cold from below.
  float wall = fissure * (1.0 - smoothstep(0.0, 0.07, d));
  vec3 col = mix(rime, dark, fissure);
  col += glowCol * (wall * 1.4 + cracks * 0.7) * uGlow;
  // Fresh behind the front: brightest just behind it.
  float fresh = 1.0 - smoothstep(0.0, 0.25, uFront - t);
  col += glowCol * fresh * fissure * 0.6;
  float a = (shade * 0.85 + fissure) * uAlpha;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;
