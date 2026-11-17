// A hole in the Frozen Lake's ice, drawn on one flat instanced disc so it
// keeps its single rung on the Quench's floor ladder (no flicker), yet reads
// as a real hole from any camera: inside the broken edge the fragment follows
// the view ray DOWN through the ice (parallax): it meets either the hole's
// ice wall (lit at its top, strata, dark at the waterline) or the black
// freezing water HOLE_DEPTH below, slush and floes drifting on it, the sky
// glinting. Past the edge, on the lake: the broken lip (a white fractured
// band, teeth of ice reaching in) and cracks radiating out over the ice.
// The owner's heroic run of 2026-11-17 asked for a hole that is seen and felt.
//
// instanceColor: churn (0..1, the fresh break's boil), fresh (0..1, the
// first seconds), seed. The disc's local radius 1 is HOLE_DISC_SCALE x the
// sim's hole radius (quench_hole_core.ts). Camera-relative (world x ~ 119000).

import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { HOLE_DEPTH, HOLE_EDGE } from './quench_hole_core';

const f = (n: number) => n.toFixed(4);

export const HOLE_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vXY;
varying vec3 vP;
varying vec3 vW;
varying float vS;
void main() {
  vXY = position.xz;
  vP = instanceColor;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vS = length((modelMatrix * instanceMatrix)[0].xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;

export const HOLE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uLit;
uniform vec3 uRim;
varying vec2 vXY;
varying vec3 vP;
varying vec3 vW;
varying float vS;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
/** The broken outline at angle a (disc units). */
float edgeAt(float a, float seed) {
  float e = ${f(HOLE_EDGE)} * (0.97 + 0.07 * n(vec2(a * 6.0 + seed, seed))
    + 0.035 * n(vec2(a * 19.0 - seed, seed * 2.0)));
  float teeth = ${f(HOLE_EDGE)} * 0.09 * smoothstep(0.55, 0.92, n(vec2(a * 14.0 + seed * 3.0, 7.0)));
  return e - teeth;
}
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float a = atan(vXY.y, vXY.x);
  float seed = vP.z * 37.0;
  float t = uTime;
  float edge = edgeAt(a, seed);
  vec3 col;
  float alpha;
  if (r > edge) {
    // ---- the lake round the hole: the broken lip, its cracks ----
    float outer = (r - edge) / max(1.0 - edge, 0.001);
    // A white band of fractured ice right at the break, uneven.
    float band = 1.0 - smoothstep(0.0, 0.16 + 0.08 * n(vec2(a * 9.0, seed)), outer);
    // Cracks radiating out, jagged, fading with the distance.
    float k = a / 6.28318 * 13.0 + seed;
    float id = floor(k);
    float wob = (h(vec2(id, floor(r * 11.0))) - 0.5) * 0.5;
    float line = abs(fract(k) - 0.5 + wob * 0.35);
    float reach = 0.35 + 0.65 * h(vec2(id, 3.0));
    float crack = (1.0 - smoothstep(0.0, 0.05, line * (0.5 + outer))) * (1.0 - smoothstep(reach * 0.7, reach, outer));
    // A ring crack a little way out, broken in places.
    float ring = (1.0 - smoothstep(0.0, 0.035, abs(outer - 0.42 - 0.06 * n(vec2(a * 5.0, seed)))))
      * step(0.45, n(vec2(a * 4.0 + seed, 2.0)));
    float dark = max(crack, ring * 0.8);
    col = mix(uRim, uDeep * 0.6, dark * 0.75);
    col = mix(col, uRim * 1.15, band);
    alpha = clamp(band * 0.95 + dark * 0.8 * (1.0 - outer * 0.6), 0.0, 1.0) * (1.0 - smoothstep(0.85, 1.0, outer));
  } else {
    // ---- inside: follow the view ray down to the wall or the water ----
    vec3 V = normalize(vW - cameraPosition);
    float down = max(-V.y, 0.08);
    vec2 p0 = vXY * vS;
    vec2 d = V.xz;
    float R = edge * vS;
    float depth = ${f(HOLE_DEPTH)};
    float tw = depth / down;
    // The ray's exit through the wall's circle (p0 inside, so a positive root).
    float A = dot(d, d);
    float B = dot(p0, d);
    float Cc = dot(p0, p0) - R * R;
    float tc = A > 1e-6 ? (-B + sqrt(max(B * B - A * Cc, 0.0))) / A : 1e9;
    if (tc < tw) {
      // The ice wall, its height below the lip.
      float hgt = clamp(tc * down / depth, 0.0, 1.0);
      vec2 hit = p0 + d * tc;
      float wa = atan(hit.y, hit.x);
      float strata = n(vec2(wa * 7.0 + seed, hgt * 9.0)) * 0.5 + n(vec2(wa * 23.0, hgt * 30.0)) * 0.2;
      vec3 top = uLit * 1.1;
      vec3 low = uDeep * 0.4;
      col = mix(top, low, smoothstep(0.0, 0.85, hgt));
      col *= 0.75 + 0.45 * strata;
      // Wet and dark at the waterline, a pale rime frill at the top.
      col = mix(col, uDeep * 0.35, smoothstep(0.75, 1.0, hgt));
      col += uRim * 0.45 * (1.0 - smoothstep(0.0, 0.08, hgt));
    } else {
      // The water, deep and black, moving.
      vec2 hit = p0 + d * tw;
      vec2 q = hit * 1.6 + vec2(seed);
      float swell = n(q + vec2(t * 0.35, -t * 0.25)) * 0.6 + n(q * 2.3 - vec2(t * 0.55, t * 0.42)) * 0.4;
      vec3 water = mix(uDeep * 0.35, uLit * 0.45, swell * 0.3);
      // The fresh break boils white, then settles to slush and floes.
      float churn = vP.x;
      float slush = smoothstep(0.6, 0.9, n(q * 1.4 + vec2(t * 0.6, t * 0.4))) * churn;
      water = mix(water, uRim * 0.7, slush * 0.35);
      vec2 drift = vec2(sin(t * 0.2 + seed), cos(t * 0.17 + seed)) * 0.4;
      float floe = smoothstep(0.8, 0.83, n(hit * 1.1 + vec2(seed * 0.4) + drift));
      water = mix(water, uRim * 0.6, floe * 0.7);
      float glint = max(0.0, n(q * 3.1 + vec2(t * 0.8, -t * 0.6)) - 0.6) * 2.6;
      water += uLit * glint * glint * glint * 0.6;
      // The wall's shadow on the water near the edge.
      float nearWall = smoothstep(R * 0.55, R, length(hit));
      col = water * (1.0 - 0.45 * nearWall);
    }
    // Cold mist hanging in the hole, thicker in the fresh break.
    float mist = n(vXY * 4.0 + vec2(t * 0.25, -t * 0.18)) * (0.06 + 0.12 * vP.y);
    col = mix(col, uRim * 0.8, mist);
    alpha = 1.0;
  }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
