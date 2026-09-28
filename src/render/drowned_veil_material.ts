// The drowned shrine's water-blue veil.
//
// The delve-entrance GLB bakes its stone AND its hanging veil into one shared
// texture (single unnamed material), so the veil can't be recolored by material
// name. For the drowned shrine we want that red veil to read as water: clone the
// converted material and inject a red to blue recolor that only touches reddish
// texels (R dominant over G/B), leaving the grey stone untouched. Cloned per
// asset-part material so the default (purple) entrance keeps the original red veil.
//
// The clone keeps every layer the kit converter attached (the zone haze on every
// tier, the worn surface detail on high and up) and the recolor chains after
// them. A bare clone() drops onBeforeCompile, and a replacing hook would drop it
// again, which left the drowned arch crisp and unworn beside every other delve
// entrance.

import type * as THREE from 'three';
import { cloneMaterialWithHooks } from './material_clone_hooks';

const DROWN_VEIL_KEY = 'drownVeil';

const drownVeilCache = new Map<THREE.Material, THREE.Material>();

export function drownVeilMaterial(src: THREE.Material): THREE.Material {
  const cached = drownVeilCache.get(src);
  if (cached) return cached;
  const m = cloneMaterialWithHooks(src);
  const previousCompile = m.onBeforeCompile.bind(m);
  const previousKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      // recolor the baked red veil to a murky Blackwater blue; red-dominance gates it
      // so stone stays grey. The gate must SATURATE (smoothstep, full recolor by 0.15):
      // texels here are linear-space, where even a bright red fold only reaches ~0.5
      // dominance, and the old linear-strength mix left half the red channel intact,
      // so the veil still read red in-game. Stone dominance measures under 0.01.
      float _veilRed = smoothstep(0.02, 0.15, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.04, 0.13, 0.2) * (0.4 + diffuseColor.r), _veilRed);
      `,
    );
  };
  m.customProgramCacheKey = () => `${previousKey()}|${DROWN_VEIL_KEY}`;
  drownVeilCache.set(src, m);
  return m;
}

/** Drop the per-source clones with the prop profile caches they derive from. */
export function resetDrownVeilMaterials(): void {
  drownVeilCache.clear();
}
