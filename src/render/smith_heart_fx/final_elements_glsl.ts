// The Masterless Strength's own elements' shaders (final_elements_fx.ts):
//   BILL_VERT    a camera-facing card at its object's place and scale (the
//                sigils, the steam's billows, the fusion's glow);
//   SIGIL_FRAG   Opposing Elements' sigil over a marked head, told apart by
//                SHAPE: a flame (Fire), a snowflake (Ice), a mountain (Earth),
//                a lightning bolt (Lightning), each on a dark disc with its
//                colour's halo so it reads over any floor;
//   STEAM_FRAG   a billow of thick white steam, churning (normal blending:
//                it hides what is behind it, as steam does);
//   WALL_FRAG    Firestorm's wall of flame: tongues licking up off a
//                white-hot base, orange, then dark red at the tips;
//   AURA_FRAG    an element's shell round a body (the tank's Elemental Strike,
//                the boss's fusion orbs): fire licking up, frost cells, storm
//                forks or cracked stone, by `uKind`, stronger with `uStrength`;
//   SOLID_VERT / SOLID_FRAG  the instanced solids (Avalanche's spikes, the
//                orbiting rocks and crystals, the hailstones): a fixed key
//                light, a cold fresnel for ice, the instance's colour;
//   SPIRE_FRAG   a Storm Spire: dark stone, violet veins lighting with the
//                charge, flickering hot at the discharge.
// Every vertex shader places its points through `modelViewMatrix`
// (camera-relative) as the rest of the kit's.

import { KIT_NOISE } from './final_kit_glsl';

