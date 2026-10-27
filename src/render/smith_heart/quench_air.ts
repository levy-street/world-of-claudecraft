// The Quench vein's air and weather (plan: quench_air_core.ts): snow drifting
// down over every Quench walk, the cold's frost motes glinting, steam rising
// off the vents and out of the rock, a pale mist lying in the void under the
// walks, the braziers' fire (a tall flame, embers, a halo readable from
// anywhere on the lake, a warm pool on the snow round each bowl: the one
// warm thing in the cold), and the Singing Ice creaking: a crack running out
// across the sheet every few seconds and bursting into frost at its end.
// One draw per system, every motion in the vertex shader on the shared clock
// (no per-frame CPU), billboards built in view space. Cosmetic: the low tier
// builds a third of the particles (the fire and the creaks stay); nothing
// here is a telegraph. Built with the interior, so the compile gate links it;
// no light (the braziers' light is heart_lights.ts's), no texture.

import * as THREE from 'three';
import { QUENCH, SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import {
  EMBER_VERT,
  FLAME_FRAG,
  FLAME_VERT,
  GLOW_FRAG,
  HALO_VERT,
  POOL_VERT,
} from './heart_fire_glsl';
import { heartHash } from './heart_plan_core';
import { planQuenchAir, QUENCH_CREAK, QUENCH_SNOW, type QuenchAirPlan } from './quench_air_core';

type V3 = HeartAirV3;
type V4 = HeartAirV4;

const FLAKE_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uDrift;
uniform float uFall;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, column height, sway
varying vec2 vCorner;
varying float vFade;
void main() {
  float seed = aParams.x;
  float hgt = aParams.z;
  float s = fract(uTime * uFall / hgt + seed * 7.31);
  vec3 p = position;
  p.y += hgt * (1.0 - s);
  p.x += uDrift.x * s * hgt / uFall + sin(uTime * 0.7 + seed * 40.0) * aParams.w;
  p.z += uDrift.y * s * hgt / uFall + cos(uTime * 0.55 + seed * 23.0) * aParams.w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.y;
  vFade = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.9, 1.0, s));
  // Never a blot at the lens.
  vFade *= smoothstep(4.0, 11.0, -mv.z);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const FLAKE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  gl_FragColor = vec4(uColor, (1.0 - d * d) * vFade * uAlpha);
  #include <colorspace_fragment>
}
`;

const MOTE_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, drift radius, twinkle speed
varying vec2 vCorner;
varying float vGlow;
void main() {
  float seed = aParams.x;
  vec3 p = position;
  p.x += sin(uTime * 0.13 + seed * 31.0) * aParams.z;
  p.z += cos(uTime * 0.11 + seed * 17.0) * aParams.z;
  p.y += sin(uTime * 0.09 + seed * 11.0) * aParams.z * 0.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = pow(max(0.0, sin(uTime * aParams.w + seed * 60.0)), 8.0);
  vGlow = tw * smoothstep(1.5, 4.0, -mv.z) * (1.0 - smoothstep(30.0, 60.0, -mv.z));
  mv.xy += aCorner * aParams.y * (0.4 + tw);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
varying float vGlow;
void main() {
  // A glint: a four-pointed star, not a disc.
  vec2 a = abs(vCorner);
  float star = max(1.0 - (a.x * 4.0 + a.y), 1.0 - (a.y * 4.0 + a.x));
  float core = 1.0 - smoothstep(0.0, 0.35, length(vCorner));
  float k = max(star, core) * vGlow;
  if (k <= 0.002) discard;
  gl_FragColor = vec4(uColor * k, k);
  #include <colorspace_fragment>
}
`;

