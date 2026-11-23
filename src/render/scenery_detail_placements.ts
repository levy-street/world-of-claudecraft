import * as THREE from 'three';
import { sceneryFootprintDistance } from './scenery_detail_core';

export interface SceneryDetailPlacement {
  box: THREE.Box3;
  small: boolean;
}

/** Shared bounds keep every part of a static placement on the same side of
 * its cull boundary. Dynamic/transport hierarchies retain their own owner. */
export function sceneryDetailPlacements(
  root: THREE.Object3D,
): Map<THREE.Mesh, SceneryDetailPlacement[]> {
  const result = new Map<THREE.Mesh, SceneryDetailPlacement[]>();
  const shared = new Map<string, SceneryDetailPlacement>();
  const matrix = new THREE.Matrix4();
  root.updateWorldMatrix(true, true);
  for (const owner of root.children) {
    if (owner.userData.decorative === false) continue;
    owner.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
      for (let parent: THREE.Object3D | null = node; parent; parent = parent.parent)
        if (parent.userData.decorative === false) return;
      const source = mesh.geometry;
      if (!source.boundingBox) source.computeBoundingBox();
      if (!source.boundingBox) return;
      const instance = mesh as THREE.InstancedMesh;
      const placements: SceneryDetailPlacement[] = [];
      for (let i = 0; i < (instance.isInstancedMesh ? instance.count : 1); i++) {
        if (instance.isInstancedMesh) {
          instance.getMatrixAt(i, matrix);
          matrix.premultiply(instance.matrixWorld);
        } else matrix.copy(mesh.matrixWorld);
        const key = instance.isInstancedMesh ? `instance:${matrix.elements.join(',')}` : owner.uuid;
        let placement = shared.get(key);
        if (!placement) {
          placement = { box: new THREE.Box3(), small: false };
          shared.set(key, placement);
        }
        placement.box.union(source.boundingBox.clone().applyMatrix4(matrix));
        placements.push(placement);
      }
      result.set(mesh, placements);
    });
  }
  const size = new THREE.Vector3();
  for (const placement of shared.values()) {
    placement.box.getSize(size);
    placement.small = size.y < 4 || Math.max(size.x, size.z) < 3;
  }
  return result;
}

export function sceneryPlacementDistance(
  placement: SceneryDetailPlacement,
  x: number,
  z: number,
): number {
  const { min, max } = placement.box;
  return sceneryFootprintDistance(min.x, max.x, min.z, max.z, x, z);
}
