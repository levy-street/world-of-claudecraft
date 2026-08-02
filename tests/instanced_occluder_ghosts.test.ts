import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { InstancedOccluderGhosts } from '../src/render/instanced_occluder_ghosts';
import { freezeStaticMatrices } from '../src/render/static_matrix';

describe('instanced occluder ghosts', () => {
  it('initializes a late ghost world matrix under a settled static source', () => {
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const source = new THREE.InstancedMesh(geometry, material, 1);
    root.add(source);
    freezeStaticMatrices(root);

    const instanceMatrix = new THREE.Matrix4().makeTranslation(12, 3, -7);
    source.setMatrixAt(0, instanceMatrix);
    const ghosts = new InstancedOccluderGhosts();
    const handle = ghosts.acquire(source, 0, instanceMatrix);

    expect(handle.mesh.matrixAutoUpdate).toBe(false);
    expect(handle.mesh.matrixWorld.elements.slice(12, 15)).toEqual([12, 3, -7]);
  });
});
