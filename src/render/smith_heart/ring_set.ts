// The Ring's set (plan: ring_set_core.ts, the owner's Ring concept of 2026-11-11): the mist
// lying in the pit round the Seal Dais, and each vein's rune glowing on the standing stones
// at its mouth, low while it sleeps, blazing once it is lit. Built with the interior, so the
// compile gate links both programs; every motion runs in the shaders on the shared clock;
// the runes' level is written only when it changes. Cosmetic: the low tier keeps two of the
// mist's sheets; the runes draw on every tier. No light, no texture.

import * as THREE from 'three';
import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { sharedUniforms } from '../gfx';
import type { HeartSealView } from './heart_seal_core';
import {
  RING_MIST,
  planRingRunes,
  ringMistMesh,
  ringRuneLevel,
  ringRuneVeinIndex,
} from './ring_set_core';

/** The set's colours: the mist in the pit's shade and where the dusk catches it, each
 *  element's rune (linear, over 1 so the core blooms). */
export const RING_SET_LOOK = {
  mist: 0x6c6478,
  mistLit: 0xb3a6b4,
  rune: {
    hammer: [1.0, 0.72, 0.26],
    breath: [0.7, 0.36, 1.0],
    quench: [0.4, 0.78, 1.0],
    heat: [1.0, 0.36, 0.08],
  } as Readonly<Record<SmithHeartVein, readonly number[]>>,
  core: 1.7,
  glow: 0.75,
} as const;

const v3 = (c: readonly number[]) => `vec3( ${c.map((x) => x.toFixed(3)).join(', ')} )`;
const g1 = (v: number) => v.toFixed(1);

const MIST_VERT = /* glsl */ `
attribute float aSheet;
varying vec3 vP;
varying float vSheet;
#include <fog_pars_vertex>
void main() {
  vP = position;
  vSheet = aSheet;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/** The mist: soft banks drifting slow round the pit, each sheet its own way. */
const MIST_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uLit;
uniform vec3 uSheetAlpha;
varying vec3 vP;
varying float vSheet;
float rmH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rmN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rmH(i), rmH(i + vec2(1, 0)), f.x), mix(rmH(i + vec2(0, 1)), rmH(i + vec2(1, 1)), f.x), f.y);
}
#include <fog_pars_fragment>
void main() {
  float r = length(vP.xz);
  float edge = smoothstep(${g1(RING_MIST.r0)}, ${g1(RING_MIST.r0 + RING_MIST.edge)}, r)
    * (1.0 - smoothstep(${g1(RING_MIST.r1 - RING_MIST.edge)}, ${g1(RING_MIST.r1)}, r));
  // Turning slow round the dais, each sheet its own way and speed.
  float s = vSheet;
  float turn = uTime * (0.006 + 0.004 * s) * (mod(s, 2.0) < 0.5 ? 1.0 : -1.0);
  float c = cos(turn);
  float sn = sin(turn);
  vec2 q = mat2(c, -sn, sn, c) * vP.xz;
  vec2 p = q * 0.055 + vec2(s * 7.3, s * 3.1) + vec2(uTime * 0.01, -uTime * 0.006);
  float n = rmN(p) * 0.55 + rmN(p * 2.1 + 4.7) * 0.3 + rmN(p * 4.6 - uTime * 0.03) * 0.15;
  float a = s < 0.5 ? uSheetAlpha.x : (s < 1.5 ? uSheetAlpha.y : uSheetAlpha.z);
  float alpha = a * edge * smoothstep(0.22, 0.7, n);
  vec3 col = mix(uColor, uLit, smoothstep(0.35, 0.85, n));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const RUNE_VERT = /* glsl */ `
