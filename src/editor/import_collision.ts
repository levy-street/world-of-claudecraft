// In-browser collision bake for imported/uploaded models: the same voxel-box
// core the catalogue bake script runs offline (collision_bake_core.ts), fed
// from the parsed THREE scene the renderer will draw - so what you see is
// what you collide with, for models we have never seen before. Runs once per
// import (a few ms for typical models); the resulting boxes ride the map
// document (MapDoc.assetCollision) so playtests and exports keep them.

import * as THREE from 'three';
import { targetHeightFor } from '../render/asset_scale';
import { loadGltf } from '../render/assets/loader';
import {
  bakeCollisionBoxes,
  bakeOptionsFor,
  type CollisionBakeOptions,
} from './collision_bake_core';

/** Doc-shaped baked box (matches the generated catalogue's field names). */
export interface ImportedCollisionBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

// Safety valve for pathological imports (the 64 MiB cap allows very dense
// meshes): past this many triangles the bake uses the prefix it has - the
// voxel grid saturates long before that anyway.
const MAX_BAKE_TRIS = 400_000;

/**
 * Bake collision boxes for an imported model URL (object URL or server path).
 * Uses the shared GLB loader cache, so the later render load is free. Boxes
 * come back in NORMALIZED world yards (scale 1, base at y=0) - the exact
 * space the sim transforms per placement. Null = nothing bakeable.
 */
export async function bakeImportedModelCollision(
  url: string,
): Promise<ImportedCollisionBox[] | null> {
  return bakeModelCollision(url, null);
}

/**
 * "True collision" fine bake: a much denser voxel grid and a far higher box
 * budget, so the box set hugs the real silhouette. Expensive (edge cases
 * only); the result rides MapDoc.assetCollisionMesh. Null = nothing bakeable.
 */
export async function bakeTrueModelCollision(url: string): Promise<ImportedCollisionBox[] | null> {
  return bakeModelCollision(url, (size) => ({
    // ~64 cells across the largest dimension (double the standard bake),
    // near-zero deflate: fidelity over leniency.
    resolution: Math.min(0.25, Math.max(0.08, Math.max(size.x, size.y, size.z, 0.001) / 64)),
    maxBoxes: 96,
    deflate: 0.03,
  }));
}

async function bakeModelCollision(
  url: string,
  fineOpts: ((size: { x: number; y: number; z: number }) => CollisionBakeOptions) | null,
): Promise<ImportedCollisionBox[] | null> {
  const gltf = await loadGltf(url);
  const object = gltf.scene;
  object.updateMatrixWorld(true);
  const tris: number[] = [];
  const v = new THREE.Vector3();
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || tris.length / 9 >= MAX_BAKE_TRIS) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const push = (vi: number): void => {
      // getX/getY/getZ absorbs interleaved + quantized attribute layouts.
      v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(mesh.matrixWorld);
      tris.push(v.x, v.y, v.z);
    };
    const idx = geo.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) push(idx.getX(i));
    else for (let i = 0; i < pos.count; i++) push(i);
  });
  if (tris.length < 9) return null;
  // Normalize exactly like the renderer seats the model: uniform scale to the
  // target height (imported models are generic props: TARGET_HEIGHT), base at
  // y=0. Matches scripts/assets/bake_collision.mjs for catalogue assets.
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    minX = Math.min(minX, tris[i]);
    maxX = Math.max(maxX, tris[i]);
    minY = Math.min(minY, tris[i + 1]);
    maxY = Math.max(maxY, tris[i + 1]);
    minZ = Math.min(minZ, tris[i + 2]);
    maxZ = Math.max(maxZ, tris[i + 2]);
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const norm = targetHeightFor(url) / maxDim;
  for (let i = 0; i < tris.length; i += 3) {
    tris[i] *= norm;
    tris[i + 1] = (tris[i + 1] - minY) * norm;
    tris[i + 2] *= norm;
  }
  const size = {
    x: (maxX - minX) * norm,
    y: (maxY - minY) * norm,
    z: (maxZ - minZ) * norm,
  };
  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const boxes = bakeCollisionBoxes(
    tris,
    fineOpts ? fineOpts(size) : bakeOptionsFor('default', size),
  );
  if (boxes.length === 0) return null;
  return boxes.map((b) => ({
    x: round3(b.cx),
    y: round3(b.cy),
    z: round3(b.cz),
    hx: round3(b.hx),
    hy: round3(b.hy),
    hz: round3(b.hz),
  }));
}
