// Shadow-pass depth material cache for the world-entry prewarm.
//
// Extracted from renderer.ts under the monolith ratchet (root CLAUDE.md,
// Modularity): it needs none of the coordinator's scene state, only its own
// cache, which the caller owns and passes in.

import * as THREE from 'three';
import type { TextureBackedMaterial } from './renderer_diagnostics';

/** The depth material three's real shadow pass would use for `source`,
 *  memoized in `cache` by the flags that actually change the linked program. */
export function prewarmDepthMaterialFor(
  cache: Map<string, THREE.MeshDepthMaterial>,
  source: THREE.Material,
): THREE.MeshDepthMaterial {
  const textured = source as TextureBackedMaterial & {
    displacementScale?: number;
    displacementBias?: number;
    wireframe?: boolean;
  };
  const shadowSide =
    source.shadowSide ??
    (source.side === THREE.FrontSide
      ? THREE.BackSide
      : source.side === THREE.BackSide
        ? THREE.FrontSide
        : THREE.DoubleSide);
  const key = [
    shadowSide,
    textured.map ? 1 : 0,
    textured.alphaMap ? 1 : 0,
    source.alphaToCoverage || source.alphaTest > 0 ? 1 : 0,
    textured.displacementMap ? 1 : 0,
    textured.wireframe ? 1 : 0,
  ].join('|');
  let depth = cache.get(key);
  if (depth) return depth;
  depth = new THREE.MeshDepthMaterial({
    side: shadowSide,
    map: textured.map ?? null,
    alphaMap: textured.alphaMap ?? null,
    alphaTest: source.alphaToCoverage ? 0.5 : source.alphaTest,
    displacementMap: textured.displacementMap ?? null,
    displacementScale: textured.displacementScale ?? 1,
    displacementBias: textured.displacementBias ?? 0,
    wireframe: textured.wireframe ?? false,
    // Match the REAL shadow pass: three's shared shadow depth material uses
    // RGBADepthPacking and depthPacking sits in the program cache key, so
    // the default BasicDepthPacking linked a variant the shadow pass never
    // draws, and every "prewarmed" caster relinked at its first shadow
    // draw anyway (the residue probe measured all of them).
    depthPacking: THREE.RGBADepthPacking,
  });
  depth.name = `prewarm-depth:${key}`;
  cache.set(key, depth);
  return depth;
}

/** Dispose every cached depth material and empty the cache. */
export function disposePrewarmDepthMaterials(
  cache: Map<string, THREE.MeshDepthMaterial>,
  bestEffort: (fn: () => void) => void,
): void {
  for (const material of cache.values()) bestEffort(() => material.dispose());
  cache.clear();
}
