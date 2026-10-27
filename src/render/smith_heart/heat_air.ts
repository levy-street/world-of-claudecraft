// The Heat vein's air and weather (plan: heat_air_core.ts): embers rising
// over every Heat walk and out of the chasm, thick in the Hearth's throat;
// the first flame burning tall among its crystal; smoke climbing out of the
// chasm and off the Hearth's crown, drifting east up to the open sky; the
// fire deep in the chasm glowing under the walks; a halo round every cluster
// of the first flame's crystal; the heat's haze shimmering over the Hearth's
// mouth, the wellspring and the bridge's chasm.
// One draw per system, every motion in the vertex shader on the shared clock
// (no per-frame CPU), billboards built in view space. Cosmetic: the low tier
// builds a third of the particles and no haze (the flames, the halos and the
// chasm's glow stay); nothing here is a telegraph. Built with the interior,
// so the compile gate links it; no light (the Hearth's light is
// heart_lights.ts's), no texture. The pour is heat_pour.ts's.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { FLAME_FRAG, FLAME_VERT, GLOW_FRAG, HALO_VERT } from './heart_fire_glsl';
import { heartHash } from './heart_plan_core';
import { HEAT_EMBERS, type HeatAirPlan, planHeatAir } from './heat_air_core';

type V3 = HeartAirV3;
type V4 = HeartAirV4;

/** An ember rising through a volume's column, drifting east, swaying,
 *  flickering, dying out at the top (never a blot at the lens). */
const EMBER_RISE_VERT = /* glsl */ `
uniform float uTime;
uniform float uRise;
uniform vec2 uDrift;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, column height, sway
varying vec2 vCorner;
varying float vGlow;
void main() {
  float seed = aParams.x;
  float hgt = aParams.z;
  float speed = uRise * (0.7 + 0.6 * fract(seed * 13.7));
  float s = fract(uTime * speed / hgt + seed * 7.31);
  vec3 p = position;
  p.y += hgt * s;
  p.x += uDrift.x * s * hgt / speed + sin(uTime * 1.3 + seed * 40.0) * aParams.w;
  p.z += uDrift.y * s * hgt / speed + cos(uTime * 1.1 + seed * 23.0) * aParams.w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.y;
  float flick = 0.55 + 0.45 * sin(uTime * (9.0 + seed * 7.0) + seed * 50.0);
  vGlow = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.6, 1.0, s)) * flick;
  vGlow *= smoothstep(2.5, 7.0, -mv.z);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;

/** A plume of smoke: puffs rising off its foot, swelling, leaning east with
 *  the draught, thinning away high up (normal blend: smoke darkens). */
const SMOKE_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, rise, speed, size
varying vec2 vCorner;
varying float vFade;
varying float vSeed;
varying float vHigh;
void main() {
  float seed = aParams.x;
  float s = fract(uTime * aParams.z / aParams.y + seed);
  vec3 p = position;
  p.y += aParams.y * s;
  p.x += s * s * aParams.y * 0.35 + sin(s * 3.0 + seed * 20.0) * 1.2 * s;
  p.z += cos(s * 2.6 + seed * 13.0) * 1.4 * s;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.w * (0.6 + 2.4 * s);
  vFade = smoothstep(0.0, 0.18, s) * (1.0 - smoothstep(0.45, 1.0, s));
  vFade *= smoothstep(6.0, 18.0, -mv.z);
  vHigh = s;
  vCorner = aCorner;
  vSeed = seed;
  gl_Position = projectionMatrix * mv;
}
`;
const SMOKE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLit;
uniform float uAlpha;
uniform float uTime;
varying vec2 vCorner;
varying float vFade;
varying float vSeed;
varying float vHigh;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float b = n(vCorner * 2.2 + vec2(vSeed * 7.0, uTime * 0.15)) * 0.6 + n(vCorner * 4.6 - vSeed * 3.0) * 0.4;
  float a = (1.0 - smoothstep(0.0, 1.0, d + (b - 0.5) * 0.7)) * smoothstep(0.22, 0.6, b) * vFade * uAlpha;
  if (a <= 0.003) discard;
  // Lit warm from below where the fire catches it, grey as it climbs.
  vec3 col = mix(uLit, uColor, smoothstep(0.0, 0.45, vHigh) * 0.8 + clamp(vCorner.y * 0.3 + 0.2, 0.0, 0.3));
  gl_FragColor = vec4(col * (0.9 + 0.15 * b), a);
  #include <colorspace_fragment>
}
`;

/** The heat's shimmer: an upright card of faint wavering light, streaks of
 *  it climbing (no refraction: the scene's colour is not read). */
const HAZE_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size
varying vec2 vCorner;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 rightV = normalize(cross(upV, vec3(0.0, 0.0, 1.0)));
  float u = aCorner.y * 0.5 + 0.5;
  mv.xyz += rightV * aCorner.x * aParams.y * 0.5 + upV * u * aParams.y;
  vCorner = vec2(aCorner.x, u);
  vSeed = aParams.x;
  gl_Position = projectionMatrix * mv;
}
`;
const HAZE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vCorner;
varying float vSeed;
void main() {
  float x = vCorner.x;
  float y = vCorner.y;
  float edge = (1.0 - smoothstep(0.55, 1.0, abs(x))) * smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.6, 1.0, y));
  float w = sin(x * 9.0 + sin(y * 7.0 - uTime * 3.1 + vSeed) * 1.6 + vSeed * 3.0);
  float streak = smoothstep(0.75, 1.0, w) * (0.5 + 0.5 * sin(y * 18.0 - uTime * 5.0 + x * 3.0));
  float a = edge * streak * 0.07;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

