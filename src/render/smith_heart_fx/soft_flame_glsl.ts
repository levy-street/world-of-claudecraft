// Soft, organic fire and smoke for the Smith's Heart's floor fire (the second
// polish pass of 2026-11-24: Jose read the pools' flames as rows of regular
// little cones and the Firestorm wall's base as flat card edges). A flame here
// is no ribbon with a geometric outline: it is a camera-facing card whose
// whole silhouette is noise. Turbulence rises through it, a slower field warps
// it side to side, its tip is eaten into licks and holes, its edges fade
// over a wide band and its root melts into the floor (alpha 0 at the foot),
// so a crowd of them, each on its own height, phase and clock, reads as one
// living fire, never a row of teeth.
//
//   SOFT_FIRE_COMMON  the vertex helpers: a flame card standing on a foot,
//                     turned to the camera round the vertical; a smoke card
//                     turned fully to the camera; a cheap GLSL hash;
//   softFlameFrag     the flame (additive, on a fire ramp);
//   SOFT_SMOKE_FRAG   a smoke puff (normal blend: soot, its underside lit
//                     warm by the fire under it);
//   SOFT_GLOW_FRAG    the heat glow on the floor under a fire (additive,
//                     soft to nothing at its rim, flickering).
//
// Every vertex program places its points through `wocCamRelView` (world
// points, camera-relative). Strings only.

/** Shared by every soft fire vertex program. */
export const SOFT_FIRE_COMMON = /* glsl */ `
float sfHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
// A flame card: its foot, its height and half width (yards), its lean at the
// tip (xz yards), the card's corner (x -1..1 across, y 0..1 up). Turned to
// the camera round the vertical, so it stands up from any side.
vec3 sfFlameCard(vec3 foot, float hgt, float halfW, vec2 lean, vec2 corner) {
  vec3 toCam = cameraPosition - foot;
  toCam.y = 0.0;
  float l = length(toCam);
  vec3 f = l > 1e-4 ? toCam / l : vec3(0.0, 0.0, 1.0);
  vec3 side = vec3(f.z, 0.0, -f.x);
  float v = corner.y;
  return foot + side * corner.x * halfW + vec3(lean.x * v * v, v * hgt, lean.y * v * v);
}
// A smoke card: its centre and half size, turned fully to the camera.
vec3 sfSmokeCard(vec3 c, float halfS, vec2 corner) {
  vec3 toCam = normalize(cameraPosition - c);
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + vec3(1e-5, 0.0, 0.0));
  vec3 up = cross(toCam, side);
  return c + (side * corner.x + up * corner.y) * halfS;
}
`;

/** Value noise and a three-octave fbm (cheap). */
const SF_NOISE = /* glsl */ `
float sfh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sfn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sfh(i), sfh(i + vec2(1.0, 0.0)), u.x), mix(sfh(i + vec2(0.0, 1.0)), sfh(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sffbm(vec2 p) {
  return sfn(p) * 0.55 + sfn(p * 2.07 + 1.7) * 0.3 + sfn(p * 4.13 + 3.1) * 0.15;
}
`;

/** The flame (additive; with the `SOFT_DARK` define, its dark body under it,
 *  normal blend). Varyings: vUv (0..1 across, 0..1 up), vSeed, vAlpha
 *  (its life and the owner's mask), vHeat (0..1: how hot it burns). */
