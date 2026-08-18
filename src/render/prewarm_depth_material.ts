// The depth material the shadow prewarm compiles against.
//
// Extracted from renderer.ts (the monolith ratchet's own rule: work that does not
// need the coordinator's private mutable state is a sibling module). It needs exactly
// one piece of renderer state, a cache Map, so that is passed in rather than reached
// for; the renderer still owns the map's lifetime and disposes it on teardown.
//
// The whole point of this material is to match what the REAL shadow pass will link.
// A prewarm that compiles a DIFFERENT depth variant is worse than no prewarm at all:
// it costs a link, reports success, and every caster still relinks at its first
// shadow draw. Two details carry that, and both are load-bearing:
//
//   - `depthPacking` is RGBADepthPacking, matching three's shared shadow depth
//     material. It sits in the program cache key, so the BasicDepthPacking default
//     linked a variant the shadow pass never draws. The residue probe measured every
//     caster relinking anyway.
//   - The cache KEY carries every property that changes the linked program (shadow
//     side, the presence of map / alphaMap / displacementMap, alpha cutout, wireframe)
//     and nothing that does not. A key missing one of these silently shares a material
//     across two variants; a key carrying extra fields just wastes cache entries.
import * as THREE from 'three';
import type { TextureBackedMaterial } from './renderer_diagnostics';

/** The extra fields a depth variant keys on beyond the diagnostics-facing shape. */
type DepthSourceMaterial = TextureBackedMaterial & {
  displacementScale?: number;
  displacementBias?: number;
  wireframe?: boolean;
};

/**
 * Resolve (and memoize) the `MeshDepthMaterial` a shadow-casting `source` will use, so
 * the prewarm links the same program the shadow pass later draws with.
 *
 * `cache` is the renderer's own map, keyed by the variant string built here.
 */
export function prewarmDepthMaterialFor(
  source: THREE.Material,
  cache: Map<string, THREE.MeshDepthMaterial>,
): THREE.MeshDepthMaterial {
  const textured = source as DepthSourceMaterial;
  // three derives the shadow side by flipping the draw side when the material does
  // not state one, so mirror that exactly rather than defaulting to FrontSide.
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
  const hit = cache.get(key);
  if (hit) return hit;
  const depth = new THREE.MeshDepthMaterial({
    side: shadowSide,
    map: textured.map ?? null,
    alphaMap: textured.alphaMap ?? null,
    alphaTest: source.alphaToCoverage ? 0.5 : source.alphaTest,
    displacementMap: textured.displacementMap ?? null,
    displacementScale: textured.displacementScale ?? 1,
    displacementBias: textured.displacementBias ?? 0,
    wireframe: textured.wireframe ?? false,
    depthPacking: THREE.RGBADepthPacking,
  });
  depth.name = `prewarm-depth:${key}`;
  cache.set(key, depth);
  return depth;
}
