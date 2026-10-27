// The Breath vein's air and weather (plan: breath_air_core.ts): the gale's
// streaks and the grit it carries over every Breath walk, the storm's cloud
// banks rolling past under the Cornice's rim and through the bridge's chasm,
// the Wind Bridge's gusts (a band of wind sweeping down its ramp, a curtain
// riding its front, the bridge's streaks surging with it) and the lightning
// striking the Cornice's rods in turn (the bolt from the cloud, the crown's
// flash). One draw per system, every motion in the vertex shader on the
// shared clock (no per-frame CPU), ribbons and billboards built in view space
// from the camera-relative model-view. Cosmetic: the low tier builds a third
// of the particles; nothing here is a telegraph. Built with the interior, so
// the compile gate links it; no light, no texture.

import * as THREE from 'three';
import { BREATH, WIND_BRIDGE } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';
import {
  BREATH_GUST,
  BREATH_STRIKE,
  BREATH_WIND,
  type BreathAirPlan,
  planBreathAir,
} from './breath_air_core';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { heartHash } from './heart_plan_core';

type V3 = HeartAirV3;
type V4 = HeartAirV4;

/** Merged quads (heart_air_quads.ts). */
const quadGeometry = heartQuadGeometry;

/** The gust's surge on the shared clock (breath_air_core.ts breathGustAt). */
const GUST_GLSL = /* glsl */ `
float gustPhase(float t) {
  float local = t - ${BREATH_GUST.offset.toFixed(2)};
  return local - floor(local / ${BREATH_GUST.period.toFixed(2)}) * ${BREATH_GUST.period.toFixed(2)};
}
float gustStrength(float t) {
  float ph = gustPhase(t);
  return ph < ${BREATH_GUST.sweep.toFixed(2)}
    ? min(1.0, ph / 0.3)
    : max(0.0, 1.0 - (ph - ${BREATH_GUST.sweep.toFixed(2)}) / 1.2);
}
`;

