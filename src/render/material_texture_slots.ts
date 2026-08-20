// The named texture slots of three's built-in materials and the collectors
// that walk them: the shared vocabulary of the renderer's texture prewarm
// (upload the maps a material will sample before its first draw) and of the
// boot scene texture collection. Kept beside the material types it reads
// (renderer_diagnostics.ts) and free of renderer state, so the walk is
// Node-testable and the two renderer callers share ONE slot list.

import type * as THREE from 'three';
import type { RenderableDiagnosticObject } from './render_diagnostics';
import type { TextureBackedMaterial, TextureMaterialKey } from './renderer_diagnostics';

export const MATERIAL_TEXTURE_KEYS: readonly TextureMaterialKey[] = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'gradientMap',
];

/** Every texture bound in one material's named slots (unset slots skipped). */
export function materialSlotTextures(material: THREE.Material): THREE.Texture[] {
  const textureMaterial = material as TextureBackedMaterial;
  const textures: THREE.Texture[] = [];
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const texture = textureMaterial[key];
    if (texture) textures.push(texture);
  }
  return textures;
}

/**
 * Collect the slot textures of every material under `obj` into `textures`
 * (deduplicated by the Set). `visibleOnly` walks traverseVisible, so hidden
 * subtrees are skipped: the boot scene collection deliberately mirrors what
 * the initial frame will draw.
 */
export function collectObjectTextures(
  obj: THREE.Object3D,
  visibleOnly: boolean,
  textures = new Set<THREE.Texture>(),
): Set<THREE.Texture> {
  const collect = (child: THREE.Object3D): void => {
    const renderable = child as RenderableDiagnosticObject;
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of materials) {
      for (const texture of materialSlotTextures(material)) textures.add(texture);
    }
  };
  if (visibleOnly) obj.traverseVisible(collect);
  else obj.traverse(collect);
  return textures;
}