export const BILL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  float s = length(modelMatrix[0].xyz);
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
}
`;

export const SIGIL_FRAG = /* glsl */ `
uniform float uShape;
uniform float uPulse;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
${KIT_NOISE}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// The four shapes as distances (inside < 0), in a -1..1 card.
float flame(vec2 p) {
  // A teardrop: round at the foot, licking up to a point, a flicker in it.
  float w = kn(vec2(p.y * 3.0 - uTime * 4.0, 1.7)) - 0.5;
  vec2 q = vec2(p.x + w * 0.12 * (p.y + 0.6), p.y + 0.18);
  float body = length(vec2(q.x * (1.0 + max(q.y, 0.0) * 1.6), min(q.y, 0.0) * 1.1 + max(q.y, 0.0) * 0.55)) - 0.48;
  // Two small side tongues.
  float l = length(vec2((p.x + 0.36) * 2.2, (p.y - 0.12) * 1.1)) - 0.22;
  float r = length(vec2((p.x - 0.36) * 2.2, (p.y - 0.12) * 1.1)) - 0.22;
  return min(body, min(l, r) + 0.06);
}
float flake(vec2 p) {
  float r = length(p);
  float a = atan(p.y, p.x);
  float sector = 3.14159265 / 3.0;
  a = mod(a + sector * 0.5, sector) - sector * 0.5;
  vec2 q = vec2(cos(a), sin(a)) * r;
  float arm = seg(q, vec2(0.0), vec2(0.82, 0.0)) - 0.065;
  float b1 = seg(q, vec2(0.42, 0.0), vec2(0.6, 0.17)) - 0.05;
  float b2 = seg(q, vec2(0.42, 0.0), vec2(0.6, -0.17)) - 0.05;
  float b3 = seg(q, vec2(0.62, 0.0), vec2(0.74, 0.1)) - 0.04;
  float b4 = seg(q, vec2(0.62, 0.0), vec2(0.74, -0.1)) - 0.04;
  float hub = r - 0.14;
  return min(min(min(arm, hub), min(b1, b2)), min(b3, b4));
}
float tri(vec2 p, float cx, float w, float h, float base) {
  // A peak at (cx, base + h), its foot w wide either side.
  float dy = p.y - base;
  float edge = abs(p.x - cx) * (h / w) + dy - h;
  return max(edge, -dy);
}
float mountain(vec2 p) {
  float big = tri(p, -0.08, 0.72, 1.18, -0.62);
  float small = tri(p, 0.42, 0.42, 0.72, -0.62);
  return min(big, small) / 1.4;
}
float bolt(vec2 p) {
  vec2 a = vec2(0.22, 0.86);
  vec2 b = vec2(-0.26, 0.04);
  vec2 c = vec2(0.14, 0.02);
  vec2 d = vec2(-0.22, -0.86);
  float t = 0.13 - 0.05 * clamp(-p.y, 0.0, 1.0);
  return min(min(seg(p, a, b), seg(p, b, c)), seg(p, c, d)) - t;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec2 g = p * 1.32;
  float d = uShape < 0.5 ? flame(g) : uShape < 1.5 ? flake(g) : uShape < 2.5 ? mountain(g) : bolt(g);
  float r = length(p);
  // The dark disc it sits on, the colour's halo round it.
  float disc = 1.0 - smoothstep(0.78, 0.84, r);
  float ring = smoothstep(0.7, 0.78, r) * (1.0 - smoothstep(0.84, 0.92, r));
  float halo = (1.0 - smoothstep(0.6, 1.0, r)) * 0.55;
  float fill = 1.0 - smoothstep(-0.015, 0.015, d);
  float edge = (1.0 - smoothstep(0.0, 0.07, abs(d))) * (1.0 - fill * 0.5);
  float glow = exp(-max(d, 0.0) * 11.0);
  vec3 hot = mix(uColor, vec3(1.0), 0.55);
  vec3 col = vec3(0.04, 0.035, 0.05) * disc;
  col = mix(col, uColor * 0.55, halo * (1.0 - disc));
  col += uColor * ring * 1.4 * uPulse;
  col += uColor * glow * 0.9 * disc;
  col = mix(col, hot * (0.85 + 0.25 * uPulse), fill);
  col += vec3(1.0) * edge * 0.35;
  float a = max(disc * 0.82, max(halo * 0.6, max(ring, fill)));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = pow(max(1.0 - r, 0.0), 2.2) * uAlpha;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35 * a) * a, a);
}
`;

export const STEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;
uniform float uHot;
varying vec2 vUv;
${KIT_NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float body = 1.0 - smoothstep(0.25, 1.0, r);
  vec2 q = p * 1.8 + vec2(uSeed * 7.1, uSeed * 3.3);
  float churn = kfbm(q + vec2(uTime * 0.18, -uTime * 0.32));
  float fine = kfbm(q * 2.3 - vec2(uTime * 0.4, uTime * 0.1));
  float m = body * smoothstep(0.22, 0.75, churn * 0.75 + fine * 0.45 + body * 0.35);
  // Lit from above, a warm scald glowing under it.
  float lit = 0.78 + 0.22 * (p.y * 0.5 + 0.5) + 0.12 * fine;
  vec3 col = vec3(0.96, 0.97, 0.99) * lit;
  col = mix(col, vec3(1.0, 0.82, 0.62), uHot * (1.0 - smoothstep(-1.0, 0.1, p.y)) * 0.45);
  gl_FragColor = vec4(col, clamp(m * uAlpha, 0.0, 0.92));
}
`;