const STREAK_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, length, speed, gust
varying vec2 vCorner;
varying float vFade;
${GUST_GLSL}
void main() {
  float seed = aParams.x;
  float travel = 40.0;
  float s = fract(uTime * aParams.z / travel + seed * 7.13);
  vec3 w = vec3(uWind.x, 0.0, uWind.y);
  vec3 p = position + w * (s - 0.5) * travel;
  p.y += sin(uTime * 0.9 + seed * 20.0) * 0.6 + s * 1.2;
  float g = gustStrength(uTime) * aParams.w;
  float len = aParams.y * (1.0 + g * 1.4);
  vec4 a = modelViewMatrix * vec4(p, 1.0);
  vec4 b = modelViewMatrix * vec4(p + w * len + vec3(0.0, 0.25, 0.0), 1.0);
  vec2 d = b.xy - a.xy;
  float dl = length(d);
  d = dl > 1e-4 ? d / dl : vec2(1.0, 0.0);
  vec2 side = vec2(-d.y, d.x);
  float u = aCorner.x * 0.5 + 0.5;
  vec4 mv = mix(a, b, u);
  mv.xy += side * aCorner.y * (0.035 + 0.04 * g);
  vFade = smoothstep(0.0, 0.18, s) * (1.0 - smoothstep(0.75, 1.0, s));
  vFade *= (0.55 + 0.45 * sin(seed * 31.0)) * (1.0 + g * 1.6);
  vFade *= smoothstep(3.0, 10.0, -mv.z);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vCorner;
varying float vFade;
void main() {
  float u = vCorner.x * 0.5 + 0.5;
  float a = (1.0 - abs(vCorner.y)) * sin(3.14159 * u) * (0.4 + 0.6 * u) * vFade * uAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const GRIT_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, speed, gust
varying vec2 vCorner;
varying float vFade;
${GUST_GLSL}
void main() {
  float seed = aParams.x;
  float travel = 46.0;
  float s = fract(uTime * aParams.z / travel + seed * 5.71);
  vec3 w = vec3(uWind.x, 0.0, uWind.y);
  vec3 p = position + w * (s - 0.5) * travel;
  // Skipping and tumbling along on the gale.
  p.y += abs(sin(uTime * 2.3 + seed * 13.0)) * 1.4;
  float ang = uTime * (4.0 + seed * 6.0) + seed * 9.0;
  vec2 c = vec2(cos(ang) * aCorner.x - sin(ang) * aCorner.y, sin(ang) * aCorner.x + cos(ang) * aCorner.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += c * aParams.y * vec2(1.0, 0.6);
  float g = gustStrength(uTime) * aParams.w;
  vFade = smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.85, 1.0, s)) * (0.7 + g * 0.8);
  vFade *= smoothstep(2.0, 7.0, -mv.z);
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
  // A chip: a broken diamond, not a disc.
  float d = abs(vCorner.x) + abs(vCorner.y) * 1.2;
  if (d > 1.0) discard;
  gl_FragColor = vec4(uColor * (0.8 + 0.3 * vCorner.y), vFade * uAlpha);
  #include <colorspace_fragment>
}
`;

const CLOUD_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, drift, aspect
varying vec2 vCorner;
varying float vSeed;
varying float vFade;
void main() {
  float seed = aParams.x;
  float s = fract(uTime * 0.012 + seed);
  vec3 w = vec3(uWind.x, 0.0, uWind.y);
  vec3 p = position + w * (s - 0.5) * aParams.z;
  p.y += sin(uTime * 0.07 + seed * 6.0) * 1.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.y * vec2(1.0, aParams.w);
  vFade = smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.8, 1.0, s));
  // Never a wall at the lens: a card the camera nears thins away.
  vFade *= smoothstep(6.0, 26.0, -mv.z);
  vCorner = aCorner;
  vSeed = seed;
  gl_Position = projectionMatrix * mv;
}
`;
const CLOUD_FRAG = /* glsl */ `
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
  vec2 q = vCorner * 2.2 + vec2(uTime * 0.05 + vSeed * 9.0, vSeed * 4.0);
  float billow = n(q) * 0.55 + n(q * 2.3 + 3.0) * 0.3 + n(q * 5.1 - 7.0) * 0.15;
  // Torn, lumpy edges: the noise eats the card from its rim inward, so it
  // never reads as a disc.
  float edge = d + (billow - 0.5) * 0.9;
  float a = (1.0 - smoothstep(0.15, 0.85, edge)) * smoothstep(0.32, 0.6, billow) * uAlpha * vFade;
  vec3 col = mix(uShade, uColor, clamp(vCorner.y * 0.5 + 0.55 + billow * 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** The band of wind on the bridge: a sheet a man's height over the deck,
 *  lit where the gust's front runs and trailing behind it. */
const SHEET_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aParams; // along (0 low end, 1 high end), across (-1..1)
varying vec2 vAt;
void main() {
  vAt = aParams.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SHEET_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vAt;
${GUST_GLSL}
void main() {
  float ph = gustPhase(uTime);
  float front = 1.0 - ph / ${BREATH_GUST.sweep.toFixed(2)};
  float g = gustStrength(uTime);
  float lead = exp(-pow((vAt.x - front) * 7.0, 2.0));
  float trail = smoothstep(front - 0.02, front + 0.06, vAt.x) * exp(-(vAt.x - front) * 3.0);
  float lines = smoothstep(0.55, 1.0, sin(vAt.y * 26.0 + sin(vAt.x * 9.0 + uTime) * 1.5) * 0.5 + 0.5);
  float flow = 0.5 + 0.5 * sin(vAt.x * 40.0 + uTime * 22.0 + vAt.y * 5.0);
  float edge = 1.0 - smoothstep(0.75, 1.0, abs(vAt.y));
  float a = (lead * 1.0 + trail * 0.55 * g) * (0.25 + 0.75 * lines * flow) * edge * uAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/** The gust's curtain: an upright veil riding the front down the ramp. */
const CURTAIN_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uHigh;
uniform vec3 uLow;
uniform vec2 uAcross;
attribute vec2 aCorner;
attribute vec4 aParams; // half width, height
varying vec2 vCorner;
varying float vFade;
${GUST_GLSL}
void main() {
  float ph = gustPhase(uTime);
  float front = clamp(ph / ${BREATH_GUST.sweep.toFixed(2)}, 0.0, 1.0);
  vec3 c = mix(uHigh, uLow, front);
  vec3 p = c + vec3(uAcross.x, 0.0, uAcross.y) * aCorner.x * aParams.x;
  p.y += (aCorner.y * 0.5 + 0.5) * aParams.y + 0.2;
  vFade = ph < ${BREATH_GUST.sweep.toFixed(2)} ? smoothstep(0.0, 0.25, ph) * (1.0 - smoothstep(0.8, 1.0, front)) : 0.0;
  vCorner = aCorner;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying vec2 vCorner;
varying float vFade;
void main() {
  float up = vCorner.y * 0.5 + 0.5;
  float streak = 0.5 + 0.5 * sin(vCorner.x * 31.0 + up * 6.0 + uTime * 14.0);
  float a = (1.0 - smoothstep(0.2, 1.0, up)) * (1.0 - smoothstep(0.8, 1.0, abs(vCorner.x)))
    * (0.35 + 0.65 * streak) * vFade * uAlpha;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/** A strike's bolt: segments of a jagged path from the cloud to a crown,
 *  shown only while that rod's strike flashes. */
const BOLT_VERT = /* glsl */ `
uniform float uTime;
uniform float uRods;
attribute vec3 aOther;
attribute vec2 aCorner;
attribute vec4 aParams; // rod, width, along (0 crown .. 1 cloud), branch
varying float vShow;
varying vec2 vCorner;
float fr(float v) { return v - floor(v); }
void main() {
  float k = floor(uTime / ${BREATH_STRIKE.cell.toFixed(2)});
  float at = k * ${BREATH_STRIKE.cell.toFixed(2)} + fr(k * 0.618) * ${(BREATH_STRIKE.cell - 1).toFixed(2)};
  float since = uTime - at;
  float rod = mod(k * ${BREATH_STRIKE.stride.toFixed(1)} + 2.0, uRods);
  float on = step(abs(rod - aParams.x), 0.5) * step(0.0, since) * step(since, ${BREATH_STRIKE.flash.toFixed(2)});
  // It grows down from the cloud in the first twentieth of a second, then
  // flickers twice.
  float grown = step(1.0 - since / 0.05, aParams.z + 0.001);
  float flick = since < 0.12 ? 1.0 : (since > 0.2 && since < 0.3 ? 0.8 : 0.25);
  vShow = on * grown * flick * (aParams.w > 0.5 ? 0.6 : 1.0);
  vec4 a = modelViewMatrix * vec4(position, 1.0);
  vec4 b = modelViewMatrix * vec4(aOther, 1.0);
  vec2 d = b.xy - a.xy;
  float dl = length(d);
  d = dl > 1e-4 ? d / dl : vec2(0.0, 1.0);
  vec4 mv = mix(a, b, aCorner.x * 0.5 + 0.5);
  mv.xy += vec2(-d.y, d.x) * aCorner.y * aParams.y;
  vCorner = aCorner;
  gl_Position = vShow > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;
const BOLT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vShow;
varying vec2 vCorner;
void main() {
  float core = 1.0 - smoothstep(0.0, 0.45, abs(vCorner.y));
  float glow = 1.0 - abs(vCorner.y);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core) * (core * 2.0 + glow * 0.6), glow * vShow);
  #include <colorspace_fragment>
}
`;

/** A rod crown's halo: dim always, a great white-teal flash on its strike. */
const HALO_VERT = /* glsl */ `
uniform float uTime;
uniform float uRods;
attribute vec2 aCorner;
attribute vec4 aParams; // rod, size
varying vec2 vCorner;
varying float vGlow;
float fr(float v) { return v - floor(v); }
void main() {
  float k = floor(uTime / ${BREATH_STRIKE.cell.toFixed(2)});
  float at = k * ${BREATH_STRIKE.cell.toFixed(2)} + fr(k * 0.618) * ${(BREATH_STRIKE.cell - 1).toFixed(2)};
  float since = uTime - at;
  float rod = mod(k * ${BREATH_STRIKE.stride.toFixed(1)} + 2.0, uRods);
  float hit = step(abs(rod - aParams.x), 0.5) * step(0.0, since) * exp(-max(0.0, since) * 3.5);
  vGlow = 0.22 + 0.1 * sin(uTime * 1.3 + aParams.x * 2.0) + hit * 2.4;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += aCorner * aParams.y * (1.0 + hit * 2.2);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}
