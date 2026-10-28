// The column of the heart's light over the central circle in the final phase
// (phase 2N, design doc section 5.21; it replaces 2M's one flat cylinder):
//   - three nested sheaths of light, each turning its own way, their
//     surfaces streamed with swirling bands that climb, the inner one hot
//     white, the outer ones the heart's gold fraying into the air; the
//     column swells at its foot where it leaves the well and thins as it
//     rises;
//   - crystal shards torn off the heart riding the column up in spirals,
//     flashing as they turn;
//   - a pulse of light climbing the column with every heartbeat.
// Shown only while the ring blazes (`set(blaze)`), collapsed otherwise.
// Gameplay-neutral: a cosmetic in the circle's air on every tier (the low
// tier a share of the shards, the same sheaths); it never hides a floor
// telegraph (additive, no depth write, over the well).
//
// GPU preparation: built with the interior with the quarters (the compile
// gate links its two materials, hidden or not); no light; no texture; the
// per-frame update writes uniforms only. Every point goes through
// `modelViewMatrix` on a mesh placed at the room's centre (room-local).

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { heartHash } from './heart_plan_core';
import { HEART_QUARTER_LOW_SHARE, HEART_RING_LOOK } from './heart_quarters_core';

/** The column's measures: its sheaths (radius at the foot, at the top, how
 *  fast each turns), its height, the shards (the high tier's count). */
export const HEART_RING_COLUMN = {
  height: 64,
  sheaths: [
    { foot: 4.2, top: 2.2, spin: 1.1, hot: 1 },
    { foot: 8.5, top: 4.6, spin: -0.7, hot: 0.45 },
    { foot: 12.6, top: 7.4, spin: 0.45, hot: 0 },
  ],
  shards: 140,
} as const;

const SHEATH_VERT = /* glsl */ `
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vRim = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const SHEATH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uK;
uniform float uSpin;
uniform float uHot;
uniform float uTime;
varying vec2 vUv;
varying float vRim;
float ch(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float cn(vec2 q) {
  vec2 i = floor(q);
  vec2 u = fract(q);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(ch(i), ch(i + vec2(1.0, 0.0)), u.x), mix(ch(i + vec2(0.0, 1.0)), ch(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float h = vUv.y;
  // Bands swirling up round the sheath (u wraps, so the noise tiles on a
  // whole number of turns).
  float u = vUv.x * 8.0 + h * 3.0 * sign(uSpin) - uTime * uSpin * 0.35;
  float swirl = cn(vec2(u, h * 6.0 - uTime * 1.4));
  swirl = 0.08 + 0.92 * smoothstep(0.45, 0.9, swirl + 0.25 * cn(vec2(u * 2.0, h * 14.0 - uTime * 2.6)));
  // A pulse climbing with every beat of the heart.
  float beat = fract(uTime * 0.4545);
  float pulse = exp(-(h - beat) * (h - beat) / 0.004);
  // Brightest at its edges seen side on; swelling at the foot, fraying out
  // toward the top.
  float edge = 0.15 + 0.85 * smoothstep(0.2, 1.0, 1.0 - vRim);
  float fade = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(0.55, 1.0, h));
  float a = uK * fade * (swirl * edge * 0.8 + pulse * 0.6 * edge);
  vec3 c = mix(uColor, vec3(1.0, 0.97, 0.9), clamp(uHot * 0.7 + pulse * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(c * a, 1.0);
  #include <colorspace_fragment>
}`;

/** The shards: each a faceted sliver riding a spiral up the column (aParams:
 *  phase, radius share, speed, size), flashing as it turns. */
