import type * as THREE from 'three';

export type OriginalMaterialMap = ReadonlyMap<THREE.Mesh, THREE.Material | THREE.Material[]>;

/** Restore the baseline material on every live mesh before resnapshotting a graph. */
export function restoreOriginalMaterials(originals: OriginalMaterialMap): void {
  for (const [mesh, material] of originals) mesh.material = material;
}

/** Dispose per-visual effect clones once each and empty every cache. */
export function disposeMaterialVariants(
  maps: readonly Map<THREE.Material, THREE.Material>[],
): void {
  const materials = new Set<THREE.Material>();
  for (const map of maps) {
    for (const material of map.values()) materials.add(material);
    map.clear();
  }
  for (const material of materials) material.dispose();
}
