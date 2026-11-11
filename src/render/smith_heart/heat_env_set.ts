// The Heat's set round its hall (plan: heat_env_set_core.ts): the crusted magma lake the
// hall stands over, the molten falls flowing down the cliffs into it, the glow where each
// lands and round the cliffs' feet, the smoke climbing between the tiers. Drawn only from
// the Heat (the rock's open uniform, heart_rock_cutaway.ts `heartRockHeatOpenUniform`): the
// lake dissolves on the rock's camera dither, the rest fades with it. Cosmetic: the low
// tier keeps a third of the smoke; the lake, the falls and the glows draw on every tier.
// Built with the interior, so the compile gate links every program; every motion runs in
// the shaders on the shared clock; no light, no texture.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { HALO_VERT } from './heart_fire_glsl';
import { heartHash } from './heart_plan_core';
import { heartRockHeatOpenUniform } from './heart_rock_cutaway';
import { SMOKE_FRAG, SMOKE_VERT } from './heat_air';
import { type HeatFallRibbon, heatLakeMesh, planHeatSet } from './heat_env_set_core';

/** The lake's crust plates across (yards). */
const HEAT_LAKE_PLATE = 9;

/** The most falls the lake knows the landing of (its hot spots). */
const LAKE_FALLS = 8;

/** The set's colours (linear): the lake's crust and its fire, the falls' body and core
 *  (an orange, never the guardian's yellow-white), the glows. */
export const HEAT_SET_LOOK = {
  crust: [0.03, 0.022, 0.024],
  crustLit: [0.07, 0.045, 0.04],
  fire: [0.95, 0.24, 0.035],
  hot: [1.0, 0.5, 0.1],
  lakeGlow: 1.35,
  fall: 0xe85010,
  fallCore: 0xffa040,
  glow: 0xd85a1a,
  smoke: 0x463c40,
  smokeLit: 0x7a4632,
} as const;

const v3 = (c: readonly number[]) => `vec3( ${c.map((x) => x.toFixed(3)).join(', ')} )`;

const NOISE = /* glsl */ `
float hsH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hsN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hsH(i), hsH(i + vec2(1, 0)), f.x), mix(hsH(i + vec2(0, 1)), hsH(i + vec2(1, 1)), f.x), f.y);
}
float hsDither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
`;

const LAKE_VERT = /* glsl */ `
varying vec3 vP;
#include <fog_pars_vertex>
void main() {
  vP = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** The lake: dark crust plates drifting slow, thin glowing cracks between them, here and
 *  there an open pool of fire, hot round every fall's landing; it breathes. */
const LAKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeatOpen;
uniform vec4 uFalls[${LAKE_FALLS}];
varying vec3 vP;
${NOISE}
#include <fog_pars_fragment>
void main() {
  if (uHeatOpen <= hsDither()) discard;
  vec2 p = vP.xz;
  vec2 drift = vec2(uTime * 0.012, uTime * 0.007);
  // Crust plates (cells about ${HEAT_LAKE_PLATE} yd across) split by thin cracks of fire
  // of one width (the gap between the nearest two cell points), drifting slow.
  vec2 q = (p + drift * 40.0) / ${HEAT_LAKE_PLATE.toFixed(1)};
  vec2 qi = floor(q);
  float d1 = 9.0;
  float d2 = 9.0;
  float b = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = qi + vec2(float(i), float(j));
      vec2 o = vec2(hsH(c), hsH(c + 17.3));
      o = 0.5 + 0.42 * sin(uTime * 0.05 + 6.2831 * o);
      float d = length(c + o - q);
      if (d < d1) { d2 = d1; d1 = d; b = hsH(c + 3.1); }
      else if (d < d2) d2 = d;
    }
  float edge = d2 - d1;
  float w = fwidth(edge);
  float crack = (1.0 - smoothstep(0.04, 0.04 + w * 1.5, edge)) * min(1.0, 0.06 / max(w, 1e-4));
  float pool = smoothstep(0.8, 0.9, hsN(p * 0.018 + drift * 0.5 + 9.1));
  float heat = max(crack * 0.6, pool * 0.8);
  float cell = b;
  for (int i = 0; i < ${LAKE_FALLS}; i++) {
    vec4 f = uFalls[i];
    heat = max(heat, f.w * (1.0 - smoothstep(f.z * 0.25, f.z, length(p - f.xy))));
  }
  float breath = 0.82 + 0.18 * sin(uTime * 1.1 + cell * 11.0);
  vec3 crust = mix(${v3(HEAT_SET_LOOK.crust)}, ${v3(HEAT_SET_LOOK.crustLit)}, b);
  vec3 fire = mix(${v3(HEAT_SET_LOOK.fire)}, ${v3(HEAT_SET_LOOK.hot)}, smoothstep(0.6, 1.0, heat));
  vec3 col = mix(crust, fire * ${HEAT_SET_LOOK.lakeGlow.toFixed(2)} * breath, heat);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const FALL_VERT = /* glsl */ `
