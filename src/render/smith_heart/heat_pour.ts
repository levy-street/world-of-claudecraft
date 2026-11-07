// The pour, the Heat's set piece's look (plan and timeline:
// heat_pour_core.ts): on its fixed cycle the wellspring brims and glows, the
// Pour Channel's bed lights from the wellspring down to the casting floor's
// south lip before anything arrives, a stream of white-gold fire runs down
// it, fills it, pours off the lip into the chasm in a burning fall and drains
// away, the bed cooling dark. The mechanic is not built (section 6.4): this
// is its look only, in the vein's white-gold, never a threat colour.
//
// Readability: the channel's warning glow, the flow and the fall draw on
// every graphics tier (they are what the mechanic will ask a player to
// read); the sparks shed on the low tier. The channel is a floor mark on the
// floor ladder's ground rung, under every telegraph. Every motion runs in
// the shaders on the shared clock (the core's arithmetic); built with the
// interior, so the compile gate links it; no light, no texture.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { GLOW_FRAG } from './heart_fire_glsl';
import { heartHash } from './heart_plan_core';
import { HEAT_POUR, heatPourPath } from './heat_pour_core';

const f2 = (v: number) => v.toFixed(2);

/** How far the fall leans out per yard it drops (the rock edge's flare). */
const HEAT_FALL_LEAN = 0.42;

/** The pour's timeline in GLSL (heat_pour_core.ts heatPourLook, the same
 *  arithmetic). */
const POUR_GLSL = /* glsl */ `
uniform float uTime;
float pourSm(float v) { v = clamp(v, 0.0, 1.0); return v * v * (3.0 - 2.0 * v); }
float pourSince() { return mod(uTime, ${f2(HEAT_POUR.cycle)}); }
const float P_BRIM = ${f2(HEAT_POUR.brim)};
const float P_FULL = ${f2(HEAT_POUR.brim + HEAT_POUR.run)};
const float P_DRAIN = ${f2(HEAT_POUR.brim + HEAT_POUR.run + HEAT_POUR.hold)};
const float P_DONE = ${f2(HEAT_POUR.brim + HEAT_POUR.run + HEAT_POUR.hold + HEAT_POUR.drain)};
const float P_WARN = ${f2(HEAT_POUR.brim * (1 - HEAT_POUR.warn))};
float pourBrim(float s) {
  return s < P_BRIM ? pourSm(s / P_BRIM) : s < P_DRAIN ? 1.0 : s < P_DONE ? 1.0 - pourSm((s - P_DRAIN) / ${f2(HEAT_POUR.drain)}) : 0.0;
}
float pourWarnFront(float s) {
  return s < P_WARN ? 0.0 : s < P_BRIM ? pourSm((s - P_WARN) / (P_BRIM - P_WARN)) : 1.0;
}
float pourWarn(float s) {
  return s < P_WARN ? 0.0 : s < P_DONE ? min(1.0, (s - P_WARN) / 0.6) * (1.0 - pourSm((s - P_DRAIN) / ${f2(HEAT_POUR.drain)})) : 0.0;
}
float pourFront(float s) {
  return s < P_BRIM ? 0.0 : s < P_DONE ? pourSm((s - P_BRIM) / ${f2(HEAT_POUR.run)}) : 0.0;
}
float pourFill(float s) {
  return s < P_BRIM ? 0.0 : s < P_DRAIN ? 1.0 : s < P_DONE ? 1.0 - pourSm((s - P_DRAIN) / ${f2(HEAT_POUR.drain)}) : 0.0;
}
float pourFall(float s) {
  return s >= P_FULL && s < P_DONE ? pourFill(s) * pourSm((s - P_FULL) / 0.4) : 0.0;
}
float pourHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pourNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pourHash(i), pourHash(i + vec2(1, 0)), f.x), mix(pourHash(i + vec2(0, 1)), pourHash(i + vec2(1, 1)), f.x), f.y);
}
`;

