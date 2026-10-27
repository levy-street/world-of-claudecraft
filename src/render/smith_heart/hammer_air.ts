// The Hammer vein's air (plan: hammer_air_core.ts): quarry dust drifting in
// the low sun over the pit and the Gallery, grit trickling off the terraces'
// lips and the colossi's shoulders, the collapse spot shedding a steady
// warning of grit onto the lower Gallery, a warm haze low over the quarry
// floor, and the geodes' amber halos. One draw per system, every motion in
// the vertex shader on the shared clock (no per-frame CPU), billboards built
// in view space from the camera-relative model-view (never a world point
// times the view matrix on the GPU). Cosmetic: the low tier builds a third of
// it; nothing here is a telegraph. Built with the interior, so the compile
// gate links it; no light, no texture.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { type HammerAirPlan, planHammerAir } from './hammer_air_core';
import { heartQuadGeometry } from './heart_air_quads';
import { heartHash } from './heart_plan_core';

/** Merged quads (heart_air_quads.ts). */
const quadGeometry = heartQuadGeometry;

const MOTE_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, rise speed, column height
varying vec2 vCorner;
varying float vFade;
void main() {
  float seed = aParams.x;
  float t = uTime * aParams.z + seed * 17.0;
  float lift = fract(t / aParams.w);
  vec3 p = position;
  p.y += lift * aParams.w;
  p.x += sin(uTime * 0.21 + seed * 6.28) * 2.2 + sin(uTime * 0.73 + seed * 31.0) * 0.4;
  p.z += cos(uTime * 0.17 + seed * 5.1) * 2.2;
  vFade = smoothstep(0.0, 0.15, lift) * (1.0 - smoothstep(0.75, 1.0, lift));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // A mote at the lens is a blot, never dust: fade the nearest out.
  vFade *= smoothstep(2.0, 9.0, -mv.z);
  mv.xy += aCorner * aParams.y;
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float a = (1.0 - d * d) * vFade * uAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const GRIT_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, width, fall speed, drop
varying vec2 vCorner;
varying float vFade;
void main() {
  float seed = aParams.x;
  float fall = fract(uTime * aParams.z / aParams.w + seed);
  vec3 p = position;
  p.y -= fall * aParams.w;
  p.x += sin(seed * 41.0) * 0.25;
  vFade = smoothstep(0.0, 0.1, fall) * (1.0 - smoothstep(0.7, 1.0, fall));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // A streak: narrow, drawn out along its fall (view up).
  mv.x += aCorner.x * aParams.y;
  mv.y += aCorner.y * aParams.y * 8.0;
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const GRIT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
void main() {
  float a = (1.0 - abs(vCorner.x)) * (1.0 - vCorner.y * vCorner.y) * vFade * uAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const HAZE_VERT = /* glsl */ `
uniform float uTime;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, drift, aspect
varying vec2 vCorner;
varying float vSeed;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.05 + aParams.x * 6.28) * aParams.z;
  p.z += cos(uTime * 0.04 + aParams.x * 3.1) * aParams.z;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.y * vec2(1.0, aParams.w);
  vCorner = aCorner;
  vSeed = aParams.x;
  gl_Position = projectionMatrix * mv;
}
`;
const HAZE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vCorner;
varying float vSeed;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float breathe = 0.75 + 0.25 * sin(uTime * 0.3 + vSeed * 9.0);
  float a = (1.0 - d) * (1.0 - d) * uAlpha * breathe;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const SHAFT_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aParams; // height, width, leanX, leanZ
varying vec2 vCorner;
void main() {
  // A column turned to face the camera about the vertical: its foot on the
  // floor at the base, its head up the crack, leaning with the low sun.
  float t = aCorner.y * 0.5 + 0.5;
  vec3 p = position;
  p.y += t * aParams.x;
  p.x += aParams.z * t * aParams.x;
  p.z += aParams.w * t * aParams.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.x += aCorner.x * aParams.y * (0.7 + 0.3 * t);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vCorner;
void main() {
  float t = vCorner.y * 0.5 + 0.5;
  float across = pow(1.0 - smoothstep(0.0, 1.0, abs(vCorner.x)), 1.6);
  // Brightest up in the crack, thinning toward the floor.
  float along = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(0.8, 1.0, t)) * (0.45 + 0.55 * t);
  float shimmer = 0.85 + 0.15 * sin(uTime * 0.6 + vCorner.x * 3.0 + t * 5.0);
  gl_FragColor = vec4(uColor, across * along * shimmer * uAlpha);
  #include <colorspace_fragment>
}
`;

function airMaterial(
  name: string,
  vert: string,
  frag: string,
  color: number,
  alpha: number,
  additive: boolean,
): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  return m;
}

function points(plan: HammerAirPlan) {
  const motes: [number, number, number][] = [];
  const moteP: [number, number, number, number][] = [];
  plan.motes.forEach((v, vi) => {
    for (let i = 0; i < v.count; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i, k);
      motes.push([v.x + (h(1) - 0.5) * 2 * v.hw, v.y0, v.z + (h(2) - 0.5) * 2 * v.hd]);
      moteP.push([h(3), 0.025 + h(4) * 0.05, 0.25 + h(5) * 0.5, v.y1 - v.y0]);
    }
  });
  const grit: [number, number, number][] = [];
  const gritP: [number, number, number, number][] = [];
  plan.grit.forEach((s, si) => {
    const n = s.heavy ? 22 : 8;
    for (let i = 0; i < n; i++) {
      const h = (k: number) => heartHash(si * 100 + i, k + 40);
      // Tight: a trickle reads as a thread of sand off the lip; spread
      // wide, the streaks read as rain (phase 2D).
      grit.push([
        s.x + (h(1) - 0.5) * (s.heavy ? 0.9 : 0.4),
        s.top,
        s.z + (h(2) - 0.5) * (s.heavy ? 0.9 : 0.4),
      ]);
      gritP.push([h(3), s.heavy ? 0.07 : 0.04, s.heavy ? 6 + h(4) * 4 : 3 + h(4) * 3, s.drop]);
    }
  });
  const haze = plan.haze.map((c) => [c.x, c.y, c.z] as [number, number, number]);
  const hazeP = plan.haze.map(
    (c, i) =>
      [heartHash(i, 91), c.size, 3 + heartHash(i, 93) * 4, 0.32] as [
        number,
        number,
        number,
        number,
      ],
  );
  const geo = plan.geodes.map((g) => [g.x, g.y, g.z] as [number, number, number]);
  const geoP = plan.geodes.map(
    (g, i) => [heartHash(i, 97), g.size, 0, 1] as [number, number, number, number],
  );
  const sMotes: [number, number, number][] = [];
  const sMoteP: [number, number, number, number][] = [];
  plan.shaftMotes.forEach((v, vi) => {
    for (let i = 0; i < v.count; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i + 77_000, k);
      sMotes.push([v.x + (h(1) - 0.5) * 2 * v.hw, v.y0, v.z + (h(2) - 0.5) * 2 * v.hd]);
      sMoteP.push([h(3), 0.025 + h(4) * 0.035, 0.18 + h(5) * 0.3, v.y1 - v.y0]);
    }
  });
  const pool = plan.sunPools.map((c) => [c.x, c.y, c.z] as [number, number, number]);
  const poolP = plan.sunPools.map(
    (c, i) => [heartHash(i, 131), c.size, 0.3, 0.55] as [number, number, number, number],
  );
  const glow = plan.cleftGlows.map((g) => [g.x, g.y, g.z] as [number, number, number]);
  const glowP = plan.cleftGlows.map(
    (g, i) => [heartHash(i, 137), g.size, 0, 1] as [number, number, number, number],
  );
  const shaft = plan.shafts.map((s) => [s.x, s.y0, s.z] as [number, number, number]);
  const shaftP = plan.shafts.map(
    (s) =>
      [s.y1 - s.y0, s.width * s.strength, s.leanX, s.leanZ] as [number, number, number, number],
  );
  return {
    motes,
    moteP,
    grit,
    gritP,
    haze,
    hazeP,
    geo,
    geoP,
    shaft,
    shaftP,
    sMotes,
    sMoteP,
    pool,
    poolP,
    glow,
    glowP,
  };
}

/** The vein's air, instance-local (a cosmetic group: the low tier builds a
 *  third of it). */
export function buildHammerAir(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHammerAir';
  const p = points(planHammerAir(lowGfx ? 0.35 : 1));
  const add = (
    name: string,
    bases: [number, number, number][],
    params: [number, number, number, number][],
    mat: THREE.ShaderMaterial,
    order: number,
  ) => {
    if (bases.length === 0) return;
    const mesh = new THREE.Mesh(quadGeometry(bases, params), mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  add(
    'smithHeartDustMotes',
    p.motes,
    p.moteP,
    airMaterial('smithHeartDustMotes', MOTE_VERT, MOTE_FRAG, 0xffd9a0, 0.4, true),
    5,
  );
  add(
    'smithHeartGrit',
    p.grit,
    p.gritP,
    airMaterial('smithHeartGrit', GRIT_VERT, GRIT_FRAG, 0xb9a080, 0.6, false),
    6,
  );
  add(
    'smithHeartPitHaze',
    p.haze,
    p.hazeP,
    // Grey quarry dust (never an amber wash over the whole pit: phase 2C).
    airMaterial('smithHeartPitHaze', HAZE_VERT, HAZE_FRAG, 0xaaa7a8, 0.12, false),
    4,
  );
  add(
    'smithHeartGeodeHalos',
    p.geo,
    p.geoP,
    airMaterial('smithHeartGeodeHalos', HAZE_VERT, HAZE_FRAG, 0xff9a3a, 0.35, true),
    7,
  );
  add(
    'smithHeartCleftShafts',
    p.shaft,
    p.shaftP,
    // Phase 2D: bright enough to make the raid's first image (2C's 0.13
    // read as a faint smear), still a soft additive veil the door reads through.
    airMaterial('smithHeartCleftShafts', SHAFT_VERT, SHAFT_FRAG, 0xffd29a, 0.3, true),
    8,
  );
  add(
    'smithHeartCleftShaftDust',
    p.sMotes,
    p.sMoteP,
    airMaterial('smithHeartCleftShaftDust', MOTE_VERT, MOTE_FRAG, 0xffe2b0, 0.7, true),
    9,
  );
  add(
    'smithHeartCleftSunPools',
    p.pool,
    p.poolP,
    airMaterial('smithHeartCleftSunPools', HAZE_VERT, HAZE_FRAG, 0xffc884, 0.22, true),
    7,
  );
  add(
    'smithHeartCleftCrystalGlow',
    p.glow,
    p.glowP,
    airMaterial('smithHeartCleftCrystalGlow', HAZE_VERT, HAZE_FRAG, 0xff9636, 0.42, true),
    7,
  );
  return group;
}
