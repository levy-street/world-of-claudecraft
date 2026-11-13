// The Masterless Strength's quarter kits' body and floor-band shaders
// (final_kit_fx.ts builds them; final_kit_shapes.ts the geometry). Strings
// only (no Three, no state). Every vertex goes through `modelViewMatrix`
// (camera-relative: the Heart sits in an instance band far from the
// world's origin); every noise runs on the mesh's own coordinates.
//
//   WHIRL       a Fire Whirl: a funnel of flame twisting up on itself (the
//               vertex stage twists and swells it), bands of fire climbing,
//               ragged at its lip; the same source draws its white-hot core
//               (`uCoreK` 1).
//   ORB         a Storm Orb's shell: a fresnel rim of violet storm light and
//               forks of white crawling over it (noise on the sphere's own
//               points, so no seam), harder as it nears its burst.
//   ORB_CORE    its heart: a pulsing white-violet core.
//   SHELL       Stone Shell: granite plates round a player, gold cracks
//               between them, a fresnel rim so the body inside still reads.
//   ICE         Encased in Rime: rime-white facets, a bright fresnel edge,
//               glints sliding over it.
//   RIM         the gale's rim band: storm streaks racing round with the
//               wind, forks, a ragged inner edge carrying the threat's hot
//               line (the safe floor ends there).
//   UNBOUND     Heart Unbound's centre aura: a blazing ring of the four
//               veins' light, ragged flames licking in and out, hotter with
//               its stacks.
//   SHOCK       the switch's shockwave on the floor: four bands of the veins'
//               light racing out together, ragged, fading as they spread.

const NOISE = /* glsl */ `
float kh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(kh(i), kh(i + vec2(1.0, 0.0)), f.x), mix(kh(i + vec2(0.0, 1.0)), kh(i + vec2(1.0, 1.0)), f.x), f.y);
}
float kfbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * kn(p);
    p = p * 2.07 + vec2(11.3, 5.9);
    a *= 0.5;
  }
  return s;
}
float kridge(vec2 p) { return 1.0 - abs(kn(p) * 2.0 - 1.0); }
`;

/** Local-space uv and position (bodies). */
export const KIT_UV_VERT = /* glsl */ `
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

export const WHIRL_VERT = /* glsl */ `
uniform float uTime;
uniform float uTwist;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // Twist round the axis with the height and the time, and swell in bands
  // climbing the column.
  float a = p.y * uTwist + uTime * 5.5 + uSeed;
  float c = cos(a);
  float s = sin(a);
  float swell = 1.0 + 0.16 * sin(p.y * 9.0 - uTime * 7.0 + uSeed) + 0.08 * sin(p.y * 23.0 - uTime * 13.0);
  p.xz = mat2(c, -s, s, c) * p.xz * swell;
  // The column leans and sways a little at its top.
  p.x += sin(uTime * 1.7 + uSeed) * 0.12 * p.y * p.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const WHIRL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uCoreK;
