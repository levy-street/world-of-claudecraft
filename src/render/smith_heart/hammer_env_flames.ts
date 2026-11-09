// The fire bowls' flames on the Hammer vein's terraces (hammer_env_plan_core.ts):
// the Smith's Heart's shared flame billboards over each bowl, cosmetic, on the
// shared clock. Built with the interior, so the compile gate links them.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { heartQuadGeometry } from './heart_air_quads';
import { FLAME_FRAG, FLAME_VERT } from './heart_fire_glsl';
import { heartHash } from './heart_plan_core';

/** The flames over a list of bowl tops. */
export function hammerEnvFlameMesh(
  tops: readonly { x: number; y: number; z: number }[],
): THREE.Mesh {
  const at: [number, number, number][] = [];
  const params: [number, number, number, number][] = [];
  tops.forEach((f, i) => {
    for (const [k, w, h] of [
      [0, 0.8, 2.3],
      [1, 0.62, 1.9],
      [2, 0.42, 1.3],
    ] as const) {
      at.push([f.x, f.y - 0.05, f.z]);
      params.push([heartHash(i, k + 60), w, h, k]);
    }
  });
  const material = new THREE.ShaderMaterial({
    name: 'smithHeartEnvFlames',
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: sharedUniforms.uTime,
      uHot: { value: new THREE.Color(0xffc068) },
      uWarm: { value: new THREE.Color(0xf07a24) },
      uDeep: { value: new THREE.Color(0x8c2c0c) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(heartQuadGeometry(at, params), material);
  mesh.name = 'smithHeartEnvFlames';
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return mesh;
}