attribute vec2 aStrip; // down (0 the ledge, 1 the lake), across (-1 .. 1)
attribute float aLen;  // yards down from the ledge
varying vec2 vStrip;
varying float vLen;
void main() {
  vStrip = aStrip;
  vLen = aLen;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A fall: streaks of molten running down from its ledge, ragged at its sides, its core
 *  brighter, gathering speed as it drops (a streak at sqrt(yards fallen) = clock times a
 *  rate falls ever faster, as a pour does). */
const FALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeatOpen;
uniform vec3 uFire;
uniform vec3 uCore;
varying vec2 vStrip;
varying float vLen;
${NOISE}
void main() {
  float across = abs(vStrip.y);
  // Down the fall, quickening as it drops: the streaks ride sqrt(yards fallen) against the
  // clock, so each runs down at a speed growing with the drop (never the clock times a
  // position, which turns the flow round once the clock has run a while).
  float fallen = sqrt(max(vLen, 0.0));
  float runs = hsN(vec2(vStrip.y * 4.0, fallen * 1.1 - uTime * 1.3)) * 0.6
    + hsN(vec2(vStrip.y * 9.0 + 2.0, fallen * 2.6 - uTime * 2.2)) * 0.4;
  float body = (1.0 - smoothstep(0.4 + runs * 0.35, 1.0, across)) * (0.55 + 0.6 * runs);
  float ends = smoothstep(0.0, 0.03, vStrip.x) * (1.0 - smoothstep(0.96, 1.0, vStrip.x));
  float a = body * ends * uHeatOpen;
  if (a <= 0.003) discard;
  vec3 col = mix(uFire, uCore, smoothstep(0.55, 0.95, runs) * (1.0 - across)) * a * 1.35;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** A glow (the halos' card), faded with the open uniform. */
const GLOW_OPEN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uHeatOpen;
varying vec2 vCorner;
varying float vGlow;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * vGlow * uHeatOpen;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}
`;

/** The smoke's own shader, faded with the open uniform too. */
function smokeOpenFrag(): string {
  const anchor = '* vFade * uAlpha;';
  if (!SMOKE_FRAG.includes(anchor)) throw new Error('heat set: smoke shader changed');
  return SMOKE_FRAG.replace('uniform float uAlpha;', 'uniform float uAlpha;\nuniform float uHeatOpen;').replace(
    anchor,
    '* vFade * uAlpha * uHeatOpen;',
  );
}

const col = (hex: number) => ({ value: new THREE.Color(hex) });

function setMaterial(
  name: string,
  vert: string,
  frag: string,
  extra: Record<string, THREE.IUniform>,
  additive: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { uTime: sharedUniforms.uTime, uHeatOpen: heartRockHeatOpenUniform(), ...extra },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
}

/** Every fall's ribbon in one geometry: down from its ledge to the lake, a little wider
 *  as it drops, wavering. */
function fallGeometry(falls: readonly HeatFallRibbon[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const strip: number[] = [];
  const len: number[] = [];
  const idx: number[] = [];
  const steps = 28;
  let base = 0;
  falls.forEach((f, fi) => {
    const drop = f.top.y - f.foot.y;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const sway = Math.sin(t * 5 + fi * 1.7) * 0.6 * t;
      const x = f.top.x + (f.foot.x - f.top.x) * t * t + f.side.x * sway;
      const z = f.top.z + (f.foot.z - f.top.z) * t * t + f.side.z * sway;
      const y = f.top.y - drop * t;
      const half = f.half * (0.8 + 0.5 * t);
      for (const s of [-1, 1]) {
        pos.push(x + f.side.x * half * s, y, z + f.side.z * half * s);
        strip.push(t, s);
        len.push(drop * t);
      }
      if (k > 0) {
        const a = base + (k - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    base += (steps + 1) * 2;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aStrip', new THREE.Float32BufferAttribute(strip, 2));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The Heat's set, instance-local. */
export function buildHeatEnvSet(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHeatEnvSet';
  const plan = planHeatSet(lowGfx ? 0.35 : 1);
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  };
  // The lake.
  const lake = heatLakeMesh();
  const lakeGeo = new THREE.BufferGeometry();
  lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(lake.positions, 3));
  lakeGeo.setIndex(lake.indices);
  lakeGeo.computeBoundingSphere();
  const landings = Array.from({ length: LAKE_FALLS }, (_, i) => {
    const f = plan.falls[i];
    return f ? new THREE.Vector4(f.foot.x, f.foot.z, 30, 1) : new THREE.Vector4(0, 0, 1, 0);
  });
  const lakeMat = new THREE.ShaderMaterial({
    name: 'smithHeartHeatLake',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uFalls: { value: landings } }]),
    vertexShader: LAKE_VERT,
    fragmentShader: LAKE_FRAG,
    fog: true,
  });
  // The merge clones its inputs: the shared clock and the open uniform are bound after.
  lakeMat.uniforms.uTime = sharedUniforms.uTime;
  lakeMat.uniforms.uHeatOpen = heartRockHeatOpenUniform();
  add('smithHeartHeatLake', lakeGeo, lakeMat, 0);
  // The falls.
  add(
    'smithHeartHeatFalls',
    fallGeometry(plan.falls),
    setMaterial(
      'smithHeartHeatFalls',
      FALL_VERT,
      FALL_FRAG,
      { uFire: col(HEAT_SET_LOOK.fall), uCore: col(HEAT_SET_LOOK.fallCore) },
      true,
    ),
    8,
  );
  // The glows: where each fall lands, round the cliffs' feet.
  add(
    'smithHeartHeatSetGlows',
    heartQuadGeometry(
      plan.glows.map((g) => [g.x, g.y, g.z] as HeartAirV3),
      plan.glows.map((g, i) => [heartHash(i, 4801), g.size, 0, 0] as HeartAirV4),
    ),
    setMaterial('smithHeartHeatSetGlows', HALO_VERT, GLOW_OPEN_FRAG, { uColor: col(HEAT_SET_LOOK.glow) }, true),
    8,
  );
  // The smoke between the tiers.
  const smoke: HeartAirV3[] = [];
  const smokeP: HeartAirV4[] = [];
  plan.smoke.forEach((s, si) => {
    const puffs = lowGfx ? 4 : 9;
    for (let i = 0; i < puffs; i++) {
      smoke.push([s.x, s.y, s.z]);
      smokeP.push([(i + heartHash(si, i + 4850) * 0.5) / puffs, s.rise, 1.6 + heartHash(si, i) * 1.0, s.size]);
    }
  });
  add(
    'smithHeartHeatSetSmoke',
    heartQuadGeometry(smoke, smokeP),
    setMaterial(
      'smithHeartHeatSetSmoke',
      SMOKE_VERT,
      smokeOpenFrag(),
      { uColor: col(HEAT_SET_LOOK.smoke), uLit: col(HEAT_SET_LOOK.smokeLit), uAlpha: { value: 0.36 } },
      false,
    ),
    7,
  );
  return group;
}
