import * as THREE from 'three';
import { footprintDistance } from './policy_core';
import type { Bounds, SceneryPlacement } from './types';

export interface AuthoredInstances {
  count: number;
  matrices: Float32Array;
  colors: Float32Array | null;
}

export function isGiantTree(item: SceneryPlacement): boolean {
  return item.kind === 'landmark' && !!item.owner.getObjectByName('TwistedTree_1');
}

export function isSceneryReplacementRoot(name: string): boolean {
  return [
    'foliage',
    'garden-features',
    'jungle-features',
    'haunt-features',
    'realm-flora',
  ].includes(name);
}

/** Collect before the source controller packs instances. Radius bounds the
 * preparation population, not the displayed distance. Call on registration or
 * a movement threshold, never every frame. */
export function collectSceneryPlacements(
  roots: readonly THREE.Object3D[],
  x: number,
  z: number,
  radius: number,
  authored?: WeakMap<THREE.Object3D, AuthoredInstances>,
): SceneryPlacement[] {
  const placements = new Map<string, SceneryPlacement>();
  const add = (
    key: string,
    kind: SceneryPlacement['kind'],
    source: THREE.Mesh,
    matrix: THREE.Matrix4,
    index: number | null,
    owner: THREE.Object3D,
  ): void => {
    const geometry = source.geometry;
    if (
      !geometry.attributes.position ||
      Array.isArray(source.material) ||
      source.material.transparent ||
      (source as THREE.SkinnedMesh).isSkinnedMesh
    )
      return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!.clone().applyMatrix4(matrix);
    const bounds: Bounds = [box.min.x, box.max.x, box.min.z, box.max.z];
    if (footprintDistance(bounds, x, z) > radius) return;
    let item = placements.get(key);
    if (!item) {
      item = {
        key,
        kind,
        owner,
        parts: [],
        box: new THREE.Box3(),
        bounds,
        x: matrix.elements[12],
        z: matrix.elements[14],
      };
      placements.set(key, item);
    }
    const tint = new THREE.Color(1, 1, 1);
    const instance = source as THREE.InstancedMesh;
    const original = authored?.get(source);
    if (index !== null && original?.colors) tint.fromArray(original.colors, index * 3);
    else if (index !== null && instance.instanceColor) instance.getColorAt(index, tint);
    item.parts.push({
      source: source as THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
      matrix: matrix.clone(),
      index,
      tint,
    });
    item.box.union(box);
    item.bounds = [item.box.min.x, item.box.max.x, item.box.min.z, item.box.max.z];
  };
  for (const root of roots) {
    if (!isSceneryReplacementRoot(root.name)) continue;
    root.updateWorldMatrix(true, true);
    for (const child of root.children) {
      const instance = child as THREE.InstancedMesh;
      if (instance.isInstancedMesh) {
        if (root.name === 'realm-flora') continue;
        const material = instance.material;
        if (Array.isArray(material)) continue;
        if (root.name === 'foliage' && !/^(Bark_|Leaves_|Rocks$)/.test(material.name)) continue;
        const matrix = new THREE.Matrix4();
        const original = authored?.get(instance);
        for (let i = 0; i < (original?.count ?? instance.count); i++) {
          if (original) matrix.fromArray(original.matrices, i * 16);
          else instance.getMatrixAt(i, matrix);
          matrix.premultiply(instance.matrixWorld);
          add(
            `${root.uuid}:${matrix.elements.join(',')}`,
            root.name === 'foliage' ? 'foliage' : 'zone-instance',
            instance,
            matrix,
            i,
            root,
          );
        }
      } else if (root.name !== 'foliage') {
        let supported = true;
        child.traverse((node) => {
          if (
            node.matrixAutoUpdate ||
            (node as THREE.InstancedMesh).isInstancedMesh ||
            (node as THREE.SkinnedMesh).isSkinnedMesh
          )
            supported = false;
        });
        if (!supported) continue;
        child.traverse((node) => {
          if ((node as THREE.Mesh).isMesh)
            add(child.uuid, 'landmark', node as THREE.Mesh, node.matrixWorld, null, child);
        });
      }
    }
  }
  const size = new THREE.Vector3();
  return [...placements.values()].filter((item) => {
    item.box.getSize(size);
    return size.y >= 4 && Math.max(size.x, size.z) >= 3 && Math.max(size.x, size.z) < 180;
  });
}
