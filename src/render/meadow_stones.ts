// Meadow stones, the Three half: a few lumpy rounded boulder shapes, drawn as
// one InstancedMesh per shape over the spots meadow_stones_core.ts places.
// Cosmetic only (no collider). The art bible's painterly stones: dark slate
// grey, a painted lighter top and a darker base, soft rounded forms.

import * as THREE from 'three';
import { mulberry32 } from './blade_grass';
import {
  generateMeadowStones,
  MEADOW_STONE_VARIANTS,
  type MeadowStone,
} from './meadow_stones_core';

const STONE_BASE = new THREE.Color(0x464c54);
const STONE_TOP = new THREE.Color(0x868d96);

/** One rounded boulder: a subdivided icosahedron, lumped by a seeded radial
 *  jitter, with a painted top-light gradient in vertex colours. */
function boulderGeometry(variant: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const rng = mulberry32(5101 + variant * 977);
  // Low-frequency lumps: a few random bulge directions, so neighbouring
  // vertices move together and the stone stays smooth.
  const bulges = Array.from({ length: 5 }, () =>
    new THREE.Vector3(rng() - 0.5, rng() * 0.6 - 0.1, rng() - 0.5).normalize(),
  );
  const v = new THREE.Vector3();
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const b of bulges) r += Math.max(0, v.dot(b)) ** 2 * 0.22;
    // flatten the underside so the stone sits on the ground instead of rolling
    const y = v.y < 0 ? v.y * 0.35 : v.y;
    pos.setXYZ(i, v.x * r, y * r, v.z * r);
    c.copy(STONE_BASE).lerp(STONE_TOP, THREE.MathUtils.smoothstep(v.y, -0.2, 0.85));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** The meadow stones of the active world, as a group the foliage view owns. */
export function buildMeadowStones(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'meadowStones';
  const stones = generateMeadowStones(seed);
  if (stones.length === 0) return group;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  });
  const byVariant: MeadowStone[][] = Array.from({ length: MEADOW_STONE_VARIANTS }, () => []);
  for (const s of stones) byVariant[s.variant].push(s);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  byVariant.forEach((list, variant) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(boulderGeometry(variant), material, list.length);
    mesh.name = `meadowStones:${variant}`;
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw);
      // sink a little so the flattened base meets uneven ground
      p.set(s.x, s.y - s.scale * 0.12, s.z);
      sc.set(s.scale, s.scale * s.squash, s.scale * (0.85 + (s.squash - 0.55)));
      mesh.setMatrixAt(i, m.compose(p, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}
