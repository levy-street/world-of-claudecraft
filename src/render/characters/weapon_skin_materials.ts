import type * as THREE from 'three';

const OWNED_MATERIAL_TAG = 'weaponSkinMaterialOwned';

function addMaterials(
  into: Set<THREE.Material>,
  material: THREE.Material | THREE.Material[] | undefined,
): void {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const entry of material) into.add(entry);
  } else {
    into.add(material);
  }
}

/** Mark a weapon payload whose materials were cloned exclusively for this view. */
export function markOwnedWeaponSkinMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.userData[OWNED_MATERIAL_TAG] = true;
  });
}

/**
 * Dispose the exclusive material clones below `root`, plus any original and
 * effect variants retained by CharacterVisual. Cached character and GLTF source
 * materials are unmarked and therefore remain alive.
 */
export function disposeOwnedWeaponSkinMaterials(
  root: THREE.Object3D,
  originals?: ReadonlyMap<THREE.Mesh, THREE.Material | THREE.Material[]>,
  variantMaps: Map<THREE.Material, THREE.Material>[] = [],
): void {
  const owned = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.userData[OWNED_MATERIAL_TAG]) return;
    addMaterials(owned, mesh.material);
    addMaterials(owned, originals?.get(mesh));
  });

  for (const variants of variantMaps) {
    for (const [source, variant] of variants) {
      if (!owned.has(source)) continue;
      owned.add(variant);
      variants.delete(source);
    }
  }
  for (const material of owned) material.dispose();
}