`;
const HALO_FRAG = /* glsl */ `
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

function airMaterial(
  name: string,
  vert: string,
  frag: string,
  color: number,
  alpha: number,
  additive: boolean,
  extra: Record<string, THREE.IUniform> = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uWind: { value: new THREE.Vector2(BREATH_WIND[0], BREATH_WIND[1]) },
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      ...extra,
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function particles(plan: BreathAirPlan) {
  const streaks: V3[] = [];
  const streakP: V4[] = [];
  const grit: V3[] = [];
  const gritP: V4[] = [];
  plan.volumes.forEach((v, vi) => {
    for (let i = 0; i < v.streaks; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i, k + 300);
      streaks.push([
        v.x + (h(1) - 0.5) * 2 * v.hw,
        v.y0 + h(2) * (v.y1 - v.y0),
        v.z + (h(3) - 0.5) * 2 * v.hd,
      ]);
      streakP.push([h(4), 3 + h(5) * 5, 9 + h(6) * 9, v.gust]);
    }
    for (let i = 0; i < v.grit; i++) {
      const h = (k: number) => heartHash(vi * 1000 + i, k + 500);
      grit.push([
        v.x + (h(1) - 0.5) * 2 * v.hw,
        v.y0 - 0.4 + h(2) * (v.y1 - v.y0) * 0.4,
        v.z + (h(3) - 0.5) * 2 * v.hd,
      ]);
      gritP.push([h(4), 0.06 + h(5) * 0.12, 12 + h(6) * 10, v.gust]);
    }
  });
  const clouds = plan.clouds.map((c) => [c.x, c.y, c.z] as V3);
  const cloudP = plan.clouds.map((c, i) => [heartHash(i, 601), c.size, 24, 0.45] as V4);
  return { streaks, streakP, grit, gritP, clouds, cloudP };
}