const STRIP_VERT = /* glsl */ `
attribute vec2 aStrip; // along (0 the wellspring, 1 the lip), across (-1 .. 1)
attribute float aLen;  // yards along from the wellspring
varying vec2 vStrip;
varying float vLen;
void main() {
  vStrip = aStrip;
  vLen = aLen;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The channel: the residue's faint line always; the warning glow lighting
 *  the bed down to its running front (its edge bright); the flow's
 *  white-gold body running behind its front, rippling down the channel,
 *  crusting dark as it drains. */
const CHANNEL_FRAG = /* glsl */ `
${POUR_GLSL}
uniform vec3 uResidue;
uniform vec3 uWarn;
uniform vec3 uFire;
uniform vec3 uCore;
varying vec2 vStrip;
varying float vLen;
void main() {
  float s = pourSince();
  float u = vStrip.x;
  float across = abs(vStrip.y);
  float bed = 1.0 - smoothstep(0.7, 1.0, across);
  float line = 1.0 - smoothstep(0.0, 0.14, across);
  vec3 col = uResidue * line * 0.35;
  float a = line * 0.2;
  // The warning: the bed lit down to its running front.
  float wf = pourWarnFront(s);
  float w = pourWarn(s);
  float reached = 1.0 - smoothstep(wf - 0.01, wf + 0.025, u);
  float lag = (u - wf) * 22.0;
  float edge = exp(-lag * lag) * step(wf, 0.999);
  float throb = 0.72 + 0.28 * sin(uTime * 5.0 - vLen * 0.9);
  float warn = w * bed * (reached * (0.3 + 0.25 * line) * throb + edge * 0.7);
  col += uWarn * warn;
  a = max(a, warn);
  // The flow.
  float fr = pourFront(s);
  float fill = pourFill(s);
  float inFlow = 1.0 - smoothstep(fr - 0.004, fr + 0.012, u);
  float rip = pourNoise(vec2(vLen * 0.55 - uTime * 3.2, vStrip.y * 2.5)) * 0.6
    + pourNoise(vec2(vLen * 1.4 - uTime * 5.0, vStrip.y * 5.0 + 3.0)) * 0.4;
  float crust = (1.0 - fill) * smoothstep(0.45, 0.65, pourNoise(vec2(vLen * 0.8, vStrip.y * 3.0) + 7.0));
  float lead = exp(-((u - fr) * 30.0) * ((u - fr) * 30.0)) * step(fr, 0.999);
  float flow = fill * inFlow * bed * (0.7 + 0.45 * rip) * (1.0 - crust * 0.85) + lead * fill * bed * 0.8;
  col += mix(uFire, uCore, smoothstep(0.45, 0.85, rip) * (1.0 - across)) * flow * 1.35;
  a = max(a, flow);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
/** The fall off the lip: streaks of fire running down, brightest at the
 *  lip, ragged at its sides. */
const FALL_FRAG = /* glsl */ `
${POUR_GLSL}
uniform vec3 uFire;
uniform vec3 uCore;
varying vec2 vStrip;
varying float vLen;
void main() {
  float s = pourSince();
  float k = pourFall(s);
  if (k <= 0.001) discard;
  float across = abs(vStrip.y);
  float runs = pourNoise(vec2(vStrip.y * 4.0, vLen * 0.35 + uTime * 6.0)) * 0.6
    + pourNoise(vec2(vStrip.y * 9.0 + 2.0, vLen * 0.8 + uTime * 9.0)) * 0.4;
  float body = (1.0 - smoothstep(0.55 + runs * 0.3, 1.0, across)) * (0.6 + 0.6 * runs);
  float down = 1.0 - smoothstep(0.55, 1.0, vStrip.x);
  float a = body * down * k;
  vec3 col = mix(uFire, uCore, smoothstep(0.5, 0.9, runs) * (1.0 - vStrip.x)) * a * 1.4;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const DISC_VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aParams; // seed, radius
varying vec2 vCorner;
void main() {
  vec3 p = position + vec3(aCorner.x, 0.0, -aCorner.y) * aParams.y;
  vCorner = aCorner;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;
/** The wellspring brimming: its surface flaring white-gold, swelling. */
const BRIM_FRAG = /* glsl */ `
${POUR_GLSL}
uniform vec3 uFire;
uniform vec3 uCore;
varying vec2 vCorner;
void main() {
  float d = length(vCorner);
  if (d > 1.0) discard;
  float k = pourBrim(pourSince());
  float boil = pourNoise(vCorner * 4.0 + vec2(uTime * 1.3, -uTime * 0.9));
  float a = (1.0 - d * d) * (0.15 + 0.85 * k) * (0.75 + 0.35 * boil);
  vec3 col = mix(uFire, uCore, (1.0 - d) * (0.4 + 0.6 * k)) * a * 1.3;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** A halo over the wellspring and at the fall's foot, gated by the pour. */
const GATED_HALO_VERT = /* glsl */ `
${POUR_GLSL}
attribute vec2 aCorner;
attribute vec4 aParams; // seed, size, gate (0 the brim, 1 the fall)
varying vec2 vCorner;
varying float vGlow;
void main() {
  float s = pourSince();
  float k = aParams.z < 0.5 ? pourBrim(s) : pourFall(s);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += aCorner * aParams.y * (0.6 + 0.5 * k);
  vGlow = k * (0.85 + 0.15 * sin(uTime * 7.0 + aParams.x * 9.0));
  vGlow *= 0.3 + 0.7 * smoothstep(5.0, 18.0, -mv.z);
  vCorner = aCorner;
  gl_Position = vGlow > 0.001 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

/** Sparks flung up off the brim and off the lip, gated by the pour. */
const SPARK_VERT = /* glsl */ `
${POUR_GLSL}
attribute vec2 aCorner;
attribute vec4 aParams; // seed, gate, speed, size
varying vec2 vCorner;
varying float vGlow;
void main() {
  float s = pourSince();
  float k = aParams.y < 0.5 ? pourBrim(s) * step(0.35, pourBrim(s)) : pourFall(s);
  float life = fract(uTime * 0.9 + aParams.x * 7.3);
  float a = aParams.x * 6.2831853 * 3.0;
  vec3 p = position;
  p.x += cos(a) * aParams.z * life;
  p.z += sin(a) * aParams.z * life;
  p.y += (aParams.z * 2.2 * life - 6.0 * life * life);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += aCorner * aParams.w;
  vGlow = k * (1.0 - life);
  vCorner = aCorner;
  gl_Position = vGlow > 0.001 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

function pourMaterial(
  name: string,
  vert: string,
  frag: string,
  extra: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: { uTime: sharedUniforms.uTime, ...extra },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const col = (hex: number) => ({ value: new THREE.Color(hex) });

/** A ribbon along a polyline of points, `half` across each point's own
 *  side vector; `aStrip` (along 0..1, across -1..1) and `aLen` (yards). */
function ribbon(
  pts: readonly THREE.Vector3[],
  sides: readonly THREE.Vector3[],
  halves: readonly number[],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const strip: number[] = [];
  const len: number[] = [];
  const idx: number[] = [];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    total += pts[i].distanceTo(pts[i - 1]);
    cum.push(total);
  }
  for (let i = 0; i < pts.length; i++) {
    for (const s of [-1, 1]) {
      pos.push(
        pts[i].x + sides[i].x * halves[i] * s,
        pts[i].y + sides[i].y * halves[i] * s,
        pts[i].z + sides[i].z * halves[i] * s,
      );
      strip.push(cum[i] / Math.max(1e-6, total), s);
      len.push(cum[i]);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aStrip', new THREE.Float32BufferAttribute(strip, 2));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The pour, instance-local (its warning glow, flow and fall on every tier;
 *  the sparks shed on the low tier). */
export function buildHeatPour(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartHeatPour';
  const P = heatPourPath();
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
  const fire = col(0xffb848);
  const core = col(0xfff0c8);
  // The channel: from the wellspring's lip down its chute to the channel's
  // head, then down the channel to the floor's south lip.
  const pts: THREE.Vector3[] = [];
  const sides: THREE.Vector3[] = [];
  const halves: number[] = [];
  const across = new THREE.Vector3(1, 0, 0);
  const chuteTop = P.brim.z - 1.3;
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    const z = chuteTop + (P.z1 - chuteTop) * t;
    const y = P.brim.y - 0.15 + (P.y + 0.04 - (P.brim.y - 0.15)) * (t * t * (3 - 2 * t));
    pts.push(new THREE.Vector3(P.x, y + 0.03, z));
    sides.push(across);
    halves.push(0.55 + (P.half - 0.55) * t);
  }
  const steps = 48;
  for (let k = 1; k <= steps; k++) {
    const z = P.z1 + (P.z0 - P.z1) * (k / steps);
    pts.push(new THREE.Vector3(P.x, P.y + 0.04, z));
    sides.push(across);
    halves.push(P.half);
  }
  add(
    'smithHeartHeatPourChannel',
    ribbon(pts, sides, halves),
    pourMaterial('smithHeartHeatPourChannel', STRIP_VERT, CHANNEL_FRAG, {
      uResidue: col(0xa05a18),
      uWarn: col(0xffa838),
      uFire: fire,
      uCore: core,
    }),
    floorVfxRenderOrder('ground', 5),
  );
  // The fall off the lip, down the cliff's face into the chasm.
  const fall: THREE.Vector3[] = [];
  const fallSides: THREE.Vector3[] = [];
  const fallHalves: number[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    // Out along the cliff's flare (the rock edge leans out as it falls),
    // so the fall runs down its face, never inside it.
    fall.push(new THREE.Vector3(P.x, P.y + 0.05 - t * 26, P.z0 - 0.5 - t * 26 * HEAT_FALL_LEAN));
    fallSides.push(across);
    fallHalves.push(2.0 - t * 0.6);
  }
  add(
    'smithHeartHeatPourFall',
    ribbon(fall, fallSides, fallHalves),
    pourMaterial('smithHeartHeatPourFall', STRIP_VERT, FALL_FRAG, { uFire: fire, uCore: core }),
    8,
  );
  // The wellspring brimming.
  add(
    'smithHeartHeatPourBrim',
    heartQuadGeometry([[P.brim.x, P.brim.y, P.brim.z]], [[0, P.brim.r, 0, 0]]),
    pourMaterial('smithHeartHeatPourBrim', DISC_VERT, BRIM_FRAG, { uFire: fire, uCore: core }),
    8,
  );
  // The halos: over the brim, at the fall's foot.
  add(
    'smithHeartHeatPourHalos',
    heartQuadGeometry(
      [
        [P.brim.x, P.brim.y + 1.6, P.brim.z],
        [P.x, P.y - 24, P.z0 - 0.5 - 24 * HEAT_FALL_LEAN],
      ],
      [
        [1, 7, 0, 0],
        [2, 12, 1, 0],
      ],
    ),
    pourMaterial('smithHeartHeatPourHalos', GATED_HALO_VERT, GLOW_FRAG, { uColor: col(0xffb24a) }),
    8,
  );
  // The sparks, off the brim and off the lip (cosmetic: the low tier none).
  if (!lowGfx) {
    const at: HeartAirV3[] = [];
    const prm: HeartAirV4[] = [];
    for (let i = 0; i < 26; i++) {
      at.push([P.brim.x, P.brim.y + 0.2, P.brim.z]);
      prm.push([heartHash(i, 2101), 0, 2 + heartHash(i, 2103) * 3, 0.07]);
    }
    for (let i = 0; i < 22; i++) {
      at.push([P.x + (heartHash(i, 2105) - 0.5) * 3, P.y + 0.1, P.z0 - 0.6]);
      prm.push([heartHash(i, 2107), 1, 2.5 + heartHash(i, 2109) * 3.5, 0.08]);
    }
    add(
      'smithHeartHeatPourSparks',
      heartQuadGeometry(at, prm),
      pourMaterial('smithHeartHeatPourSparks', SPARK_VERT, GLOW_FRAG, { uColor: col(0xffd27a) }),
      9,
    );
  }
  return group;
}
