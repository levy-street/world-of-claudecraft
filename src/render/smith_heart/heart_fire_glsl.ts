// The Smith's Heart's fire in the air, shared by the veins whose air burns
// (the Quench's fire bowls, phase 2H; the Heat's Hearth, phase 2I): a
// flame's upright billboards, embers rising off a fire, a soft glow (a
// fire's halo, an ember, a warm pool on the floor). Texture-free, every
// motion in the vertex shader on the shared clock; the painters (quench_air.ts,
// heat_air.ts) build the meshes.

/** A brazier's flame: upright billboards (turned to the camera about the
 *  world's up), a flickering tongue of fire, white-gold at its heart. */
export const FLAME_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, width, height, layer
varying vec2 vUv;
varying float vSeed;
void main() {
  float seed = aParams.x;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 rightV = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
  float flick = 1.0 + 0.12 * sin(uTime * 9.0 + seed * 7.0) + 0.08 * sin(uTime * 17.0 + seed * 3.0);
  float u = aCorner.y * 0.5 + 0.5;
  float sway = sin(uTime * 3.1 + seed * 5.0 + u * 2.5) * 0.12 * u;
  mv.xyz += rightV * (aCorner.x * aParams.y + sway) + upV * u * aParams.z * flick;
  vUv = vec2(aCorner.x, u);
  vSeed = seed;
  gl_Position = projectionMatrix * mv;
}
`;
export const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uHot;
uniform vec3 uWarm;
uniform vec3 uDeep;
varying vec2 vUv;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float y = vUv.y;
  vec2 q = vec2(vUv.x * 2.2, y * 3.0 - uTime * 2.6 + vSeed * 9.0);
  float turb = n(q) * 0.6 + n(q * 2.1 + 4.0) * 0.4;
  // A tongue: wide at the coals, narrowing and torn at its tip.
  float width = (1.0 - y) * (0.85 + 0.3 * turb) + 0.05;
  float x = abs(vUv.x + (turb - 0.5) * 0.35 * y);
  float body = 1.0 - smoothstep(width * 0.55, width, x);
  body *= 1.0 - smoothstep(0.55 + turb * 0.35, 1.0, y);
  body *= smoothstep(0.0, 0.08, y);
  float core = (1.0 - smoothstep(0.0, width * 0.45, x)) * (1.0 - smoothstep(0.1, 0.55, y));
  vec3 col = mix(uDeep, uWarm, smoothstep(0.0, 0.6, body));
  col = mix(col, uHot, core);
  float a = body;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col * (0.9 + core * 0.8) * a, a);
  #include <colorspace_fragment>
}
`;

/** Embers rising off a fire. */
export const EMBER_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, rise, speed, size
varying vec2 vCorner;
varying float vGlow;
void main() {
  float seed = aParams.x;
  float s = fract(uTime * aParams.z / aParams.y + seed);
  vec3 p = position;
  p.y += aParams.y * s;
  p.x += sin(s * 6.0 + seed * 20.0) * 0.5 * s;
  p.z += cos(s * 5.0 + seed * 13.0) * 0.5 * s;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.w;
  vGlow = (1.0 - s) * (0.6 + 0.4 * sin(uTime * 14.0 + seed * 50.0));
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
export const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
varying float vGlow;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * vGlow;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

/** A fire's halo: a broad soft warm glow round the flame, steady but for a
 *  breath of flicker, the beacon the raid finds the bowls by. */
export const HALO_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size
varying vec2 vCorner;
varying float vGlow;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += aCorner * aParams.y;
  vGlow = 0.85 + 0.12 * sin(uTime * 7.0 + aParams.x * 9.0) + 0.06 * sin(uTime * 13.0 + aParams.x);
  // A beacon from across the lake, never a blot at the bowl.
  vGlow *= 0.25 + 0.75 * smoothstep(6.0, 22.0, -mv.z);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;

/** The warm pool on the snow round a bowl (a floor mark, the ground rung). */
export const POOL_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, radius
varying vec2 vCorner;
varying float vGlow;
void main() {
  vec3 p = position + vec3(aCorner.x, 0.0, -aCorner.y) * aParams.y;
  vGlow = 0.9 + 0.1 * sin(uTime * 6.0 + aParams.x * 9.0);
  vCorner = aCorner;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
