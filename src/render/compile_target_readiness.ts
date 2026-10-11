import type * as THREE from 'three';
import { isProgramKnownReady } from './linked_program_readiness';
import type { LinkedProgramLike } from './linked_program_touch';
import {
  isTexturePrepCandidate,
  isTextureResident,
  type TexturePrepTexture,
  type TexturePropertiesLike,
} from './texture_prep_core';
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
  // A texture the gate's upload lane refuses (no image yet, version 0, video,
  // external, render target) can never read resident, so it must not hold the
  // proof false forever; the lane skips it by the same rule.
  for (const texture of textures as Set<TexturePrepTexture>)
    if (isTexturePrepCandidate(texture) && !isTextureResident(properties, texture)) return false;
  return true;
}

/** The proof a live gate's settle hands its caller: none on a host without
 *  parallel compile, whose gate settles at once over programs it never linked,
 *  so the thunk would read false forever where the draw links them anyway.
 *  The thunk reads `webgl.properties` when called: a context restore replaces
 *  it, and the old one would prove programs of a dead context. */
export function compileProof(
  asyncCompile: boolean,
  webgl: { readonly properties: TexturePropertiesLike },
  target: THREE.Object3D,
): (() => boolean) | undefined {
  return asyncCompile ? () => compileTargetPrepared(webgl.properties, target) : undefined;
}
