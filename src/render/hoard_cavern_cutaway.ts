import * as THREE from 'three';
import { hoardCavernSceneryVisible } from './hoard_cavern_core';

interface CutawayInstance {
  bounds: THREE.Box3;
  visible: boolean;
}

/** Preserve instancing while cutting only the rocks or crowns between camera and player. */
export function buildHoardCavernCutaway(
  group: THREE.Group,
): (camera: THREE.Vector3, target: THREE.Vector3) => void {
  const batches: {
    mesh: THREE.InstancedMesh;
    original: Float32Array;
    instances: CutawayInstance[];
  }[] = [];
  const matrix = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  group.traverse((node) => {
    if (
      !(node instanceof THREE.InstancedMesh) ||
      !['HoardValleyBoundaryCliffs', 'HoardCavernCornice', 'HoardCavernTree'].includes(node.name)
    )
      return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const bounds = node.geometry.boundingBox;
    if (!bounds) return;
    const instances: CutawayInstance[] = [];
    for (let i = 0; i < node.count; i++) {
      node.getMatrixAt(i, matrix);
      instances.push({ bounds: bounds.clone().applyMatrix4(matrix), visible: true });
    }
    node.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batches.push({ mesh: node, original: new Float32Array(node.instanceMatrix.array), instances });
  });
  return (camera, target) => {
    for (const batch of batches) {
      let changed = false;
      for (let i = 0; i < batch.instances.length; i++) {
        const instance = batch.instances[i];
        const visible = hoardCavernSceneryVisible(camera, target, group.position, instance.bounds);
        if (visible === instance.visible) continue;
        instance.visible = visible;
        batch.mesh.setMatrixAt(i, visible ? matrix.fromArray(batch.original, i * 16) : hidden);
        changed = true;
      }
      if (changed) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  };
}