attribute vec2 aUv;
attribute vec2 aRune; // vein index (the seal's order), a phase
varying vec2 vUv;
varying vec2 vRune;
void main() {
  vUv = aUv;
  vRune = aRune;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The runes, carved strokes on the stone's face (uv -1 .. 1, up the stone): the Hammer's
 *  sun, the Breath's bolt, the Quench's star of ice, the Heat's flame. */
const RUNE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uLevel;
varying vec2 vUv;
varying vec2 vRune;
float rsSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
vec2 rsDir(float a) { return vec2(sin(a), cos(a)); }
float rsSun(vec2 p) {
  float d = abs(length(p) - 0.3);
  for (int i = 0; i < 8; i++) {
    vec2 u = rsDir(float(i) * 0.785398);
    d = min(d, rsSeg(p, u * 0.46, u * (mod(float(i), 2.0) < 0.5 ? 0.8 : 0.64)));
  }
  return d;
}
float rsBolt(vec2 p) {
  float d = rsSeg(p, vec2(0.3, 0.82), vec2(-0.14, 0.1));
  d = min(d, rsSeg(p, vec2(-0.14, 0.1), vec2(0.16, 0.06)));
  d = min(d, rsSeg(p, vec2(0.16, 0.06), vec2(-0.3, -0.82)));
  return d;
}
float rsStar(vec2 p) {
  float d = 9.0;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.047198;
    vec2 u = rsDir(a);
    vec2 m = u * 0.46;
    d = min(d, rsSeg(p, vec2(0.0), u * 0.8));
    d = min(d, rsSeg(p, m, m + rsDir(a + 0.8) * 0.22));
    d = min(d, rsSeg(p, m, m + rsDir(a - 0.8) * 0.22));
  }
  return d;
}
float rsFlame(vec2 p) {
  float d = rsSeg(p, vec2(0.0, 0.86), vec2(0.3, 0.42));
  d = min(d, rsSeg(p, vec2(0.3, 0.42), vec2(0.44, 0.0)));
  d = min(d, rsSeg(p, vec2(0.44, 0.0), vec2(0.36, -0.42)));
  d = min(d, rsSeg(p, vec2(0.36, -0.42), vec2(0.1, -0.68)));
  d = min(d, rsSeg(p, vec2(0.1, -0.68), vec2(-0.16, -0.66)));
  d = min(d, rsSeg(p, vec2(-0.16, -0.66), vec2(-0.4, -0.4)));
  d = min(d, rsSeg(p, vec2(-0.4, -0.4), vec2(-0.42, 0.02)));
  d = min(d, rsSeg(p, vec2(-0.42, 0.02), vec2(-0.24, 0.38)));
  d = min(d, rsSeg(p, vec2(-0.24, 0.38), vec2(-0.04, 0.58)));
  d = min(d, rsSeg(p, vec2(-0.04, 0.58), vec2(0.0, 0.86)));
  // The tongue inside.
  d = min(d, rsSeg(p, vec2(0.02, 0.3), vec2(0.16, -0.08)));
  d = min(d, rsSeg(p, vec2(0.16, -0.08), vec2(0.04, -0.42)));
  d = min(d, rsSeg(p, vec2(0.04, -0.42), vec2(-0.14, -0.34)));
  d = min(d, rsSeg(p, vec2(-0.14, -0.34), vec2(-0.16, -0.04)));
  d = min(d, rsSeg(p, vec2(-0.16, -0.04), vec2(0.02, 0.3)));
  return d;
}
void main() {
  vec2 p = vUv;
  float v = vRune.x;
  float d;
  vec3 col;
  float level;
  if (v < 0.5) { d = rsSun(p); col = ${v3(RING_SET_LOOK.rune.hammer)}; level = uLevel.x; }
  else if (v < 1.5) { d = rsBolt(p); col = ${v3(RING_SET_LOOK.rune.breath)}; level = uLevel.y; }
  else if (v < 2.5) { d = rsStar(p); col = ${v3(RING_SET_LOOK.rune.quench)}; level = uLevel.z; }
  else { d = rsFlame(p); col = ${v3(RING_SET_LOOK.rune.heat)}; level = uLevel.w; }
  float aa = fwidth(d) * 1.2;
  float core = 1.0 - smoothstep(0.055, 0.055 + aa, d);
  float glow = exp(-d * 6.5) * (1.0 - smoothstep(0.55, 1.0, length(p)));
  float breath = 1.0 + 0.08 * sin(uTime * 1.3 + vRune.y * 6.2831) / max(level, 0.3);
  vec3 c = col * (core * ${RING_SET_LOOK.core.toFixed(2)} + glow * ${RING_SET_LOOK.glow.toFixed(2)}) * level * breath;
  gl_FragColor = vec4(c, 1.0);
}
`;

/** The Ring's set: its group and the frame update (the runes' level from the seal). */
export interface RingSet {
  group: THREE.Group;
  update(view: HeartSealView): void;
}

/** The Ring's set, instance-local. */
export function buildRingSet(lowGfx: boolean): RingSet {
  const group = new THREE.Group();
  group.name = 'smithHeartRingSet';
  // The mist in the pit.
  const mist = ringMistMesh(lowGfx ? 2 : RING_MIST.sheets.length);
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.Float32BufferAttribute(mist.positions, 3));
  mistGeo.setAttribute('aSheet', new THREE.Float32BufferAttribute(mist.sheet, 1));
  mistGeo.setIndex(mist.indices);
  mistGeo.computeBoundingSphere();
  const mistMat = new THREE.ShaderMaterial({
    name: 'smithHeartRingMist',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(RING_SET_LOOK.mist) },
        uLit: { value: new THREE.Color(RING_SET_LOOK.mistLit) },
        uSheetAlpha: {
          value: new THREE.Vector3(...RING_MIST.sheets.map((s) => s.alpha)),
        },
      },
    ]),
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // The merge clones its inputs: the shared clock is bound after.
  mistMat.uniforms.uTime = sharedUniforms.uTime;
  const mistMesh = new THREE.Mesh(mistGeo, mistMat);
  mistMesh.name = 'smithHeartRingMist';
  mistMesh.matrixAutoUpdate = false;
  group.add(mistMesh);
  // The runes on the standing stones.
  const runes = planRingRunes();
  const pos: number[] = [];
  const uv: number[] = [];
  const rune: number[] = [];
  const idx: number[] = [];
  runes.forEach((r, i) => {
    const sx = r.nz;
    const sz = -r.nx;
    const base = i * 4;
    for (const [u, w] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pos.push(r.x + sx * r.half * u, r.y + r.half * w, r.z + sz * r.half * u);
      uv.push(u, w);
      rune.push(ringRuneVeinIndex(r.vein), (i * 0.618) % 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const runeGeo = new THREE.BufferGeometry();
  runeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  runeGeo.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  runeGeo.setAttribute('aRune', new THREE.Float32BufferAttribute(rune, 2));
  runeGeo.setIndex(idx);
  runeGeo.computeBoundingSphere();
  const level = new THREE.Vector4(
    ringRuneLevel(-1),
    ringRuneLevel(-1),
    ringRuneLevel(-1),
    ringRuneLevel(-1),
  );
  const runeMat = new THREE.ShaderMaterial({
    name: 'smithHeartRingRunes',
    uniforms: { uTime: sharedUniforms.uTime, uLevel: { value: level } },
    vertexShader: RUNE_VERT,
    fragmentShader: RUNE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const runeMesh = new THREE.Mesh(runeGeo, runeMat);
  runeMesh.name = 'smithHeartRingRunes';
  runeMesh.matrixAutoUpdate = false;
  group.add(runeMesh);
  const levels = [0, 0, 0, 0];
  return {
    group,
    update(view) {
      let changed = false;
      for (let i = 0; i < 4; i++) {
        // Quantized: the uniform is written only while a rune is waking.
        const l = Math.round(ringRuneLevel(view.since[i] ?? -1) * 64) / 64;
        if (l === levels[i]) continue;
        levels[i] = l;
        changed = true;
      }
      if (changed) level.set(levels[0], levels[1], levels[2], levels[3]);
    },
  };
}