uniform float uSeed;
uniform vec3 uCore;
uniform vec3 uFire;
varying vec2 vUv;
${NOISE}
void main() {
  float speed = mix(2.4, 4.2, uCoreK);
  vec2 q = vec2(vUv.x * 5.0 + vUv.y * 2.5 + uSeed, vUv.y * 2.6 - uTime * speed);
  float f = kfbm(q) * 0.8 + kn(q * 3.1 + 2.0) * 0.3;
  // Tongues licking up: bright bands, a ragged lip at the top.
  float lip = 1.0 - smoothstep(0.62, 1.0, vUv.y + (f - 0.5) * 0.5);
  float foot = smoothstep(0.0, 0.08, vUv.y);
  float body = smoothstep(0.32, 0.72, f) * lip * foot;
  float heat = clamp(f * 0.95 + (1.0 - vUv.y) * 0.25 + uCoreK * 0.15, 0.0, 1.0);
  // Deep orange-red at its ragged edges, amber in the body, gold only in
  // the hottest tongues: fire, never a white blob under the bloom.
  vec3 col = mix(uFire * vec3(0.85, 0.32, 0.1), uFire, smoothstep(0.25, 0.7, heat));
  col = mix(col, uCore, smoothstep(0.82, 1.0, heat) * mix(0.5, 0.8, uCoreK));
  gl_FragColor = vec4(col * (0.55 + 0.45 * heat), body * uAlpha * mix(0.75, 0.55, uCoreK));
}
`;

export const ORB_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrackle;
uniform vec3 uStorm;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${NOISE}
void main() {
  vec3 n = normalize(vObj);
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 2.2);
  // Forks crawling over the sphere: ridged noise on two planes of its own
  // points, re-seeded in quick steps (the flicker of lightning).
  float t = floor(uTime * 10.0);
  float f1 = pow(max(kridge(n.xy * 3.2 + vec2(t * 0.31, uTime * 0.4)), 0.0), 14.0);
  float f2 = pow(max(kridge(n.zy * 3.6 + vec2(-uTime * 0.5, t * 0.17)), 0.0), 16.0);
  float fork = max(f1, f2) * (0.5 + uCrackle * 1.1);
  float swirl = kfbm(n.xz * 2.0 + vec2(uTime * 0.3, -uTime * 0.25));
  vec3 col = uStorm * (0.25 + 0.9 * fres + 0.35 * swirl) + vec3(0.92, 0.9, 1.0) * fork;
  float a = clamp(0.12 + fres * 0.75 + fork * 0.8 + swirl * 0.12, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}
`;

export const ORB_CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrackle;
uniform vec3 uStorm;
varying vec3 vN;
varying vec3 vView;
void main() {
  float face = abs(dot(normalize(vN), normalize(vView)));
  float pulse = 0.75 + 0.25 * sin(uTime * (9.0 + 8.0 * uCrackle));
  vec3 col = mix(uStorm, vec3(1.0), smoothstep(0.4, 1.0, face)) * (1.2 + uCrackle) * pulse;
  gl_FragColor = vec4(col, smoothstep(0.0, 0.7, face) * 0.9);
}
`;

export const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uStone;
uniform vec3 uGold;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${NOISE}
float cellE(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(kh(i + g), kh(i + g + 17.3));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return d2 - d1;
}
void main() {
  vec3 n = normalize(vN);
  float fres = pow(max(1.0 - abs(dot(n, normalize(vView))), 0.0), 1.8);
  vec3 p = normalize(vObj);
  float seam = 1.0 - smoothstep(0.0, 0.08, cellE(vec2(atan(p.x, p.z) * 1.6, p.y * 2.6)));
  float key = 0.45 + 0.55 * max(0.0, n.y * 0.7 + 0.3);
  vec3 col = uStone * key * (0.8 + 0.2 * kn(p.xz * 5.0));
  col += uGold * seam * (0.8 + 0.3 * sin(uTime * 3.0 + p.y * 6.0));
  col += uGold * fres * 0.35;
  gl_FragColor = vec4(col, clamp(0.72 + seam * 0.25 + fres * 0.2, 0.0, 0.95));
}
`;