const SHARD_VERT = /* glsl */ `
uniform float uTime;
uniform float uK;
uniform float uH;
attribute vec2 aCorner;
attribute vec4 aParams;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  float life = fract(aParams.x * 7.31 + uTime * (0.05 + 0.06 * aParams.z));
  float ang = aParams.x * 6.2832 + life * (5.0 + 4.0 * aParams.z) * (aParams.w > 0.5 ? 1.0 : -1.0);
  float rr = mix(${(HEART_RING_LOOK.wellR * 0.9).toFixed(2)}, 2.0, life) * (0.35 + 0.65 * aParams.y);
  vec3 p = position + vec3(sin(ang) * rr, life * uH, cos(ang) * rr);
  float turn = sin(uTime * (3.0 + 4.0 * aParams.z) + aParams.x * 40.0);
  vFade = uK * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
  vHot = 0.4 + 0.6 * max(0.0, turn);
  float size = (0.35 + 0.9 * aParams.w) * step(0.002, vFade);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // A sliver: tall and thin, turning (its width breathing with the turn).
  mv.xy += aCorner * vec2(size * (0.3 + 0.35 * abs(turn)), size * 1.6);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

const SHARD_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  // A diamond, its facets lit unevenly.
  float d = abs(vCorner.x) + abs(vCorner.y);
  float a = (1.0 - smoothstep(0.75, 1.0, d)) * vFade;
  if (a < 0.003) discard;
  float facet = 0.6 + 0.4 * step(0.0, vCorner.x * vCorner.y);
  vec3 c = mix(uColor, vec3(1.0, 0.98, 0.92), vHot) * facet;
  gl_FragColor = vec4(c * a * 1.6, 1.0);
  #include <colorspace_fragment>
}`;

export interface HeartRingColumn {
  group: THREE.Group;
  /** `blaze`: the ring's blaze (0 to 1); `dark`: the heart's fall. */
  set(blaze: number, dark: number): void;
  /** Its materials (the compile gate and the tests read them). */
  materials: THREE.ShaderMaterial[];
}

/** The column over the circle (instance-local, the room's centre
 *  `centre`). */
export function buildHeartRingColumn(lowGfx: boolean, centre: THREE.Vector3): HeartRingColumn {
  const group = new THREE.Group();
  group.name = 'smithHeartRingColumn';
  const C = HEART_RING_COLUMN;
  const sheaths: THREE.ShaderMaterial[] = [];
  for (const [i, s] of C.sheaths.entries()) {
    const mat = new THREE.ShaderMaterial({
      name: `smithHeartRingColumn:${i}`,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(0xffd690) },
        uK: { value: 0 },
        uSpin: { value: s.spin },
        uHot: { value: s.hot },
      },
      vertexShader: SHEATH_VERT,
      fragmentShader: SHEATH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const g = new THREE.CylinderGeometry(s.top, s.foot, C.height, 48, 12, true).translate(
      0,
      C.height / 2 - 0.5,
      0,
    );
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.copy(centre);
    mesh.name = `heartRingColumn:${i}`;
    mesh.visible = false;
    group.add(mesh);
    sheaths.push(mat);
  }
  const shardMat = new THREE.ShaderMaterial({
    name: 'smithHeartRingShards',
    uniforms: {
      uTime: sharedUniforms.uTime,
      uK: { value: 0 },
      uH: { value: C.height * 0.8 },
      uColor: { value: new THREE.Color(0xffc870) },
    },
    vertexShader: SHARD_VERT,
    fragmentShader: SHARD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const n = lowGfx ? Math.round(C.shards * HEART_QUARTER_LOW_SHARE) : C.shards;
  const bases: HeartAirV3[] = [];
  const params: HeartAirV4[] = [];
  for (let i = 0; i < n; i++) {
    bases.push([0, 0.3, 0]);
    params.push([heartHash(9101, i), heartHash(9102, i), heartHash(9103, i), heartHash(9104, i)]);
  }
  const g = heartQuadGeometry(bases, params);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, C.height / 2, 0), C.height);
  const shards = new THREE.Mesh(g, shardMat);
  shards.position.copy(centre);
  shards.name = 'heartRingShards';
  group.add(shards);
  const set = (u: THREE.IUniform, v: number) => {
    const k = Math.round(v * 1000) / 1000;
    if (u.value !== k) u.value = k;
  };
  return {
    group,
    materials: [...sheaths, shardMat],
    set(blaze, dark) {
      const k = blaze * (1 - dark);
      for (const [i, m] of sheaths.entries()) {
        set(m.uniforms.uK, k * (i === 0 ? 0.75 : i === 1 ? 0.5 : 0.36));
        const mesh = group.children[i];
        // Hidden while the ring rests (its material stays compiled).
        if (mesh) mesh.visible = k > 0.002;
      }
      set(shardMat.uniforms.uK, k);
    },
  };
}
