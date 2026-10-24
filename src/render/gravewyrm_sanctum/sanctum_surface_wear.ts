// Fold static frost wear into the terrain's existing opaque batches. Shared
// texture/material programs, no extra draw calls, and prepared with terrain.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planSanctumSurfaceWear } from './sanctum_surface_wear_core';

export function addSanctumSurfaceWear(terrain: THREE.Group): void {
  for (const wear of planSanctumSurfaceWear()) {
    const mesh = terrain.getObjectByName(`fieldTop:${wear.family}`) as THREE.Mesh | undefined;
    if (!mesh || !wear.positions.length) continue;
    const detail = new THREE.BufferGeometry();
    detail.setAttribute('position', new THREE.Float32BufferAttribute(wear.positions, 3));
    detail.setAttribute('color', new THREE.Float32BufferAttribute(wear.colors, 3));
    detail.setAttribute('uv', new THREE.Float32BufferAttribute(wear.uvs, 2));
    detail.computeVertexNormals();
    const merged = mergeGeometries([mesh.geometry, detail]);
    if (merged) {
      mesh.geometry.dispose();
      mesh.geometry = merged;
      merged.computeBoundingSphere();
    }
    detail.dispose();
  }
}
