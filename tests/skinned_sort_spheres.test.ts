import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { primeSkinnedSortSpheres } from '../src/render/characters/skinned_sort_spheres';

function makeRig(): { root: THREE.Object3D; mesh: THREE.SkinnedMesh } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-2, -1, 0, 2, -1, 0, 0, 3, 0], 3),
  );
  const bone = new THREE.Bone();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Object3D();
  root.add(bone, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  return { root, mesh };
}

describe('primeSkinnedSortSpheres', () => {
  it('seeds a static sphere that SkeletonUtils clones inherit', () => {
    const { root, mesh } = makeRig();
    mesh.frustumCulled = false;
    expect(mesh.boundingSphere).toBeNull();
    expect(mesh.geometry.boundingSphere).toBeNull();

    primeSkinnedSortSpheres(root);

    expect(mesh.boundingSphere).not.toBeNull();
    expect(mesh.boundingSphere).not.toBe(mesh.geometry.boundingSphere);
    const sourceSphere = mesh.boundingSphere;
    if (!sourceSphere) throw new Error('source sort sphere was not primed');
    expect(sourceSphere.center.x).toBeCloseTo(0);
    expect(sourceSphere.center.y).toBeCloseTo(1);
    expect(mesh.frustumCulled).toBe(false);

    const clonedRoot = cloneSkinned(root);
    const clone = clonedRoot.children.find((child) => (child as THREE.SkinnedMesh).isSkinnedMesh) as
      | THREE.SkinnedMesh
      | undefined;
    expect(clone?.boundingSphere).not.toBeNull();
    const cloneSphere = clone?.boundingSphere;
    if (!cloneSphere) throw new Error('clone did not inherit its sort sphere');
    expect(cloneSphere).not.toBe(sourceSphere);
    expect(cloneSphere.center).toEqual(sourceSphere.center);
    expect(cloneSphere.radius).toBeCloseTo(sourceSphere.radius);
  });

  it('preserves an existing pose-aware sphere without scanning geometry', () => {
    const { root, mesh } = makeRig();
    const poseAware = new THREE.Sphere(new THREE.Vector3(7, 8, 9), 12);
    mesh.boundingSphere = poseAware;

    primeSkinnedSortSpheres(root);

    expect(mesh.boundingSphere).toBe(poseAware);
    expect(mesh.geometry.boundingSphere).toBeNull();
  });

  it('does not add object-level spheres to ordinary meshes', () => {
    const root = new THREE.Object3D();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(mesh);

    primeSkinnedSortSpheres(root);

    expect((mesh as unknown as { boundingSphere?: THREE.Sphere }).boundingSphere).toBeUndefined();
  });
});
