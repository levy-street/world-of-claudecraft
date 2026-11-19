// The Masterless Strength's woken stars' shaders (final_stars_fx.ts builds
// them; final_stars_shapes.ts the geometry). Strings only (no Three, no
// state). Every vertex goes through `modelViewMatrix` (camera-relative: the
// Heart sits in an instance band far from the world's origin); every noise
// runs on the mesh's own coordinates.
//
//   ICE_SWORD   a Crossing Blade: the Smith's great sword of ice, deep blue
//               facets with a bright fresnel edge, frost feathering its
//               flats, and the fuller down its middle burning with the
//               blade's light (`uGlow`), brighter as its line locks.
//   ICE_HALO    the cold light round it (additive, a fresnel shell).
//   STAR_RING   a ring racing out over the floor: Arcing Stone's lightning
//               (forks crackling in the band, `uCrackle` 1), the strike's
//               flash, a shattered pillar's frost (`uCrackle` 0: a soft band).
//   FIELD       a Storm-Charged pillar's electric ground (Jose's playtest of
//               2026-11-19, its polish round): a violet / electric-blue edge
//               ring, lightning arcs crawling over the floor inside it,
//               re-struck in quick steps, a faint flickering glow; additive.
//   COLUMN      a woken quarter's column of light rising off the floor,
//               flowing upward, its lip ragged, in the quarter's vein.

import { KIT_NOISE } from './final_kit_glsl';

export const ICE_SWORD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform float uLength;
uniform vec3 uIce;
uniform vec3 uCore;
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${KIT_NOISE}
void main() {
  vec3 n = normalize(vN);
  float fres = pow(max(1.0 - abs(dot(n, normalize(vView))), 0.0), 2.4);
  // Frost feathering the flats, crawling slowly toward the point.
  float frost = kfbm(vObj.xy * vec2(3.2, 1.1) + vec2(0.0, -uTime * 0.15));
  float facet = 0.55 + 0.45 * abs(n.y + n.x * 0.5);
  // The fuller: a bright groove down the blade's middle (its local x near
  // zero), up the blade only (y over the guard), pulsing up toward the point.
  float onBlade = step(0.0, vObj.y) * (1.0 - smoothstep(uLength * 0.86, uLength * 0.97, vObj.y));
  float fuller = exp(-abs(vObj.x) * 9.0) * onBlade;
  float flow = 0.6 + 0.4 * sin(vObj.y * 2.4 - uTime * 7.0);
  vec3 col = uIce * (0.32 + 0.38 * facet) + vec3(0.75, 0.9, 1.0) * frost * 0.22;
  col += uCore * fuller * flow * (0.45 + 1.4 * uGlow);
  col += vec3(0.85, 0.95, 1.0) * fres * (0.55 + 0.6 * uGlow);
  float a = clamp(0.78 + fres * 0.22 + fuller * 0.2, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const ICE_HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uCore;
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${KIT_NOISE}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 1.6);
  float shimmer = 0.75 + 0.25 * kn(vObj.xy * 2.0 + vec2(uTime * 1.5, -uTime));
  gl_FragColor = vec4(uCore * fres * shimmer * (0.35 + 0.9 * uGlow), 1.0);
}
`;

/** A flat disc in its local xz (the mesh lies on the floor). */
export const STAR_RING_VERT = /* glsl */ `
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const STAR_RING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFront;
uniform float uAlpha;
uniform float uWidth;
uniform float uCrackle;
uniform float uSeed;
uniform float uScale;
uniform vec3 uColor;
varying vec3 vObj;
${KIT_NOISE}
void main() {
  // The disc is unit; its yards are its scale.
  float r = length(vObj.xz) * uScale;
  float ang = atan(vObj.z, vObj.x);
  // The band at the front, its inner wake fading behind it.
  float d = r - uFront;
  float band = exp(-d * d / max(0.01, uWidth * uWidth));
  float wake = smoothstep(uFront, 0.0, r) * step(r, uFront) * 0.22;
  // Forks crackling in the band (re-seeded in quick steps: the flicker).
  float step10 = floor(uTime * 14.0);
  float fork = pow(max(kridge(vec2(ang * 6.0 + uSeed, r * 0.55 + step10 * 0.37)), 0.0), 10.0);
  float cr = mix(1.0, 0.45 + fork * 2.6, uCrackle);
  float body = band * cr + wake * (1.0 - uCrackle * 0.5);
  vec3 col = uColor * body + vec3(1.0) * band * fork * uCrackle * 0.8;
  gl_FragColor = vec4(col * uAlpha, 1.0);
}
`;

export const FIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uPillar;
uniform vec3 uEdge;
uniform vec3 uArc;
varying vec3 vObj;
${KIT_NOISE}
void main() {
  // The disc is unit: r 0 at the pillar, 1 at the zone's edge.
  float r = length(vObj.xz);
  if (r > 1.0) discard;
  float ang = atan(vObj.z, vObj.x);
  // Re-struck in quick steps: the arcs jump, the light flickers.
  float st = floor(uTime * 12.0);
  float flick = 0.78 + 0.22 * kh(vec2(st, uSeed));
  // The edge: a bright electric ring, a softer violet halo inside it.
  float ed = (r - 0.965) / 0.03;
  float edge = exp(-ed * ed);
  float halo = smoothstep(0.7, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  // Arcs crawling out over the floor from the pillar's foot to the edge:
  // thin ridged lines on the polar plane, two layers, each re-seeded.
  vec2 q = vec2(ang * 2.2 + uSeed, r * 3.2 - uTime * 0.6);
  float a1 = pow(max(kridge(q * 1.7 + vec2(st * 0.37, 0.0)), 0.0), 18.0);
  float a2 = pow(max(kridge(q * 2.9 + vec2(-st * 0.53, 3.1)), 0.0), 26.0);
  float arcs = (a1 + 0.8 * a2) * smoothstep(uPillar, uPillar + 0.08, r);
  // A faint charged glow over the whole ground, breathing with the flicker.
  float fill = 0.08 + 0.05 * kfbm(vObj.xz * 3.0 + vec2(uTime * 0.7, -uTime * 0.5));
  vec3 col = uEdge * (edge * 1.6 + halo * 0.35 + fill) + uArc * arcs * 1.4 + vec3(1.0) * arcs * 0.35;
  gl_FragColor = vec4(col * flick, 1.0);
}
`;

export const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
${KIT_NOISE}
void main() {
  float flow = kfbm(vec2(vUv.x * 7.0, vUv.y * 2.2 - uTime * 2.4));
  float lip = 1.0 - smoothstep(0.55, 1.0, vUv.y + (flow - 0.5) * 0.4);
  float foot = smoothstep(0.0, 0.06, vUv.y);
  float body = (0.35 + 0.9 * flow) * lip * foot;
  gl_FragColor = vec4(uColor * body * uAlpha, 1.0);
}
`;