const MIST_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, drift, aspect
varying vec2 vCorner;
varying float vSeed;
varying float vFade;
void main() {
  float seed = aParams.x;
  vec3 p = position;
  p.x += sin(uTime * 0.02 + seed * 6.0) * aParams.z;
  p.z += cos(uTime * 0.017 + seed * 4.0) * aParams.z;
  p.y += sin(uTime * 0.05 + seed * 9.0) * 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.y * vec2(1.0, aParams.w);
  vFade = smoothstep(6.0, 24.0, -mv.z);
  vCorner = aCorner;
  vSeed = seed;
  gl_Position = projectionMatrix * mv;
}
`;
const MIST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uShade;
uniform float uAlpha;
uniform float uTime;
varying vec2 vCorner;
varying float vSeed;
varying float vFade;
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
  vec2 q = vCorner * 1.8 + vec2(uTime * 0.02 + vSeed * 9.0, vSeed * 4.0);
  float billow = n(q) * 0.55 + n(q * 2.3 + 3.0) * 0.3 + n(q * 5.1 - 7.0) * 0.15;
  float edge = d + (billow - 0.5) * 0.8;
  float a = (1.0 - smoothstep(0.1, 0.9, edge)) * smoothstep(0.3, 0.62, billow) * uAlpha * vFade;
  vec3 col = mix(uShade, uColor, clamp(vCorner.y * 0.5 + 0.55 + billow * 0.2, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** A puff of steam: rising off its plume's foot, swelling, thinning away. */
const STEAM_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, rise, speed, size
varying vec2 vCorner;
varying float vFade;
varying float vSeed;
void main() {
  float seed = aParams.x;
  float s = fract(uTime * aParams.z / aParams.y + seed);
  vec3 p = position;
  p.y += aParams.y * s;
  p.x += sin(s * 3.0 + seed * 20.0) * 0.8 * s + s * s * 2.0;
  p.z += cos(s * 2.6 + seed * 13.0) * 0.8 * s - s * s * 1.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.w * (0.7 + 2.6 * s);
  vFade = smoothstep(0.0, 0.15, s) * (1.0 - smoothstep(0.35, 1.0, s));
  vFade *= smoothstep(3.0, 9.0, -mv.z);
  vCorner = aCorner;
  vSeed = seed;
  gl_Position = projectionMatrix * mv;
}
`;
const STEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vCorner;
varying float vFade;
varying float vSeed;
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
  float b = n(vCorner * 2.4 + vec2(vSeed * 7.0, uTime * 0.3)) * 0.6 + n(vCorner * 5.0 - vSeed * 3.0) * 0.4;
  float a = (1.0 - smoothstep(0.0, 1.0, d + (b - 0.5) * 0.6)) * smoothstep(0.25, 0.6, b) * vFade * uAlpha;
  gl_FragColor = vec4(uColor * (0.92 + 0.1 * b), a);
  #include <colorspace_fragment>
}
`;

/** The Singing Ice's creak: a crack's segments, each lit while the creak
 *  running that crack has reached it, the vein's pale light along a white
 *  core, fading after it holds (quench_air_core.ts quenchCreakAt and
 *  quenchCreakLook, the same arithmetic). */
const CREAK_GLSL = /* glsl */ `
uniform float uCracks;
float fr(float v) { return v - floor(v); }
// The creak now: x the crack it runs, y the seconds since it began.
vec2 creakNow(float t) {
  float k = floor(t / ${QUENCH_CREAK.cell.toFixed(2)});
  float crack = mod(k * ${QUENCH_CREAK.stride.toFixed(1)} + 1.0, uCracks);
  return vec2(crack, t - k * ${QUENCH_CREAK.cell.toFixed(2)});
}
float creakGrown(float since) { return clamp(since / ${QUENCH_CREAK.grow.toFixed(2)}, 0.0, 1.0); }
float creakGlow(float since) {
  if (since < 0.0) return 0.0;
  float held = ${(QUENCH_CREAK.grow + QUENCH_CREAK.hold).toFixed(2)};
  return since < held ? 1.0 : max(0.0, 1.0 - (since - held) / ${QUENCH_CREAK.fade.toFixed(2)});
}
float creakBurst(float since) {
  float b = since - ${QUENCH_CREAK.grow.toFixed(2)};
  return b < 0.0 ? 0.0 : max(0.0, 1.0 - b / 0.9);
}
`;
const CREAK_VERT = /* glsl */ `
uniform float uTime;
uniform float uWidth;
uniform float uFront;
attribute vec3 aOther;
attribute vec2 aCorner;
attribute vec4 aParams; // crack, along (0 start .. 1 end), width
varying float vShow;
varying vec2 vCorner;
${CREAK_GLSL}
void main() {
  vec2 now = creakNow(uTime);
  float on = step(abs(now.x - aParams.x), 0.5);
  float grown = creakGrown(now.y);
  float reached = smoothstep(aParams.y - 0.02, aParams.y + 0.03, grown);
  // The front burns brightest where it is breaking.
  // (A square written out: pow() of a negative base is undefined in GLSL.)
  float lag = (aParams.y - grown) * 9.0;
  float front = exp(-lag * lag) * step(grown, 0.999);
  vShow = on * reached * creakGlow(now.y) * (0.45 + 0.55 * front * uFront);
  vec3 a = position;
  vec3 b = aOther;
  vec3 d = normalize(vec3(b.x - a.x, 0.0, b.z - a.z) + vec3(1e-5, 0.0, 0.0));
  vec3 side = vec3(d.z, 0.0, -d.x);
  vec3 p = mix(a, b, aCorner.x * 0.5 + 0.5)
    + side * aCorner.y * aParams.z * uWidth * (1.0 + front * 0.8 * uFront);
  vCorner = aCorner;
  gl_Position = vShow > 0.0 ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`;
/** The crack itself: a dark seam opening in the ice, its broken edges
 *  white (normal blended, so it reads on the pale sheet). */
const SEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vShow;
varying vec2 vCorner;
void main() {
  float e = abs(vCorner.y);
  float seam = 1.0 - smoothstep(0.12, 0.3, e);
  float rim = (1.0 - smoothstep(0.3, 0.7, e)) * smoothstep(0.12, 0.3, e);
  vec3 col = mix(vec3(1.0), uColor, seam);
  float a = max(seam * 0.95, rim * 0.75) * min(1.0, vShow * 1.6);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
/** The cold light breaking out along it, brightest at the running front. */
const CREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vShow;
varying vec2 vCorner;
void main() {
  float e = abs(vCorner.y);
  // A white-hot core of cold light, a broad halo of the vein's pale blue.
  float core = 1.0 - smoothstep(0.0, 0.12, e);
  float glow = (1.0 - e) * (1.0 - e);
  vec3 col = mix(uColor, vec3(1.0), core * 0.8) * (core * 2.6 + glow * 1.5);
  gl_FragColor = vec4(col * vShow, glow * vShow);
  #include <colorspace_fragment>
}
`;
/** A puff of frost (normal blended: white over the pale sheet), its edge
 *  torn by noise. */
const FROST_PUFF_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
varying float vGlow;
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
  float b = n(vCorner * 2.6 + 3.0) * 0.6 + n(vCorner * 6.0) * 0.4;
  float a = (1.0 - smoothstep(0.1, 1.0, d + (b - 0.5) * 0.6)) * vGlow * 0.8;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor * (0.9 + 0.12 * b), a);
  #include <colorspace_fragment>
}
`;
/** The frost burst at a creak's end: a puff of frost and glints flung out. */
const BURST_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // crack, angle, speed, size
varying vec2 vCorner;
varying float vGlow;
${CREAK_GLSL}
void main() {
  vec2 now = creakNow(uTime);
  float on = step(abs(now.x - aParams.x), 0.5);
  float burst = creakBurst(now.y);
  float age = 1.0 - burst;
  vec3 p = position;
  p.x += sin(aParams.y) * aParams.z * age;
  p.z += cos(aParams.y) * aParams.z * age;
  p.y += (aParams.z > 0.0 ? 1.6 : 0.4) * age * (1.0 - age * 0.6);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float big = aParams.z > 0.0 ? 1.0 : 1.0 + age * 3.5;
  mv.xy += aCorner * aParams.w * big;
  vGlow = on * burst;
  vCorner = aCorner;
  gl_Position = vGlow > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
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
    // Flat cards on the floor (the creaks, the pools) and billboards alike:
    // drawn from either face, so no winding hides one.
    side: THREE.DoubleSide,
  });
}

const col = (hex: number) => ({ value: new THREE.Color(hex) });

function particles(plan: QuenchAirPlan) {
  const flakes: V3[] = [];
  const flakeP: V4[] = [];
  const motes: V3[] = [];
  const moteP: V4[] = [];
  plan.volumes.forEach((v, vi) => {
    for (let i = 0; i < v.flakes; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i, k + 700);
      flakes.push([v.x + (h(1) - 0.5) * 2 * v.hw, v.y0, v.z + (h(3) - 0.5) * 2 * v.hd]);
      flakeP.push([h(4), 0.035 + h(5) * 0.05, v.y1 - v.y0, 0.3 + h(6) * 0.6]);
    }
    for (let i = 0; i < v.motes; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i, k + 900);
      motes.push([
        v.x + (h(1) - 0.5) * 2 * v.hw,
        v.y0 + 0.5 + h(2) * (v.y1 - v.y0) * 0.6,
        v.z + (h(3) - 0.5) * 2 * v.hd,
      ]);
      moteP.push([h(4), 0.08 + h(5) * 0.1, 1 + h(6) * 2, 0.6 + h(7) * 1.4]);
    }
  });
  return { flakes, flakeP, motes, moteP };
}

/** The Quench's air and weather, instance-local (cosmetic: the low tier
 *  builds a third of the particles; the fire and the creaks stay). */
export function buildQuenchAir(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartQuenchAir';
  const plan = planQuenchAir(lowGfx ? 0.35 : 1);
  const p = particles(plan);
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
  // The mist in the void, under everything.
  add(
    'smithHeartQuenchMist',
    heartQuadGeometry(
      plan.mists.map((m) => [m.x, m.y, m.z] as V3),
      plan.mists.map((m, i) => [heartHash(i, 801), m.size, 6, 0.42] as V4),
    ),
    airMaterial(
      'smithHeartQuenchMist',
      MIST_VERT,
      MIST_FRAG,
      { uColor: col(0xd2dce6), uShade: col(0x7f90a4), uAlpha: { value: 0.4 } },
      false,
    ),
    3,
  );
  // Steam off the vents and out of the rock.
  const steam: V3[] = [];
  const steamP: V4[] = [];
  plan.steam.forEach((s, si) => {
    const puffs = lowGfx ? 6 : 14;
    for (let i = 0; i < puffs; i++) {
      steam.push([s.x, s.y + 0.1, s.z]);
      steamP.push([
        (i + heartHash(si, i + 50) * 0.5) / puffs,
        s.rise,
        1.6 + heartHash(si, i) * 0.6,
        1.1,
      ]);
    }
  });
  add(
    'smithHeartQuenchSteam',
    heartQuadGeometry(steam, steamP),
    airMaterial(
      'smithHeartQuenchSteam',
      STEAM_VERT,
      STEAM_FRAG,
      { uColor: col(0xeef4f8), uAlpha: { value: 0.2 } },
      false,
    ),
    5,
  );
  // The snow, and the frost motes glinting in it.
  add(
    'smithHeartQuenchSnow',
    heartQuadGeometry(p.flakes, p.flakeP),
    airMaterial(
      'smithHeartQuenchSnow',
      FLAKE_VERT,
      FLAKE_FRAG,
      {
        uColor: col(0xf2f6fa),
        uAlpha: { value: 0.85 },
        uDrift: { value: new THREE.Vector2(QUENCH_SNOW.drift[0], QUENCH_SNOW.drift[1]) },
        uFall: { value: QUENCH_SNOW.fall },
      },
      false,
    ),
    6,
  );
  add(
    'smithHeartQuenchMotes',
    heartQuadGeometry(p.motes, p.moteP),
    airMaterial('smithHeartQuenchMotes', MOTE_VERT, MOTE_FRAG, { uColor: col(0xcfeeff) }, true),
    7,
  );
  // The braziers' fire: two crossed tongues and a small inner one each,
  // embers, a halo, a warm pool on the snow.
  const flames: V3[] = [];
  const flameP: V4[] = [];
  const embers: V3[] = [];
  const emberP: V4[] = [];
  plan.fires.forEach((f, fi) => {
    for (const [k, w, h] of [
      [0, 0.95, 3.4],
      [1, 0.8, 2.8],
      [2, 0.55, 2.0],
    ] as const) {
      flames.push([f.x, f.y - 0.05, f.z]);
      flameP.push([heartHash(fi, k + 60), w, h, k]);
    }
    for (let i = 0; i < (lowGfx ? 6 : 14); i++) {
      embers.push([
        f.x + (heartHash(fi, i + 70) - 0.5) * 1.2,
        f.y + 0.2,
        f.z + (heartHash(fi, i + 80) - 0.5) * 1.2,
      ]);
      emberP.push([
        heartHash(fi, i + 90),
        4 + heartHash(fi, i + 95) * 3,
        1.4 + heartHash(fi, i) * 1.2,
        0.05,
      ]);
    }
  });
  add(
    'smithHeartQuenchFlames',
    heartQuadGeometry(flames, flameP),
    airMaterial(
      'smithHeartQuenchFlames',
      FLAME_VERT,
      FLAME_FRAG,
      { uHot: col(0xfff0c8), uWarm: col(0xffa040), uDeep: col(0xb03a10) },
      true,
    ),
    9,
  );
  add(
    'smithHeartQuenchEmbers',
    heartQuadGeometry(embers, emberP),
    airMaterial('smithHeartQuenchEmbers', EMBER_VERT, GLOW_FRAG, { uColor: col(0xffb050) }, true),
    9,
  );
  add(
    'smithHeartQuenchFireHalos',
    heartQuadGeometry(
      plan.fires.map((f) => [f.x, f.y + 1.0, f.z] as V3),
      plan.fires.map((_, i) => [i, 3.6, 0, 0] as V4),
    ),
    airMaterial('smithHeartQuenchFireHalos', HALO_VERT, GLOW_FRAG, { uColor: col(0xff9a40) }, true),
    8,
  );
  add(
    'smithHeartQuenchFirePools',
    heartQuadGeometry(
      plan.fires.map((f) => [f.x, f.y - 2.0 + 0.05, f.z] as V3),
      plan.fires.map((_, i) => [i, 6.5, 0, 0] as V4),
    ),
    airMaterial('smithHeartQuenchFirePools', POOL_VERT, GLOW_FRAG, { uColor: col(0x7a3a12) }, true),
    floorVfxRenderOrder('ground', 2),
  );
  // The Singing Ice's creaks and their frost bursts.
  const a: V3[] = [];
  const b: V3[] = [];
  const cp: V4[] = [];
  const bursts: V3[] = [];
  const burstP: V4[] = [];
  const y = QUENCH.ice.h + 0.04;
  plan.cracks.forEach((c, ci) => {
    const n = c.pts.length - 1;
    for (let i = 0; i < n; i++) {
      a.push([c.pts[i].x, y, c.pts[i].z]);
      b.push([c.pts[i + 1].x, y, c.pts[i + 1].z]);
      cp.push([ci, (i + 0.5) / n, 0.16 * (1 - (i / n) * 0.5), 0]);
    }
    const end = c.pts[n];
    bursts.push([end.x, y + 0.3, end.z]);
    burstP.push([ci, 0, 0, 2.2]);
    for (let k = 0; k < (lowGfx ? 5 : 12); k++) {
      bursts.push([end.x, y + 0.2, end.z]);
      burstP.push([
        ci,
        (k / 12) * Math.PI * 2 + heartHash(ci, k) * 0.4,
        2.5 + heartHash(ci, k + 9) * 3.5,
        0.2,
      ]);
    }
  });
  const cracks = { value: Math.max(1, plan.cracks.length) };
  const quench = SMITH_HEART_VEIN_COLORS.quench;
  const creakGeo = heartQuadGeometry(a, cp, b);
  add(
    'smithHeartQuenchCreakSeams',
    creakGeo,
    airMaterial(
      'smithHeartQuenchCreakSeams',
      CREAK_VERT,
      SEAM_FRAG,
      { uColor: col(0x10263a), uCracks: cracks, uWidth: { value: 1.4 }, uFront: { value: 0 } },
      false,
    ),
    floorVfxRenderOrder('ground', 3),
  );
  add(
    'smithHeartQuenchCreaks',
    creakGeo,
    airMaterial(
      'smithHeartQuenchCreaks',
      CREAK_VERT,
      CREAK_FRAG,
      { uColor: col(quench), uCracks: cracks, uWidth: { value: 9.0 }, uFront: { value: 1 } },
      true,
    ),
    floorVfxRenderOrder('ground', 4),
  );
  // The frost burst: a puff of white frost (its speed 0), and glints flung.
  const puffAt = burstP.map((q, i) => (q[2] === 0 ? i : -1)).filter((i) => i >= 0);
  const glintAt = burstP.map((q, i) => (q[2] > 0 ? i : -1)).filter((i) => i >= 0);
  add(
    'smithHeartQuenchCreakFrost',
    heartQuadGeometry(
      puffAt.map((i) => bursts[i]),
      puffAt.map((i) => burstP[i]),
    ),
    airMaterial(
      'smithHeartQuenchCreakFrost',
      BURST_VERT,
      FROST_PUFF_FRAG,
      { uColor: col(0xeef6fb), uCracks: cracks },
      false,
    ),
    8,
  );
  add(
    'smithHeartQuenchCreakBursts',
    heartQuadGeometry(
      glintAt.map((i) => bursts[i]),
      glintAt.map((i) => burstP[i]),
    ),
    airMaterial(
      'smithHeartQuenchCreakBursts',
      BURST_VERT,
      GLOW_FRAG,
      { uColor: col(0xd8f2ff), uCracks: cracks },
      true,
    ),
    8,
  );
  return group;
}
