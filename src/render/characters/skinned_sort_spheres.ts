import type * as THREE from 'three';

/**
 * Seed the lightweight sphere WebGLRenderer needs to sort a SkinnedMesh.
 *
 * Three computes a missing SkinnedMesh sphere by applying every bone to every
 * vertex, even when frustum culling is disabled. CharacterVisual already owns
 * entity-level visibility and uses a separate capsule for picking, so a static
 * geometry sphere is sufficient as the render-list sort centre. Geometry is
 * shared by every SkeletonUtils clone, which makes the raw-position scan a
 * once-per-asset cost while each mesh keeps its own Sphere instance.
 */
export function primeSkinnedSortSpheres(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.boundingSphere !== null) return;

    const geometry = mesh.geometry;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    if (geometry.boundingSphere !== null) mesh.boundingSphere = geometry.boundingSphere.clone();
  });
}
