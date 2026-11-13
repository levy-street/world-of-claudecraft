// The column of the heart's light over the central circle in the final phase
// (phase 2N, design doc section 5.21; the AAA pass redrew it): the room's signal
// that the fight has reached its last act, standing over the ring where the
// heart's power breaks loose, read from anywhere in the room over every head.
//   - no tube: each sheath is a lathe that flares out of the well, draws in
//     to a waist over the boss's head and opens a little as it climbs, its light
//     gone at its silhouette (`vRim`), so it has no vertical edge at any angle;
//   - its light in strands that wind up it, every sheath its own way, with a
//     pulse climbing with each heartbeat;
//   - thin at the height of a body (`HEART_RING_COLUMN.clear`): boss, raid and
//     a falling quarter stay in plain view through it; full over their heads;
//   - splinters torn off the heart riding it up in spirals, each its own size.
// Shown only while the ring blazes (`set(blaze)`), collapsed otherwise.
// Gameplay-neutral: the same sheaths on every tier (the low tier a share of the
// splinters); it never hides a floor telegraph (additive, no depth write).
//
// GPU preparation: built with the interior with the quarters (the compile
// gate links its two materials, hidden or not); no light; no texture; the
// per-frame update writes uniforms only. Every point goes through
// `modelViewMatrix` on a mesh placed at the room's centre (room-local).

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { type HeartAirV3, type HeartAirV4, heartQuadGeometry } from './heart_air_quads';
import { heartHash } from './heart_plan_core';
import {
  HEART_QUARTER_LOW_SHARE,
  HEART_RING_COLUMN,
  HEART_RING_LOOK,
  heartRingSheathRadius,
} from './heart_quarters_core';

export { HEART_RING_COLUMN, heartRingSheathRadius };

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
uniform float uStrands;
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
  float y = h * ${HEART_RING_COLUMN.height.toFixed(1)};
  // The strands winding up the sheath (u wraps on whole turns): each strand a
  // soft band, swelling and thinning along its run.
  float wind = 6.2831853 * (vUv.x * uStrands + h * 2.6 * sign(uSpin)) - uTime * uSpin * 1.1;
  float band = 0.5 + 0.5 * sin(wind + 1.4 * sin(h * 9.0 - uTime * 0.7));
  band *= band;
  float swell = 0.35 + 0.65 * cn(vec2(vUv.x * uStrands * 2.0, h * 7.0 - uTime * 0.8));
  // A pulse climbing with every beat of the heart.
  float beat = fract(uTime * 0.4545);
  float pulse = exp(-(h - beat) * (h - beat) / 0.003);
  // No edge: the light gone at the sheath's silhouette, whole where it faces
  // the eye. Faded in out of the well and out into the dark above.
  float soft = smoothstep(0.08, 0.72, vRim);
  float fade = smoothstep(0.0, 0.04, h) * (1.0 - smoothstep(0.52, 1.0, h));
  // Thin at a body's height, so whoever stands in it stays in plain view.
  float over = mix(0.2, 1.0, smoothstep(${HEART_RING_COLUMN.clear[0].toFixed(1)}, ${HEART_RING_COLUMN.clear[1].toFixed(1)}, y));
  float a = uK * fade * soft * over * (band * swell + pulse * 0.45);
  vec3 c = mix(uColor, vec3(1.0, 0.97, 0.9), clamp(uHot * 0.75 + pulse * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(c * a, 1.0);
  #include <colorspace_fragment>
}`;

/** The splinters: each a thin sliver of light riding a spiral up the column
 *  (aParams: phase, radius share, speed, size), glinting as it turns. */
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
  float rr = mix(${(HEART_RING_LOOK.wellR * 0.8).toFixed(2)}, 2.4, smoothstep(0.0, 0.4, life)) * (0.4 + 0.6 * aParams.y);
  vec3 p = position + vec3(sin(ang) * rr, life * uH, cos(ang) * rr);
  float turn = sin(uTime * (3.0 + 4.0 * aParams.z) + aParams.x * 40.0);
  vFade = uK * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
  vHot = 0.4 + 0.6 * max(0.0, turn);
  float size = (0.09 + 0.3 * aParams.w * aParams.w) * step(0.002, vFade);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // A sliver: tall and thin, turning (its width breathing with the turn).
  mv.xy += aCorner * vec2(size * (0.35 + 0.35 * abs(turn)), size * 2.4);
  vCorner = aCorner;
  gl_Position = projectionMatrix * mv;
}`;

const SHARD_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vCorner;
varying float vFade;
varying float vHot;
void main() {
  // Soft, tall and thin: no outline and no facet to repeat.
  float d = length(vCorner);
  float a = (1.0 - smoothstep(0.05, 1.0, d)) * vFade;
  if (a < 0.003) discard;
  vec3 c = mix(uColor, vec3(1.0, 0.98, 0.92), vHot);
  gl_FragColor = vec4(c * a * 1.25, 1.0);
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
        uStrands: { value: s.strands },
      },
      vertexShader: SHEATH_VERT,
      fragmentShader: SHEATH_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    const profile: THREE.Vector2[] = [];
    for (let k = 0; k <= 28; k++)
      profile.push(new THREE.Vector2(heartRingSheathRadius(s, k / 28), (k / 28) * C.height - 0.5));
    const g = new THREE.LatheGeometry(profile, 48);
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
      uH: { value: C.height * 0.62 },
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
        set(m.uniforms.uK, k * (i === 0 ? 1.15 : i === 1 ? 0.62 : 0.34));
        const mesh = group.children[i];
        // Hidden while the ring rests (its material stays compiled).
        if (mesh) mesh.visible = k > 0.002;
      }
      set(shardMat.uniforms.uK, k);
    },
  };
}