/** The Wind Bridge's deck sheet: a strip a man's height over the ramp,
 *  `aParams.xy` its along (0 low end, 1 high end) and across (-1..1). */
function gustSheet(): THREE.BufferGeometry {
  const a = { x: WIND_BRIDGE.fromX, z: WIND_BRIDGE.fromZ, y: BREATH.b2.h };
  const b = { x: WIND_BRIDGE.toX, z: WIND_BRIDGE.toZ, y: BREATH.b3.h };
  const run = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / run;
  const uz = (b.z - a.z) / run;
  const half = WIND_BRIDGE.halfWidth + 0.5;
  const steps = 24;
  const pos: number[] = [];
  const prm: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    for (const s of [-1, 0, 1]) {
      pos.push(
        a.x + ux * run * t + uz * s * half,
        a.y + (b.y - a.y) * t + 1.3,
        a.z + uz * run * t - ux * s * half,
      );
      prm.push(t, s, 0, 0);
    }
  }
  for (let i = 0; i < steps; i++)
    for (let k = 0; k < 2; k++) {
      const p = i * 3 + k;
      idx.push(p, p + 1, p + 3, p + 1, p + 4, p + 3);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aParams', new THREE.Float32BufferAttribute(prm, 4));
  g.setAttribute(
    'aCorner',
    new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2),
  );
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Each rod's bolt: a jagged path from the cloud base down to its crown,
 *  and a branch off it, as segments. */
