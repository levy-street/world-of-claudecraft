// Weight of the Anvil's shaders (final_anvil_fx.ts builds them; the plan is
// final_anvil_core.ts). Strings only (no Three, no state). Every vertex goes
// through `modelViewMatrix` (camera-relative: the Heart sits in an instance
// band far from the world's origin); every noise runs on the mesh's own
// coordinates.
//
//   RUNES   the mark's countdown on the floor: six runes round its rim
//           kindling one a second, a heat haze filling the circle, the
//           closing ring sliding in onto the rim as the anvil drops. Its
//           local units are the mark's radius (the mesh is scaled by it).
//   COLUMN  the column of heat from the anvil down to its mark (and, the same
//           program, the streak above it as it falls): soft at its edges,
//           shimmering up, hottest at its foot.
//   SEAMS   drawn over the anvil's own stone: molten seams cracking through
//           it and a band of runes round its waist, both burning hotter as
//           it falls (additive, the same geometry).
//   SCAR    the strike's mark on the floor: a white-hot crater cooling
//           through orange to dull red, jagged cracks racing out of it.

const NOISE = /* glsl */ `
float ah(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float an(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ah(i), ah(i + vec2(1.0, 0.0)), f.x), mix(ah(i + vec2(0.0, 1.0)), ah(i + vec2(1.0, 1.0)), f.x), f.y);
}
float afbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * an(p);
    p = p * 2.03 + vec2(7.1, 3.7);
    a *= 0.5;
  }
  return s;
}
vec3 heatRamp(float k) {
  // Dull red, orange, gold, white.
  vec3 c = mix(vec3(0.55, 0.06, 0.01), vec3(1.0, 0.36, 0.05), smoothstep(0.0, 0.4, k));
  c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.35, 0.75, k));
  return mix(c, vec3(1.0, 0.96, 0.85), smoothstep(0.75, 1.0, k));
}
`;

/** A flat floor piece: its local xz handed on. */
export const ANVIL_FLOOR_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ANVIL_RUNES_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uLit[6];
uniform float uHeat;
uniform float uClose;
uniform float uCloseA;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vLocal;
const float TAU = 6.2831853;
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.x, vLocal.y);
  float a01 = fract(ang / TAU + 1.0);
  // ---- the runes round the rim ----
  float seg = a01 * 6.0;
  float idx = floor(seg);
  float within = fract(seg);
  float lit = 0.0;
  for (int i = 0; i < 6; i++) if (abs(float(i) - idx) < 0.5) lit = uLit[i];
  float band = smoothstep(0.7, 0.74, r) * (1.0 - smoothstep(0.97, 1.0, r));
  // A glyph in each slot: strokes hashed off the slot, inside a frame.
  vec2 g = vec2((within - 0.5) * 2.0, (r - 0.855) / 0.11);
  float frame = step(0.12, within) * step(within, 0.88);
  float h = ah(vec2(idx, 3.0));
  float stroke = 0.0;
  stroke = max(stroke, 1.0 - smoothstep(0.09, 0.18, abs(g.x - (h - 0.5) * 0.9)));
  stroke = max(stroke, (1.0 - smoothstep(0.1, 0.2, abs(g.y - (ah(vec2(idx, 7.0)) - 0.5) * 1.2))) * step(abs(g.x), 0.6));
  stroke = max(stroke, 1.0 - smoothstep(0.1, 0.2, abs(g.x + g.y * (ah(vec2(idx, 11.0)) - 0.5) * 1.6)));
  stroke *= frame * step(abs(g.y), 0.95);
  // Unlit runes still show as dark carved slots (the countdown's places).
  float glyph = band * stroke;
  float ember = 0.85 + 0.15 * sin(uTime * 9.0 + idx * 1.7);
  // A kindled slot glows behind its glyph too (a lit rune reads from afar).
  float slotGlow = band * frame * lit * 0.35;
  vec3 col = uColor * ((0.18 + 2.4 * lit * ember) * glyph + slotGlow);
  float alpha = glyph * (0.22 + 0.78 * lit) + slotGlow;
  // The rim's thin line between the slots, lit with the count.
  float rim = (1.0 - smoothstep(0.004, 0.02, abs(r - 0.72))) + (1.0 - smoothstep(0.004, 0.02, abs(r - 0.985)));
  float total = 0.0;
  for (int i = 0; i < 6; i++) total += uLit[i];
  col += uColor * rim * (0.25 + 0.15 * total);
  alpha += rim * 0.5;
  // ---- the heat filling the circle as it falls ----
  float haze = (1.0 - smoothstep(0.0, 0.72, r)) * uHeat;
  float n = afbm(vLocal * 3.0 + vec2(0.0, -uTime * 0.7));
  float cells = smoothstep(0.55, 0.75, afbm(vLocal * 5.0 + 1.7));
  vec3 hz = heatRamp(uHeat * 0.85) * haze * (0.18 + 0.4 * n + 0.6 * cells * uHeat);
  col += hz;
  alpha += length(hz) * 0.4;
  // ---- the closing ring: onto the rim as it drops ----
  float cl = (1.0 - smoothstep(0.0, 0.05, abs(r - uClose))) * uCloseA;
  float clGlow = (1.0 - smoothstep(0.0, 0.22, abs(r - uClose))) * uCloseA * 0.35;
  col += vec3(1.0, 0.95, 0.8) * cl * 1.6 + uColor * clGlow;
  alpha += cl + clGlow;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uAlpha);
}
`;

/** A body piece: uv, local position, normal and view direction. */
export const ANVIL_BODY_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
void main() {
  vUv = uv;
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const ANVIL_COLUMN_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uAlpha;
uniform float uHeat;
uniform float uDown;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float soft = pow(facing, 1.6);
  // uDown 1: the column (hot at its foot); 0: the streak (hot at its head).
  float h = mix(vUv.y, 1.0 - vUv.y, uDown);
  float along = mix(1.0 - h, h, uDown);
  float flow = an(vec2(vUv.x * 9.0, vUv.y * 4.0 - uTime * mix(3.0, -6.0, uDown)));
  float k = soft * (0.35 + 0.65 * flow) * (0.25 + 0.75 * along);
  k *= smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
  vec3 col = heatRamp(uHeat * (0.55 + 0.45 * along));
  gl_FragColor = vec4(col * k * 1.4, k * uAlpha);
}
`;