export const ICE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFrost;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
void main() {
  vec3 n = normalize(vN);
  float fres = pow(max(1.0 - abs(dot(n, normalize(vView))), 0.0), 1.5);
  float facet = 0.5 + 0.5 * abs(dot(n, normalize(vec3(0.3, 0.8, 0.5))));
  float glint = smoothstep(0.97, 1.0, sin((vObj.x + vObj.y * 1.3 + vObj.z) * 3.0 - uTime * 2.2));
  vec3 col = uFrost * (0.35 + facet * 0.45 + fres * 0.9) + vec3(1.0) * glint * 0.8;
  gl_FragColor = vec4(col, clamp(0.28 + fres * 0.55 + glint * 0.3, 0.0, 0.9));
}
`;

export const RIM_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uHeading;
uniform float uInner;
uniform float uOuter;
uniform float uDetail;
uniform vec3 uColor;
uniform vec3 uStorm;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.x, vLocal.z);
  // Ragged inner edge: where the safe floor ends.
  float rag = (kn(vec2(a * 18.0, uTime * 0.8)) - 0.5) * 1.1;
  float d = r - (uInner + rag);
  if (d < -0.6) discard;
  float band = clamp(d / max(uOuter - uInner, 0.1), 0.0, 1.0);
  float facing = 0.4 + 0.6 * max(0.0, cos(a - uHeading));
  // Streaks racing round with the wind, forks flickering through them.
  float streak = smoothstep(0.35, 1.0, sin(a * 60.0 - uTime * 10.0 + kn(vec2(a * 8.0, r)) * 4.0));
  float t = floor(uTime * 9.0);
  float fork = pow(max(kridge(vec2(a * 14.0 + t * 1.7, r * 0.9)), 0.0), 20.0);
  float edgeLine = 1.0 - smoothstep(0.0, 0.35, abs(d));
  float halo = 1.0 - smoothstep(0.0, 2.0, abs(d));
  vec3 col = uColor * (edgeLine * 1.4 + halo * 0.25) + mix(uColor, vec3(1.0), 0.35) * edgeLine * 0.4;
  col += uStorm * band * (0.18 + 0.4 * streak * uDetail) * facing;
  col += vec3(0.92, 0.9, 1.0) * fork * band * 0.8 * uDetail;
  col += uColor * smoothstep(0.85, 1.0, band) * 0.5;
  gl_FragColor = vec4(col * uAlpha * step(-0.6, d), 1.0);
}
`;

export const UNBOUND_FRAG = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform vec3 uHeat;
uniform vec3 uQuench;
uniform vec3 uBreath;
uniform vec3 uHammer;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.x, vLocal.z);
  float u = (a / 6.2831853) + 0.5;
  // The four veins' light chasing round the ring.
  float s = fract(u + uTime * 0.12) * 4.0;
  vec3 v0 = s < 1.0 ? uHeat : s < 2.0 ? uQuench : s < 3.0 ? uBreath : uHammer;
  vec3 v1 = s < 1.0 ? uQuench : s < 2.0 ? uBreath : s < 3.0 ? uHammer : uHeat;
  vec3 vein = mix(v0, v1, smoothstep(0.7, 1.0, fract(s)));
  // Flames licking in and out off the ring's line (7.5 yd), taller with
  // the stacks.
  float tongue = kfbm(vec2(a * 6.0, uTime * 2.2)) - 0.5;
  float line = 7.5 + tongue * (1.0 + 2.5 * uK);
  float d = abs(r - line);
  float core = 1.0 - smoothstep(0.0, 0.35 + 0.4 * uK, d);
  float glow = 1.0 - smoothstep(0.0, 1.6 + 2.0 * uK, d);
  float lick = smoothstep(0.45, 0.9, kn(vec2(a * 22.0, r * 1.5 - uTime * 3.0))) * glow;
  vec3 col = vein * (glow * 0.45 + lick * 0.6) + mix(vein, vec3(1.0), 0.6) * core * 1.2;
  gl_FragColor = vec4(col * (0.55 + 0.75 * uK), 1.0);
}
`;

export const SHOCK_FRAG = /* glsl */ `
uniform float uFront;
uniform float uAlpha;
uniform vec3 uHeat;
uniform vec3 uQuench;
uniform vec3 uBreath;
uniform vec3 uHammer;
varying vec3 vLocal;
${NOISE}
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.x, vLocal.z);
  float rag = (kn(vec2(a * 12.0, uFront * 0.3)) - 0.5) * 2.0;
  // Four bands just behind the front, one per vein.
  float d = uFront - r + rag;
  if (d < 0.0 || d > 9.0) discard;
  float k = d / 2.25;
  vec3 c = k < 1.0 ? uHeat : k < 2.0 ? uQuench : k < 3.0 ? uBreath : uHammer;
  float band = 1.0 - abs(fract(k) - 0.5) * 2.0;
  float lead = 1.0 - smoothstep(0.0, 0.6, d);
  vec3 col = c * (0.35 + 0.65 * band) + vec3(1.0, 0.95, 0.85) * lead * 0.8;
  gl_FragColor = vec4(col * uAlpha * (1.0 - d / 9.0), 1.0);
}
`;