export const WALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;
varying vec2 vUv;
${KIT_NOISE}
void main() {
  float x = vUv.x;
  float y = vUv.y;
  // Tongues: each column's own height, licking up and down.
  float h = 0.42 + 0.5 * kfbm(vec2(x * 6.0 + uSeed, uTime * 1.6));
  float flick = kfbm(vec2(x * 9.0 + uSeed * 3.0, y * 3.0 - uTime * 4.2));
  float shape = smoothstep(h + 0.12, h - 0.25, y + (flick - 0.5) * 0.35);
  float sides = smoothstep(0.0, 0.08, x) * smoothstep(1.0, 0.92, x);
  float heat = clamp(1.0 - y / max(h, 0.05), 0.0, 1.0);
  vec3 col = mix(vec3(0.55, 0.06, 0.02), vec3(1.0, 0.45, 0.08), smoothstep(0.0, 0.45, heat));
  col = mix(col, vec3(1.0, 0.92, 0.66), smoothstep(0.62, 0.98, heat));
  col *= 0.75 + 0.6 * flick;
  float a = shape * sides * uAlpha * (0.65 + 0.35 * flick);
  gl_FragColor = vec4(col * a, a);
}
`;

export const AURA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uKind;
uniform float uStrength;
uniform vec3 uColor;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${KIT_NOISE}
void main() {
  vec3 n = normalize(vObj);
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 1.6);
  float ang = atan(n.x, n.z);
  float pat;
  if (uKind < 0.5) {
    // Fire licking up.
    float f = kfbm(vec2(ang * 2.2, n.y * 2.6 - uTime * 2.4));
    pat = smoothstep(0.45, 0.85, f + (0.4 - n.y) * 0.35);
  } else if (uKind < 1.5) {
    // Frost: hard crystalline cells, glinting.
    float c = kn(vec2(ang * 5.0, n.y * 6.0));
    pat = smoothstep(0.55, 0.62, c) * 0.6 + smoothstep(0.96, 1.0, sin(ang * 9.0 + n.y * 13.0 - uTime * 1.5)) * 0.8;
  } else if (uKind < 2.5) {
    // Storm forks crawling, re-seeded in quick steps.
    float t = floor(uTime * 12.0);
    float f1 = pow(max(kridge(vec2(ang * 2.6 + t * 0.37, n.y * 3.0 + uTime * 0.5)), 0.0), 12.0);
    float f2 = pow(max(kridge(vec2(ang * 3.1 - uTime * 0.6, n.y * 2.4 + t * 0.21)), 0.0), 14.0);
    pat = max(f1, f2) * 1.4;
  } else {
    // Cracked stone: dark plates, hot seams.
    float c = kridge(vec2(ang * 3.0, n.y * 3.4));
    pat = pow(max(c, 0.0), 8.0) * 1.2;
  }
  float s = clamp(uStrength, 0.0, 1.5);
  vec3 col = uColor * (fres * 0.9 + pat * 1.3) * (0.5 + 0.7 * s) + vec3(1.0) * pat * pat * 0.35 * s;
  float a = clamp((fres * 0.55 + pat * 0.9) * (0.35 + 0.65 * s), 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}
`;

export const SOLID_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vCol;
varying vec3 vObj;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 nn = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    nn = mat3(instanceMatrix) * nn;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(1.0);
  #endif
  vObj = position;
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * nn);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const SOLID_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIce;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vView;
varying vec3 vCol;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float fres = pow(max(1.0 - abs(dot(n, v)), 0.0), 2.0);
  // A fixed key light from above and behind the camera's left, a fill.
  float key = max(dot(n, normalize(vec3(-0.35, 0.85, 0.4))), 0.0);
  float facet = 0.55 + 0.45 * key;
  // Ice reads cold and lit from within; stone reads matte.
  float ice = clamp(vCol.b - vCol.r * 0.6, 0.0, 1.0) * uIce;
  vec3 col = vCol * facet + vec3(0.75, 0.9, 1.0) * fres * (0.25 + 0.9 * ice);
  float glint = smoothstep(0.985, 1.0, sin((vObj.x + vObj.y * 1.7 + vObj.z) * 4.0 - uTime * 2.5)) * ice;
  col += vec3(1.0) * glint;
  gl_FragColor = vec4(col, uAlpha * (0.88 + 0.12 * fres));
}
`;

export const SPIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uVeins;
uniform float uFire;
uniform float uSeed;
uniform vec3 uVein;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${KIT_NOISE}
void main() {
  vec3 n = normalize(vN);
  float fres = pow(max(1.0 - abs(dot(n, normalize(vView))), 0.0), 2.0);
  float key = max(dot(n, normalize(vec3(-0.35, 0.85, 0.4))), 0.0);
  float ang = atan(vObj.x, vObj.z);
  vec2 q = vec2(ang * 1.7 + uSeed, vObj.y * 0.55);
  float grain = kfbm(q * 3.0);
  vec3 stone = vec3(0.13, 0.12, 0.16) * (0.55 + 0.7 * key) * (0.8 + 0.4 * grain);
  // The veins: ridged lines running up the stone, lit from the foot first.
  float vein = pow(max(kridge(q * vec2(1.6, 1.1) + vec2(0.0, -uTime * 0.25)), 0.0), 18.0);
  float climb = smoothstep(uVeins * 1.25 - 0.15, uVeins * 1.25 - 0.45, vObj.y / 12.0);
  float flick = 0.75 + 0.25 * sin(uTime * 23.0 + vObj.y * 2.0) * uVeins;
  float lit = vein * climb * flick * (0.4 + 1.8 * uVeins) + uFire * vein * 2.0;
  vec3 col = stone + uVein * lit * 1.6 + vec3(1.0) * lit * lit * 0.4 + uVein * fres * 0.25 * uVeins;
  gl_FragColor = vec4(col, 1.0);
}
`;