function airMaterial(
  name: string,
  vert: string,
  frag: string,
  extra: Record<string, THREE.IUniform>,
  additive: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { uTime: sharedUniforms.uTime, ...extra },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

const col = (hex: number) => ({ value: new THREE.Color(hex) });

function embers(plan: HeatAirPlan): { at: V3[]; params: V4[] } {
  const at: V3[] = [];
  const params: V4[] = [];
  plan.volumes.forEach((v, vi) => {
    for (let i = 0; i < v.embers; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i, k + 1700);
      at.push([v.x + (h(1) - 0.5) * 2 * v.hw, v.y0, v.z + (h(3) - 0.5) * 2 * v.hd]);
      params.push([h(4), 0.04 + h(5) * 0.07, v.y1 - v.y0, 0.2 + h(6) * 0.5]);
    }
  });
  return { at, params };
}

/** The Heat's air and weather, instance-local (cosmetic: the low tier builds
 *  a third of the particles and no haze; the flames, the halos and the
 *  chasm's glow stay). */
export function buildHeatAir(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHeatAir';
  const plan = planHeatAir(lowGfx ? 0.35 : 1);
  const add = (
    name: string,
    geo: THREE.BufferGeometry,
    mat: THREE.ShaderMaterial,
    order: number,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  // The fire deep in the chasm, under everything.
  add(
    'smithHeartHeatChasmGlow',
    heartQuadGeometry(
      plan.glows.map((g) => [g.x, g.y, g.z] as V3),
      plan.glows.map((g, i) => [heartHash(i, 1801), g.size, 0, 0] as V4),
    ),
    airMaterial('smithHeartHeatChasmGlow', HALO_VERT, GLOW_FRAG, { uColor: col(0x8a4a14) }, true),
    2,
  );
  // The smoke climbing out of the chasm and off the Hearth's crown.
  const smoke: V3[] = [];
  const smokeP: V4[] = [];
  plan.smoke.forEach((s, si) => {
    const puffs = lowGfx ? 5 : 12;
    for (let i = 0; i < puffs; i++) {
      smoke.push([s.x, s.y, s.z]);
      smokeP.push([
        (i + heartHash(si, i + 1850) * 0.5) / puffs,
        s.rise,
        2.2 + heartHash(si, i) * 1.2,
        s.size,
      ]);
    }
  });
  add(
    'smithHeartHeatSmoke',
    heartQuadGeometry(smoke, smokeP),
    airMaterial(
      'smithHeartHeatSmoke',
      SMOKE_VERT,
      SMOKE_FRAG,
      { uColor: col(0x4a4440), uLit: col(0x7a5a3c), uAlpha: { value: 0.34 } },
      false,
    ),
    4,
  );
  // The haze, faint, over the hottest places.
  if (plan.haze.length)
    add(
      'smithHeartHeatHaze',
      heartQuadGeometry(
        plan.haze.map((h) => [h.x, h.y, h.z] as V3),
        plan.haze.map((h, i) => [heartHash(i, 1901) * 6, h.size, 0, 0] as V4),
      ),
      airMaterial('smithHeartHeatHaze', HAZE_VERT, HAZE_FRAG, { uColor: col(0xffe2b0) }, true),
      6,
    );
  // The first flame in the Hearth's throat: tongues among the crystal.
  const flames: V3[] = [];
  const flameP: V4[] = [];
  plan.flames.forEach((f, fi) => {
    for (const [k, wk, hk] of [
      [0, 1, 1],
      [1, 0.8, 0.82],
      [2, 0.55, 0.6],
    ] as const) {
      flames.push([f.x + (k - 1) * 0.4, f.y - 0.1, f.z + (k - 1) * 0.3]);
      flameP.push([heartHash(fi, k + 1960), f.w * wk, f.h * hk, k]);
    }
  });
  add(
    'smithHeartHeatFlames',
    heartQuadGeometry(flames, flameP),
    airMaterial(
      'smithHeartHeatFlames',
      FLAME_VERT,
      FLAME_FRAG,
      { uHot: col(0xfff2d2), uWarm: col(0xffc65a), uDeep: col(0xc8761e) },
      true,
    ),
    9,
  );
  // The embers.
  const e = embers(plan);
  add(
    'smithHeartHeatEmbers',
    heartQuadGeometry(e.at, e.params),
    airMaterial(
      'smithHeartHeatEmbers',
      EMBER_RISE_VERT,
      GLOW_FRAG,
      {
        uColor: col(0xffc060),
        uRise: { value: HEAT_EMBERS.rise },
        uDrift: { value: new THREE.Vector2(HEAT_EMBERS.drift[0], HEAT_EMBERS.drift[1]) },
      },
      true,
    ),
    9,
  );
  // The crystal's halos (the beacons the vein is found by).
  add(
    'smithHeartHeatHalos',
    heartQuadGeometry(
      plan.halos.map((h) => [h.x, h.y, h.z] as V3),
      plan.halos.map((h, i) => [heartHash(i, 1991), h.size, 0, 0] as V4),
    ),
    airMaterial('smithHeartHeatHalos', HALO_VERT, GLOW_FRAG, { uColor: col(0xd08a32) }, true),
    8,
  );
  return group;
}
