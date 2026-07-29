import type * as THREE from 'three';

/**
 * Remap baked primitive groups onto unique material slots and merge adjacent
 * groups that resolve to the same material. Vertex/index order stays intact,
 * so transparent ordering and pixels are unchanged while duplicate GLTF
 * primitives no longer force duplicate far-LOD draw submissions.
 */
export function canonicalizeMaterialGroups(
  geometry: THREE.BufferGeometry,
  sourceMaterials: readonly THREE.Material[],
): THREE.Material[] {
  const uniqueMaterials: THREE.Material[] = [];
  const uniqueIndex = new Map<THREE.Material, number>();
  const remapped: THREE.BufferGeometry['groups'] = [];
  for (const group of geometry.groups) {
    const sourceMaterial = sourceMaterials[group.materialIndex ?? 0];
    if (!sourceMaterial) continue;
    let materialIndex = uniqueIndex.get(sourceMaterial);
    if (materialIndex === undefined) {
      materialIndex = uniqueMaterials.length;
      uniqueIndex.set(sourceMaterial, materialIndex);
      uniqueMaterials.push(sourceMaterial);
    }
    const previous = remapped[remapped.length - 1];
    if (
      previous &&
      previous.materialIndex === materialIndex &&
      previous.start + previous.count === group.start
    ) {
      previous.count += group.count;
    } else {
      remapped.push({ start: group.start, count: group.count, materialIndex });
    }
  }
  geometry.clearGroups();
  for (const group of remapped) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  return uniqueMaterials;
}