export function softFlameFrag(rampGlsl: string): string {
  return /* glsl */ `
uniform float uTime;
uniform float uHeat;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHeat;
${SF_NOISE}
${rampGlsl}
void main() {
  if (vAlpha <= 0.003) discard;
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;
  float s = vSeed * 31.0;
  float t = uTime * (0.85 + 0.35 * vSeed);
  // The column wanders side to side as it climbs (more the higher it goes).
  float wob = (sffbm(vec2(y * 2.2 - t * 2.1, s)) - 0.5) * 0.8 * y;
  float xx = x - wob;
  // Turbulence rising through it (stretched up, as flame is), and a finer
  // field: it eats the outline into licks and the tip into tongues.
  vec2 nq = vec2(xx * 2.3 + s, y * 2.0 - t * 2.6);
  float n = sffbm(nq + vec2(sffbm(nq * 0.6 - vec2(0.0, t * 0.7)) - 0.5, 0.0) * 1.2);
  n = clamp((n - 0.5) * 1.8 + 0.5, 0.0, 1.0);
  float n2 = sfn(vec2(xx * 5.0 - s, y * 5.5 - t * 4.4));
  // A teardrop: round at its root, widest low, drawn up to a point; its
  // width breathing with the turbulence (no edge of its own).
  float w = 0.78 * sqrt(clamp(y / 0.16, 0.0, 1.0)) * pow(max(1.0 - y, 0.0), 0.85);
  float edge = max(w * (0.55 + 0.85 * n), 1e-3);
  float I = 1.0 - smoothstep(0.0, edge, abs(xx));
  I = pow(I, 0.7);
  // The tip breaks into tongues; holes open in the upper flame.
  I *= 1.0 - smoothstep(0.42, 0.95, y + (0.5 - n) * 0.55);
  I -= smoothstep(0.55, 0.95, n2) * smoothstep(0.25, 0.8, y) * 0.55;
  // Never a card edge: the sides and the root fade out.
  I = clamp(I, 0.0, 1.0) * (1.0 - smoothstep(0.85, 1.0, abs(x))) * smoothstep(0.0, 0.1, y);
#ifdef SOFT_DARK
  // The fire's dark body (normal blend, drawn first): a smoky deep-red mass a
  // little wider than the flame, so the bright fire has a dark edge and reads
  // as a body over a bright floor, never a see-through glow.
  float body = smoothstep(0.0, 0.3, I) * (1.0 - 0.5 * y);
  vec3 dark = mix(vec3(0.2, 0.04, 0.01), vec3(0.05, 0.025, 0.02), smoothstep(0.1, 0.9, y));
  gl_FragColor = vec4(dark, body * 0.6 * vAlpha);
#else
  // A hot core low in the flame, orange through it, deep red at its edges
  // and tips (only the heart of a flame runs yellow).
  float heat = pow(clamp(I, 0.0, 1.0), 1.35) * uHeat * vHeat * (1.0 - 0.45 * y);
  vec3 col = fireRamp(heat);
  float a = smoothstep(0.0, 0.45, I) * vAlpha * 0.9;
  gl_FragColor = vec4(col, a);
#endif
}
`;
}

/** A smoke puff (normal blend). Varyings: vUv, vSeed, vAlpha, vHeat (how lit
 *  its underside is by the fire under it). */
export const SOFT_SMOKE_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
varying float vHeat;
${SF_NOISE}
void main() {
  if (vAlpha <= 0.003) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec2 q = p * 1.5 + vec2(vSeed * 9.1, vSeed * 4.7 - uTime * 0.25);
  float n = sffbm(q + vec2(sffbm(q * 0.9 + uTime * 0.12), 0.0) * 0.8);
  float body = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.7);
  vec3 soot = mix(vec3(0.045, 0.036, 0.034), vec3(0.2, 0.17, 0.16), n);
  // Its underside lit warm by the fire under it.
  vec3 lit = vec3(0.55, 0.2, 0.05);
  vec3 col = mix(soot, lit, clamp((0.2 - p.y) * 0.9, 0.0, 1.0) * vHeat * 0.8);
  gl_FragColor = vec4(col, body * body * vAlpha);
}
`;

/** The heat glow on the floor under a fire (additive): vUv 0..1 over a disc
 *  (or a strip), soft to nothing at its rim, breathing on the noise. */
export const SOFT_GLOW_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vAlpha;
${SF_NOISE}
void main() {
  if (vAlpha <= 0.003) discard;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float n = sffbm(p * 3.0 + vec2(vSeed * 7.0, uTime * 0.7));
  float hot = smoothstep(0.35, 0.75, n);
  float k = (1.0 - smoothstep(0.2, 1.0, r)) * (0.25 + 1.1 * hot);
  vec3 col = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.55, 0.16), k * k);
  gl_FragColor = vec4(col, k * vAlpha);
}
`;
