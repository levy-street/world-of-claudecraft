import type * as THREE from 'three';
import { isProgramKnownReady } from './linked_program_readiness';
import type { LinkedProgramLike } from './linked_program_touch';
import { isTextureResident, type TexturePropertiesLike } from './texture_prep_core';
import { collectPrewarmTextures } from './texture_prewarm';

/** Conservative opt-in reveal proof. Gate settlement alone can also mean a
 * timeout or a fail-soft fallback. Reads context records, never driver queries. */
export function compileTargetPrepared(
  properties: TexturePropertiesLike,
  target: THREE.Object3D,
): boolean {
  let materials = 0;
  let ready = true;
  target.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials++;
      const record = properties.get(material) as
        | { programs?: Map<string, LinkedProgramLike> }
        | undefined;
      if (!record?.programs?.size) ready = false;
      else
        for (const program of record.programs.values())
          if (!isProgramKnownReady(program)) ready = false;
    }
  });
  if (!ready || materials === 0) return false;
  const textures = new Set<THREE.Texture>();
  collectPrewarmTextures(target, textures);
  for (const texture of textures)
    if (!isTextureResident(properties, texture as Pick<THREE.Texture, 'version'>)) return false;
  return true;
}
