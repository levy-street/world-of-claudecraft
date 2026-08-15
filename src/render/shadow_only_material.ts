// A colour-pass-inert clone of a foliage material for the merged shadow-only
// caster rows (colorWrite/depthWrite off; the shadow pass itself renders with
// three's depth material, so only inertness matters there). The subtle half is
// program identity: the colour pass still BINDS the clone's program for every
// gated caster row, and Material.clone() drops both own-property hooks
// (onBeforeCompile and customProgramCacheKey; Material.copy lists neither)
// while three keys its program cache on customProgramCacheKey(), whose default
// return value IS onBeforeCompile.toString(). A bare clone therefore mints a
// key no prewarm ever compiled and links a NEW program at its first bind: the
// mid-travel compile hitch (measured as first-draw Bark/Leaves program links
// at a zone border). Carrying the source's own hook references over makes the
// composed key byte-identical, so the clone reuses the program the source
// already linked. The sibling instanceColor note on buildShadowCasters guards
// the attribute half of the same invariant.

import type * as THREE from 'three';

const shadowOnlyMaterialCache = new WeakMap<THREE.Material, THREE.Material>();

export function makeShadowOnlyMaterial(src: THREE.Material): THREE.Material {
  const cached = shadowOnlyMaterialCache.get(src);
  if (cached) return cached;
  const mat = src.clone();
  if (Object.hasOwn(src, 'onBeforeCompile')) mat.onBeforeCompile = src.onBeforeCompile;
  if (Object.hasOwn(src, 'customProgramCacheKey')) {
    mat.customProgramCacheKey = src.customProgramCacheKey;
  }
  mat.colorWrite = false;
  mat.depthWrite = false;
  shadowOnlyMaterialCache.set(src, mat);
  return mat;
}
