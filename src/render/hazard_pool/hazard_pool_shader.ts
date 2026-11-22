// The hazard pool's one shader program, shared by every style and by static
// and dynamic pools (style and life are uniforms; per-pool data rides vertex
// attributes), so linking it once anywhere links it for all of them.
//
// Dense, glossy tar with an organic edge and no drawn outline:
//  - the edge wanders OUTWARD only (aInfo.y is the margin past the damage
//    radius), so inside the radius the tar is always full;
//  - where the tar thins at its edge its own sickly light shows through, broken
//    by noise so long stretches of edge stay plain glossy black;
//  - a view-angle sheen and slow ripple glints make it read wet;
//  - a thick style darkens toward its centre and bulges (vertex dome).
// Unlit colour math only: identical on every graphics tier, no bloom needed.
// Noise is sampled in pool-local yards (aLocal), never in world space: delve
// and dungeon interiors sit far out in the instance band, where a float32
// world coordinate loses the precision the noise needs. The position goes
// through modelViewMatrix, which three builds on the CPU in double precision.

const NOISE_GLSL = /* glsl */ `
float hpHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hpNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hpHash(i), hpHash(i + vec2(1.0, 0.0)), u.x),
             mix(hpHash(i + vec2(0.0, 1.0)), hpHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float hpFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * hpNoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}
`;

export const HAZARD_POOL_VERT = /* glsl */ `
uniform float uLift;
uniform float uDome;
attribute vec2 aPool;
attribute vec2 aLocal;
attribute vec3 aInfo;
varying vec2 vPool;
varying vec2 vLocal;
varying vec3 vInfo;
varying vec3 vView;
varying vec3 vUp;
#include <fog_pars_vertex>
void main() {
  vPool = aPool;
  vLocal = aLocal;
  vInfo = aInfo;
  float d2 = dot(aPool, aPool);
  vec3 pos = position;
  pos.y += uLift + uDome * max(0.0, 1.0 - d2);
  // Name this mvPosition: the fog_vertex chunk reads it for vFogDepth.
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  vView = -mvPosition.xyz;
  vUp = normalMatrix * vec3(0.0, 1.0, 0.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const HAZARD_POOL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uBase;
uniform vec3 uFilm;
uniform vec3 uGlow;
uniform vec3 uSheen;
uniform float uThick;
uniform float uFilmAmt;
uniform float uBody;
uniform float uArming;
uniform float uFade;
varying vec2 vPool;
varying vec2 vLocal;
varying vec3 vInfo;
varying vec3 vView;
varying vec3 vUp;
#include <common>
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float d = length(vPool);
  float r = max(vInfo.x, 0.1);
  float seed = vInfo.z;
  // Organic, outward-only edge: lobes and fine ripple on top of the radius.
  float lobes = hpFbm(vLocal * 0.55 + seed);
  float fine = hpNoise(vLocal * 1.9 - seed);
  float wander = clamp(0.15 + 0.95 * smoothstep(0.3, 0.8, lobes) + 0.25 * (fine - 0.5), 0.0, 1.0);
  float edgeR = 1.0 + vInfo.y * wander;
  float softN = 0.12 / r;
  float shape = 1.0 - smoothstep(edgeR, edgeR + softN, d);
  if (shape <= 0.0) discard;

  // Yards in from the edge: thin tar near it, dense tar inside.
  float inYd = (edgeR - d) * r;
  float thin = 1.0 - smoothstep(0.0, 1.1, inYd);
  float edgeVar = smoothstep(0.38, 0.78, hpFbm(vLocal * 0.33 + seed * 1.7));
  vec2 flow = vec2(uTime * 0.035, -uTime * 0.025);
  float n1 = hpFbm(vLocal * 0.45 + seed + flow);

  vec3 col = uBase * (0.75 + 0.5 * n1);
  col += uFilm * (0.22 * (0.5 + 0.7 * n1)) * (1.0 - 0.6 * uThick);
  col += uFilm * thin * edgeVar * 0.55;
  col += uGlow * thin * thin * edgeVar * 0.42;
  // A thick pool is darker and denser toward its centre.
  float core = 1.0 - smoothstep(0.0, 0.9, d);
  col *= 1.0 - 0.45 * uThick * core;

  // Gloss: stronger sheen at grazing angles, slow ripple glints.
  float facing = clamp(dot(normalize(vView), normalize(vUp)), 0.0, 1.0);
  float graze = (1.0 - facing) * (1.0 - facing);
  float rip = hpFbm(vLocal * 1.25 + seed + flow * 1.4);
  float sheen = smoothstep(0.40, 0.80, rip);
  col += uSheen * (0.25 + 0.9 * graze) * (0.35 + 0.9 * sheen) * (0.8 + 0.4 * uThick);
  float streak = hpFbm(vec2(vLocal.x * 0.6, vLocal.y * 2.6) + seed + flow * 2.0);
  float glint = smoothstep(0.70, 0.73, streak) * (1.0 - smoothstep(0.73, 0.79, streak));
  glint *= smoothstep(0.55, 0.72, rip);
  col += vec3(0.85, 0.83, 0.90) * glint * (0.35 + 0.25 * uThick);

  // A boss-dropped pool's life: the film covers the whole footprint at once,
  // the thick body spreads from the centre, and it pulses until it arms.
  float spread = mix(0.3, 1.25, uBody);
  float body = (1.0 - smoothstep(spread - 0.18, spread, d)) * uBody;
  float arm = uArming * (0.55 + 0.45 * sin(uTime * 8.0));
  col += uGlow * arm * 0.45 * (0.35 + 0.65 * (1.0 - body));

  float alpha = mix(0.5 * uFilmAmt, 0.93 + 0.05 * uThick, body) * shape;
  alpha *= 1.0 - 0.3 * thin * edgeVar;
  alpha *= 1.0 - uFade;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