function boltSegments(plan: BreathAirPlan): { a: V3[]; b: V3[]; p: V4[] } {
  const a: V3[] = [];
  const b: V3[] = [];
  const p: V4[] = [];
  plan.crowns.forEach((c, rod) => {
    const top = c.y + 70;
    const segs = 14;
    let x = c.x + (heartHash(rod, 1) - 0.5) * 30;
    let z = c.z + (heartHash(rod, 2) - 0.5) * 30;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = top + (c.y - top) * t;
      const pull = t * t;
      const jx = (heartHash(rod * 31 + i, 3) - 0.5) * 7 * (1 - t);
      const jz = (heartHash(rod * 31 + i, 4) - 0.5) * 7 * (1 - t);
      pts.push([x + (c.x - x) * pull + jx, y, z + (c.z - z) * pull + jz]);
    }
    x = c.x;
    z = c.z;
    for (let i = 0; i < segs; i++) {
      const along = 1 - (i + 0.5) / segs;
      a.push(pts[i]);
      b.push(pts[i + 1]);
      p.push([rod, 0.5 + 0.35 * (1 - along), along, 0]);
    }
    // A branch off its upper third.
    const r0 = pts[4];
    let bx = r0[0];
    let by = r0[1];
    let bz = r0[2];
    for (let i = 0; i < 5; i++) {
      const nx = bx + (heartHash(rod, 10 + i) - 0.3) * 6;
      const ny = by - 4 - heartHash(rod, 20 + i) * 3;
      const nz = bz + (heartHash(rod, 30 + i) - 0.5) * 6;
      a.push([bx, by, bz]);
      b.push([nx, ny, nz]);
      p.push([rod, 0.3, 1 - (4 + i) / segs, 1]);
      bx = nx;
      by = ny;
      bz = nz;
    }
  });
  return { a, b, p };
}

/** The Breath's air and weather, instance-local (cosmetic: the low tier
 *  builds a third of the particles; the strikes and the gusts stay). */
export function buildBreathAir(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartBreathAir';
  const plan = planBreathAir(lowGfx ? 0.35 : 1);
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
  add(
    'smithHeartBreathClouds',
    quadGeometry(p.clouds, p.cloudP),
    airMaterial('smithHeartBreathClouds', CLOUD_VERT, CLOUD_FRAG, 0xc4ccd6, 0.42, false, {
      uShade: { value: new THREE.Color(0x6c7684) },
    }),
    3,
  );
  add(
    'smithHeartBreathStreaks',
    quadGeometry(p.streaks, p.streakP),
    airMaterial('smithHeartBreathStreaks', STREAK_VERT, STREAK_FRAG, 0xe8f4fa, 0.55, false),
    6,
  );
  add(
    'smithHeartBreathGrit',
    quadGeometry(p.grit, p.gritP),
    airMaterial('smithHeartBreathGrit', GRIT_VERT, GRIT_FRAG, 0x5c636c, 0.85, false),
    6,
  );
  add(
    'smithHeartBreathGustSheet',
    gustSheet(),
    airMaterial('smithHeartBreathGustSheet', SHEET_VERT, SHEET_FRAG, 0xeaf6fc, 0.42, false),
    7,
  );
  const hi = { x: WIND_BRIDGE.toX, z: WIND_BRIDGE.toZ };
  const lo = { x: WIND_BRIDGE.fromX, z: WIND_BRIDGE.fromZ };
  const run = Math.hypot(hi.x - lo.x, hi.z - lo.z);
  add(
    'smithHeartBreathGustCurtain',
    quadGeometry([[0, 0, 0]], [[WIND_BRIDGE.halfWidth + 1.5, 5.5, 0, 0]]),
    airMaterial('smithHeartBreathGustCurtain', CURTAIN_VERT, CURTAIN_FRAG, 0xeef8fd, 0.32, false, {
      uHigh: { value: new THREE.Vector3(hi.x, BREATH.b3.h, hi.z) },
      uLow: { value: new THREE.Vector3(lo.x, BREATH.b2.h, lo.z) },
      uAcross: { value: new THREE.Vector2((hi.z - lo.z) / run, -(hi.x - lo.x) / run) },
    }),
    8,
  );
  const rods = { value: Math.max(1, plan.crowns.length) };
  const bolts = boltSegments(plan);
  add(
    'smithHeartBreathBolts',
    quadGeometry(bolts.a, bolts.p, bolts.b),
    airMaterial('smithHeartBreathBolts', BOLT_VERT, BOLT_FRAG, 0x9fe4ff, 1, true, { uRods: rods }),
    9,
  );
  add(
    'smithHeartBreathCrownHalos',
    quadGeometry(
      plan.crowns.map((c) => [c.x, c.y, c.z] as V3),
      plan.crowns.map((_, i) => [i, 2.4, 0, 0] as V4),
    ),
    airMaterial('smithHeartBreathCrownHalos', HALO_VERT, HALO_FRAG, 0x8fd8f4, 1, true, {
      uRods: rods,
    }),
    9,
  );
  return group;
}
