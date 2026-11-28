// The Smith's Heart loot coffer's own programs (loot_coffer_fx.ts): the
// forge iron of its body and lid (unlit and painted, lit from above, the
// molten light inside bouncing onto the iron near it), the shaft of golden
// light out of it, and the floor's molten ring and pool. Every positioned
// mesh goes through three's modelViewMatrix on a stage laid at the coffer's
// feet, never a world point a hundred thousand yards out. No pow(): the
// soft falloffs square clamped terms.

/** The iron: vertex colour lit by a fake sky key, its rim catching the
 *  accent, and the coffer's own light (`uHeart`, in view space) bouncing
 *  onto everything near it. */
export const COFFER_IRON_VERT = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vView;
varying float vUp;
void main() {
  vCol = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  vN = normalize(normalMatrix * normal);
  vUp = normalize(mat3(modelMatrix) * normal).y;
  gl_Position = projectionMatrix * mv;
}
`;

export const COFFER_IRON_FRAG = /* glsl */ `
uniform vec3 uHeart;
uniform vec3 uGlowCol;
uniform float uGlow;
uniform vec3 uAccent;
uniform float uFade;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vView;
varying float vUp;
void main() {
  vec3 n = normalize(vN);
  float key = 0.5 + 0.5 * clamp(vUp, -1.0, 1.0);
  float facing = clamp(abs(dot(n, normalize(-vView))), 0.0, 1.0);
  float rim = (1.0 - facing) * (1.0 - facing);
  vec3 toHeart = vView - uHeart;
  float d2 = dot(toHeart, toHeart);
  float bounce = uGlow / (1.0 + d2 * 1.4);
  vec3 c = vCol * (0.5 + 0.85 * key)
    + vCol * uGlowCol * bounce * 1.8
    + uAccent * rim * (0.08 + 0.22 * uGlow);
  gl_FragColor = vec4(c * uFade, 1.0);
}
`;

/** The shaft and its halo: an open tube, soft at its silhouette, gone by its
 *  crown, streaks of light racing up it. Additive. */
export const COFFER_SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;

export const COFFER_SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uStreaks;
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
  float y = vUv.y;
  float top = 1.0 - smoothstep(0.25, 1.0, y);
  float foot = smoothstep(0.0, 0.05, y);
  float f = clamp(vFacing, 0.0, 1.0);
  float body = f * f;
  float s = n2(vec2(vUv.x * 22.0, y * 7.0 - uTime * 1.7));
  float streak = mix(1.0, 0.45 + 1.1 * s * s, uStreaks);
  float a = body * top * top * foot * streak * uAlpha;
  if (a <= 0.002) discard;
  vec3 col = mix(uColor, vec3(1.0, 0.97, 0.88), body * foot * (1.0 - y) * 0.5);
  gl_FragColor = vec4(col * a, a);
}
`;

/** The floor under the coffer: a pool of its light and the molten ring it
 *  climbs out of, the ring broken into glowing cracks. Additive. */
export const COFFER_FLOOR_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const COFFER_FLOOR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRingColor;
uniform float uPool;
uniform float uRing;
uniform float uRingAlpha;
uniform float uTime;
varying vec2 vP;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float r = length(vP);
  float g = max(1.0 - r, 0.0);
  float pool = g * g * uPool;
  float w = 0.05 + 0.05 * uRing;
  float band = 1.0 - smoothstep(0.0, w, abs(r - uRing));
  // atan(0, 0) is undefined (a NaN into the bloom): the centre takes 0.
  float a = r < 1e-4 ? 0.0 : atan(vP.y, vP.x);
  float crack = 0.55 + 0.45 * h1(floor(a * 9.0) + 3.0);
  float flick = 0.85 + 0.15 * sin(uTime * 9.0 + a * 5.0);
  float ring = band * crack * flick * uRingAlpha;
  float inner = max(1.0 - r / max(uRing, 0.05), 0.0);
  float wash = inner * inner * uRingAlpha * 0.35;
  vec3 col = uColor * pool + uRingColor * (ring * 1.6 + wash);
  float al = pool + ring + wash;
  if (al <= 0.002) discard;
  gl_FragColor = vec4(col, al);
}
`;
