// The Wildheart Basin's sky: a humid gold-green afternoon over a closed
// caldera. A warm gold band low round the horizon (#F0C877) climbing to a
// clear, hazy turquoise overhead; tall cumulus towers standing round the rim,
// their sunward flanks blazing white-gold and their bellies grey-violet; a
// broken deck of fair-weather cloud drifting over; the sun low in the
// south-west, haloed in the haze, with shafts breaking from it through the
// cloud gaps. A dry sky: no rain curtain, no storm.
//
// Camera-centred (drawn at the far plane), all motion on the shared clock.
// Cosmetic only; the detail octaves are a build-time define that sheds with
// the tier.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { BASIN_FOG_COLOR, BASIN_SUN_DIRECTION } from './basin_plan_core';

export interface BasinSkyOptions {
  lowGfx: boolean;
  density: number;
}

export const BASIN_NOISE_GLSL = /* glsl */ `
#ifndef BFBM_OCTAVES
#define BFBM_OCTAVES 5
#endif
float bhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(bhash(i), bhash(i + vec2(1.0, 0.0)), u.x), mix(bhash(i + vec2(0.0, 1.0)), bhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float bfbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < BFBM_OCTAVES; i++) { s += bnoise(p) * a; p *= 2.03; a *= 0.5; }
  return s;
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = gl_Position.w * 0.99999;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
${BASIN_NOISE_GLSL}
// Tall cumulus round the horizon: a column field in azimuth that climbs with
// billowing tops; returns density, writes the cloud's local up-shade.
float towers(vec3 d, out float shade) {
  float az = atan(d.z, d.x);
  float up = d.y;
  float t = uTime * 0.004;
  float col = bfbm(vec2(az * 2.6 + t, 0.7));
  // Towers climb well past the caldera rim (the walls hide the low sky).
  float height = 0.2 + smoothstep(0.34, 0.78, col) * 0.5;
  float billow = bfbm(vec2(az * 9.0 + t * 3.0, up * 7.0 - t)) * 0.14;
#if BASIN_SKY_DETAIL
  billow += bfbm(vec2(az * 22.0, up * 18.0) + 4.0) * 0.07;
#endif
  float top = height + billow;
  float body = smoothstep(top, top - 0.06, up) * smoothstep(-0.06, 0.03, up);
  // Flat grey bases sitting on the haze line, cauliflower tops.
  shade = clamp((up + 0.02) / max(top, 0.05), 0.0, 1.0);
  return body * smoothstep(0.3, 0.46, col + billow);
}
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  // Gold at the horizon, a hazy turquoise overhead, a greener band between.
  // Golden hour: a deep turquoise overhead, a clear aqua band, and the gold
  // haze only low on the horizon, burning orange toward the sun and cooling
  // to violet-grey opposite it.
  vec3 zenith = vec3(0.07, 0.3, 0.52);
  vec3 mid = vec3(0.34, 0.6, 0.64);
  vec3 col = mix(mid, zenith, smoothstep(0.06, 0.62, up));
  float toSun = max(0.0, dot(d, uSunDir));
  float sunSide = dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5;
  vec3 horizon = mix(uHorizon * vec3(0.78, 0.8, 0.92), uHorizon * vec3(1.18, 0.98, 0.72), sunSide);
  col = mix(horizon, col, smoothstep(-0.02, 0.16 + 0.08 * sunSide, up));
  // The sun's quarter of the sky glows gold-orange through the humid air.
  col += vec3(0.75, 0.42, 0.12) * pow(max(toSun, 0.0), 5.0) * 0.7 + vec3(0.42, 0.26, 0.08) * pow(max(toSun, 0.0), 2.0) * 0.32;

  // Fair-weather cloud deck drifting over.
  float deck = 0.0;
  if (up > 0.0) {
    vec2 uv = d.xz / (up + 0.18);
    float c1 = bfbm(uv * 0.7 + vec2(uTime * 0.006, uTime * 0.003));
#if BASIN_SKY_DETAIL
    float c2 = bfbm(uv * 1.9 - vec2(uTime * 0.01, 0.0) + 9.0);
#else
    float c2 = 0.45;
#endif
    deck = smoothstep(0.56, 0.84, c1 * 0.75 + c2 * 0.35) * smoothstep(0.02, 0.22, up);
    float lit = 0.55 + 0.45 * smoothstep(0.4, 0.95, dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5);
    vec3 deckCol = mix(vec3(0.72, 0.7, 0.68), vec3(1.0, 0.95, 0.84), lit) + vec3(1.0, 0.8, 0.45) * pow(max(toSun, 0.0), 12.0) * 0.8;
    col = mix(col, deckCol, deck * 0.7);
  }

  // The towers: sunward flanks white-gold, shadowed flanks grey-violet.
  float shade;
  float tw = towers(d, shade);
  float side = dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z)));
  vec3 towerLit = vec3(1.0, 0.92, 0.76);
  vec3 towerDark = vec3(0.5, 0.5, 0.58);
  vec3 towerCol = mix(towerDark, towerLit, smoothstep(-0.6, 0.7, side) * (0.45 + 0.55 * shade));
  towerCol = mix(towerCol, uHorizon, (1.0 - shade) * 0.35);
  col = mix(col, towerCol, tw * 0.92);

  // The sun: a hot disc, a tight bloom and a wide humid halo, dimmed where a
  // cloud crosses it, with shafts breaking from the gaps.
  float sunAng = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  float cover = max(deck, tw);
  float disc = smoothstep(0.03, 0.026, sunAng);
  col += vec3(1.0, 0.92, 0.7) * disc * 3.0 * (1.0 - cover * 0.8);
  col += vec3(1.0, 0.82, 0.5) * (exp(-sunAng * 14.0) * 0.9 + exp(-sunAng * 3.2) * 0.22) * (1.0 - cover * 0.5);
  // Sun breaks: rays fanning from the sun through the cloud gaps.
#if BASIN_SKY_DETAIL
  vec3 tu = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
  vec3 tv = cross(tu, uSunDir);
  float ra = atan(dot(d, tv), dot(d, tu));
  float rays = bnoise(vec2(ra * 9.0, uTime * 0.05)) * bnoise(vec2(ra * 23.0, uTime * 0.03 + 3.0));
  col += vec3(1.0, 0.86, 0.55) * smoothstep(0.25, 0.7, rays) * exp(-sunAng * 2.4) * 0.35 * (0.4 + cover);
#endif
  // Below the rim: the haze the caldera walls stand in.
  col = mix(col, uHorizon * 0.92, smoothstep(0.02, -0.12, up));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** The basin's own sky dome (the world dome hides inside it). */
export function buildBasinSky(opts: BasinSkyOptions): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: 'wildheartBasinSky',
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uSunDir: { value: new THREE.Vector3(...BASIN_SUN_DIRECTION) },
      uHorizon: { value: new THREE.Color(BASIN_FOG_COLOR) },
    },
    // The detail octaves are a program variant fixed at build (the low tier
    // never pays them), linked by the interior's compile gate.
    defines: {
      BASIN_SKY_DETAIL: opts.lowGfx ? 0 : 1,
      BFBM_OCTAVES: opts.lowGfx ? 3 : opts.density >= 1 ? 5 : 4,
    },
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.name = 'wildheartBasinSky';
  // Default order, after the opaque world: its far-plane depth lets the
  // terrain and the walls reject its fragments before they are shaded.
  mesh.frustumCulled = false;
  return mesh;
}
