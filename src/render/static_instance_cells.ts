import * as THREE from 'three';
import { partitionByCell } from './zone_feature_cells_core';

export interface StaticInstancePlacement {
  x: number;
  y: number;
  z: number;
  s: number;
  rot: number;
}

/** Build before scene attach, so preparation and shadow inventories see every cell.
 * Only rigid, uniformly scaled placements: no per-instance colors or attributes.
 * Geometry/materials stay caller-owned. Cells own only their instance buffers.
 * Zero disables partitioning; no distance or apparent-size cull is introduced. */
export function buildStaticInstanceCells(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  spots: readonly StaticInstancePlacement[],
  cellSize: number,
): THREE.InstancedMesh[] {
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return partitionByCell(spots, Number.isFinite(cellSize) ? cellSize : 0).map((cell) => {
    const mesh = new THREE.InstancedMesh(geometry, material, cell.spots.length);
    mesh.name = `static-cell:${cell.key}`;
    cell.spots.forEach((spot, i) => {
      position.set(spot.x, spot.y, spot.z);
      rotation.setFromAxisAngle(up, spot.rot);
      scale.setScalar(spot.s);
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Full transformed geometry bounds, not just cell origins or centres.
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    return mesh;
  });
}