export const ANVIL_SEAMS_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uHeat;
uniform float uScale;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 p = vObj * uScale;
  // Seams: ridged noise on the stone's own points (three planes blended by
  // the normal, so no stretch on any face).
  vec3 w = abs(normalize(vN));
  w /= (w.x + w.y + w.z);
  float rx = 1.0 - abs(an(p.yz * 1.3) * 2.0 - 1.0);
  float ry = 1.0 - abs(an(p.xz * 1.3 + 4.0) * 2.0 - 1.0);
  float rz = 1.0 - abs(an(p.xy * 1.3 + 9.0) * 2.0 - 1.0);
  float ridge = rx * w.x + ry * w.y + rz * w.z;
  // Thin seams that widen a little as it heats (never blobs over the
  // carving).
  float seam = smoothstep(0.935 - 0.03 * uHeat, 0.985, ridge);
  // A band of runes round its waist: hashed strokes in cells.
  float waist = 1.0 - smoothstep(0.0, 0.5, abs(p.y - 2.6));
  vec2 cell = vec2(atan(p.x, p.z) * 4.0 + p.x * 0.6, p.y * 2.4);
  vec2 ci = floor(cell);
  vec2 cf = fract(cell) - 0.5;
  float hk = ah(ci);
  float glyph = 1.0 - smoothstep(0.04, 0.1, min(abs(cf.x - (hk - 0.5) * 0.5), abs(cf.y + cf.x * (hk - 0.5))));
  glyph *= step(0.35, hk) * waist * step(abs(cf.y), 0.4);
  float pulse = 0.8 + 0.2 * sin(uTime * 6.0 + p.y * 2.0);
  float k = (seam * (0.5 + 2.2 * uHeat) + glyph * (0.25 + 1.8 * uHeat)) * pulse;
  // Its edges hotter as the air rushes past (a rim of heat).
  float rim = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  k += rim * rim * uHeat * 0.5;
  gl_FragColor = vec4(heatRamp(0.08 + 0.85 * uHeat) * k, 1.0);
}
`;

export const ANVIL_SCAR_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uScar;
uniform float uSpread;
varying vec2 vLocal;
const float TAU = 6.2831853;
void main() {
  // Local units: the scar's full reach is 1.
  float r = length(vLocal);
  float ang = atan(vLocal.x, vLocal.y);
  // Jagged spokes racing out: a hashed count of cracks, each wandering.
  float wob = (afbm(vec2(ang * 3.0, r * 6.0)) - 0.5) * 0.9;
  float spokes = abs(fract((ang + wob * 0.25) / TAU * 13.0) - 0.5) * 2.0;
  float crack = 1.0 - smoothstep(0.0, 0.07 + 0.05 * (1.0 - r), spokes);
  // Each spoke reaches its own length.
  float reach = 0.55 + 0.45 * ah(vec2(floor((ang + wob * 0.25) / TAU * 13.0), 2.0));
  crack *= 1.0 - smoothstep(reach * uSpread * 0.85, reach * uSpread, r);
  // A web of finer cracks near the middle.
  float web = smoothstep(0.62, 0.7, 1.0 - abs(an(vLocal * 9.0) * 2.0 - 1.0)) * (1.0 - smoothstep(0.15, 0.45, r));
  // The crater's molten floor.
  float pool = 1.0 - smoothstep(0.12, 0.26, r + (afbm(vLocal * 6.0 + uTime * 0.2) - 0.5) * 0.08);
  float k = max(max(crack, web * 0.8), pool);
  // Cooling: the cracks first, the crater last.
  float heat = uScar * mix(0.75, 1.0, pool);
  float flick = 0.85 + 0.15 * an(vLocal * 12.0 + uTime * 3.0);
  vec3 col = heatRamp(heat) * k * flick * (0.4 + 1.6 * heat);
  float alpha = k * clamp(heat * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;
