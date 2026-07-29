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
      `${EMISSIVE_CHUNK}
#if defined( USE_COLOR_ALPHA )
  totalEmissiveRadiance *= vColor.rgb;
#elif defined( USE_COLOR )
  totalEmissiveRadiance *= vColor;
#endif`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${PROGRAM_CACHE_KEY}`;
  material.userData.vertexColorEmissive = PROGRAM_CACHE_KEY;
  decoratedMaterials.add(material);
  material.needsUpdate = true;
  return material;
}

export const vertexColorEmissiveInternalsForTest = {
  programCacheKey: PROGRAM_CACHE_KEY,
};
