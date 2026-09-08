import * as THREE from 'three';
import type { SequencerHost } from './sequencer';

// Two broken buttresses and a rear keystone. The open front and central gap
// preserve the wearer and weapon, rather than implying a damaging area ring.
const SLABS = [
  [-1.65, -0.55, 0.72, 1.0, 1.6, -0.35],
  [1.8, -0.5, 0.82, 0.95, 1.8, 0.27],
  [-2.9, -0.85, 0.62, 0.84, 0.75, -0.6],
  [3.05, -1.0, 0.72, 0.78, 0.9, 0.5],
  [-0.8, -2.6, 0.85, 0.7, 1.25, -0.4],
  [0.95, -2.85, 0.8, 0.72, 1.1, 0.7],
  [0.1, -3.55, 0.6, 0.52, 0.52, -0.2],
] as const;

/** Seven closed, bevelled, broken slabs; one prepared geometry and draw. */
export function warriorAvatarRuptureShape(): THREE.BufferGeometry {
  const positions: number[] = [],
    uvs: number[] = [];
  function face(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, bevel: boolean) {
    for (const p of [a, b, c]) positions.push(p.x, p.y, p.z);
    uvs.push(0, bevel ? 0 : 0.7, 1, bevel ? 0 : 0.7, 0.5, bevel ? 0.06 : 0.7);
  }
  SLABS.forEach(([x, z, width, depth, height, yaw], slab) => {
    const rings = [0.035, height * 0.8, height].map((y, ring) =>
      Array.from({ length: 6 }, (_, i) => {
        const angle = (i * Math.PI) / 3;
        const cut = 0.86 + 0.14 * Math.sin(i * 2.1 + slab * 1.3);
        const inset = ring === 2 ? 0.81 : 1;
        const px = Math.cos(angle) * width * cut * inset;
        const pz = Math.sin(angle) * depth * cut * inset;
        return new THREE.Vector3(
          x + px * Math.cos(yaw) + pz * Math.sin(yaw),
          y + (ring ? Math.cos(angle + slab) * height * 0.12 : 0),
          z + pz * Math.cos(yaw) - px * Math.sin(yaw),
        );
      }),
    );
    for (let ring = 0; ring < 2; ring++)
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6,
          a = rings[ring][i],
          b = rings[ring][j];
        const c = rings[ring + 1][j],
          d = rings[ring + 1][i];
        face(a, c, b, ring === 1);
        face(a, d, c, ring === 1);
      }
    for (const end of [0, 2]) {
      const center = rings[end]
        .reduce((sum, p) => sum.add(p), new THREE.Vector3())
        .multiplyScalar(1 / 6);
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6;
        if (end === 0) face(center, rings[end][i], rings[end][j], false);
        else face(center, rings[end][j], rings[end][i], false);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Material activation belongs to the wearer, never a fabricated enemy hit. */
export function drawWarriorAvatarRupture(
  host: SequencerHost,
  x: number,
  z: number,
  facing: number,
  full: boolean,
): number {
  const sin = Math.sin(facing),
    cos = Math.cos(facing);
  host.crestAt?.(
    x,
    host.groundYAt(x, z),
    z,
    1,
    1,
    0x969284,
    0xead5a9,
    'avatar_rupture',
    facing,
    0.66,
  );
  let count = 1;
  for (const side of [-1, 1]) {
    const sx = x + cos * side * 1.5 - sin * 0.7;
    const sz = z - sin * side * 1.5 - cos * 0.7;
    const floor = host.groundYAt(sx, sz);
    host.bakedAt?.(
      'shout_dust',
      sx,
      floor + 0.08,
      sz,
      5.4,
      0xf2e4cb,
      0xcbbf9f,
      0.62,
      0,
      0,
      facing + side * 1.15,
    );
    host.fragmentsAt?.(
      'stone_chip',
      sx,
      floor + 0.24,
      sz,
      0xb4ac93,
      full ? 24 : 8,
      2.6,
      cos * side,
      -sin * side,
      0.62,
    );
    // Mineral seams retain the complete vertical statement when the solid
    // pool is cold/full. Neither tier loses the main transformation silhouette.
    host.pathRibbon(
      0xd5bd8a,
      0.23,
      0.55,
      (points) => {
        for (let i = 0; i < points.length; i++) {
          const u = i / (points.length - 1);
          const across = side * (1.2 + u * 0.7 + Math.sin(u * 12) * 0.07);
          const forward = -0.6 - u * 0.8;
          const px = x + cos * across + sin * forward,
            pz = z - sin * across + cos * forward;
          points[i].set(px, host.groundYAt(px, pz) + 0.08 + u * 3.4, pz);
        }
        return points.length;
      },
      true,
      null,
      false,
      1,
    );
    count += 3;
  }
  return count;
}
