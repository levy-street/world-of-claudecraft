import type * as THREE from 'three';

const PROGRAM_CACHE_KEY = 'vertex-color-emissive-v1';
const EMISSIVE_CHUNK = '#include <emissivemap_fragment>';
const decoratedMaterials = new WeakSet<THREE.Material>();

/**
 * Three multiplies diffuse light by COLOR_0 but leaves emissive radiance uniform.
 * Eastbrook's two-material assets intentionally carry amber and cyan in one
 * emissive primitive, so modulate that radiance in the shared fragment path.
 */
export function modulateEmissiveByVertexColor<T extends THREE.Material>(material: T): T {
  if (decoratedMaterials.has(material)) return material;
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      EMISSIVE_CHUNK,
      // r185 declares vColor as vec4 under BOTH USE_COLOR and USE_COLOR_ALPHA
      // (color_pars_fragment; r165 used vec3 for plain USE_COLOR), so both
      // arms take .rgb.
      `${EMISSIVE_CHUNK}
#if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR )
  totalEmissiveRadiance *= vColor.rgb;
#endif`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${PROGRAM_CACHE_KEY}`;
  material.userData.vertexColorEmissive = PROGRAM_CACHE_KEY;
  decoratedMaterials.add(material);
  material.needsUpdate = true;
  return material;
}

/**
 * True for a material `modulateEmissiveByVertexColor` decorated. Reads the
 * userData stamp rather than the WeakSet, so it also answers for a `clone()`
 * (which copies userData but drops the hook functions themselves).
 */
export function hasVertexColorEmissive(material: THREE.Material): boolean {
  return (
    (material.userData as { vertexColorEmissive?: string }).vertexColorEmissive ===
    PROGRAM_CACHE_KEY
  );
}

/**
 * Re-attach the layer to a clone whose userData records it. Without this a
 * clone of a town emissive material composes a DIFFERENT
 * `customProgramCacheKey` from its source, so its first draw links a fresh
 * program (measured: the occluder-fade twin of the Eastbrook inn's emissive
 * material linked cold, 120.5 ms, inside a gameplay frame). No-op on a clone
 * of an undecorated source, which would split the cache the other way.
 */
export function reapplyVertexColorEmissiveToClone<T extends THREE.Material>(clone: T): T {
  if (!hasVertexColorEmissive(clone)) return clone;
  return modulateEmissiveByVertexColor(clone);
}

export const vertexColorEmissiveInternalsForTest = {
  programCacheKey: PROGRAM_CACHE_KEY,
};
