// The Highwatch manor's lane on screen (its layout is highwatch_manor_lane_core.ts): one merged
// mesh of dressed flags following the ground from the Sanctum road to the garden gate (and up
// the bank behind the east wing to the crystal cave portal's bench), each a shallow slab (its
// top a hand over the ground at each corner, its sides down below the lowest, so it lies along
// the grade, never floats and never fights the terrain), vertex-coloured greys through a Lambert
// material.
//
// GPU work: built once with the props while the built-in Highwatch town stands, its
// (geometry, material) in the props' prewarm (highwatchManorLanePrewarmPart); static after.

import * as THREE from 'three';
import { terrainHeight } from '../sim/world';
import { manorLaneFlags, manorPortalPathFlags } from './highwatch_manor_lane_core';

// a weathered grey a shade under the manor's flags (the Lambert path lights it brighter)
const BASE = new THREE.Color(0.3, 0.31, 0.33);
let material: THREE.MeshLambertMaterial | null = null;

function laneMaterial(): THREE.MeshLambertMaterial {
  if (material) return material;
  material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.name = 'highwatch-manor-lane';
  return material;
}

/** A slab's five faces (top and four sides) as triangles: its top follows the ground at each
 *  corner (`tops`: x0z0, x1z0, x1z1, x0z1), its sides run down below the lowest ground. */
function pushSlab(
  pos: number[],
  nor: number[],
  col: number[],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  tops: readonly [number, number, number, number],
  bottom: number,
  c: THREE.Color,
): void {
  const quad = (pts: number[][], n: number[], k: number) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(pts[i][0], pts[i][1], pts[i][2]);
      nor.push(n[0], n[1], n[2]);
      col.push(c.r * k, c.g * k, c.b * k);
    }
  };
  const [a, b, d, e] = tops;
  quad(
    [
      [x0, e, z1],
      [x1, d, z1],
      [x1, b, z0],
      [x0, a, z0],
    ],
    [0, 1, 0],
    1,
  );
  quad(
    [
      [x0, bottom, z0],
      [x0, a, z0],
      [x1, b, z0],
      [x1, bottom, z0],
    ],
    [0, 0, -1],
    0.78,
  );
  quad(
    [
      [x1, bottom, z1],
      [x1, d, z1],
      [x0, e, z1],
      [x0, bottom, z1],
    ],
    [0, 0, 1],
    0.78,
  );
  quad(
    [
      [x0, bottom, z1],
      [x0, e, z1],
      [x0, a, z0],
      [x0, bottom, z0],
    ],
    [-1, 0, 0],
    0.78,
  );
  quad(
    [
      [x1, bottom, z0],
      [x1, b, z0],
      [x1, d, z1],
      [x1, bottom, z1],
    ],
    [1, 0, 0],
    0.78,
  );
}

function geometryOf(pos: number[], nor: number[], col: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geometry;
}

/** The lane's one program, for the props material prewarm. */
export function highwatchManorLanePrewarmPart(): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  pushSlab(pos, nor, col, 0, 1, 0, 1, [0.1, 0.1, 0.1, 0.1], 0, BASE);
  return { geometry: geometryOf(pos, nor, col), material: laneMaterial() };
}

/** Build the lane (world space; the caller adds it to the props root). */
export function buildHighwatchManorLane(seed: number): THREE.Mesh {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (const f of [...manorLaneFlags(), ...manorPortalPathFlags()]) {
    // each corner a hand over the ground under it, so the flags lie along the grade
    const lift = 0.07;
    const tops: [number, number, number, number] = [
      terrainHeight(f.x0, f.z0, seed) + lift,
      terrainHeight(f.x1, f.z0, seed) + lift,
      terrainHeight(f.x1, f.z1, seed) + lift,
      terrainHeight(f.x0, f.z1, seed) + lift,
    ];
    const bottom = Math.min(...tops) - lift - 0.15;
    c.copy(BASE).multiplyScalar(0.86 + 0.24 * f.shade);
    pushSlab(pos, nor, col, f.x0, f.x1, f.z0, f.z1, tops, bottom, c);
  }
  const mesh = new THREE.Mesh(geometryOf(pos, nor, col), laneMaterial());
  mesh.name = 'highwatchManorLane';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.geometry.computeBoundingSphere();
  return mesh;
}
