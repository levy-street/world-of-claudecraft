// A GLB material with KHR_materials_transmission arrives as a transmissive
// MeshPhysicalMaterial, and three then renders every transmissive object
// through its TRANSMISSION PASS: the whole opaque scene drawn a second time
// per frame into a viewport-sized HalfFloat target with mipmaps
// (WebGLRenderer.renderTransmissionPass). Measured 2026-08-28 on the water
// elemental (living_water 0.9, deep_water 0.72): a 4 s frame at the summon
// for the target's allocation and first render, then the double render for
// as long as the pet is on screen, on every backend, worker or not. At game
// scale the refraction the pass buys is invisible (side by side captures at
// ultra: the translucent stand-in reads the same), so every transmissive
// material becomes a plain translucent one at load, here, once per parsed
// GLB, before any consumer clones it.

import type * as THREE from 'three';

/** How much of the transmission factor becomes see-through: 0.9 (the water
 *  elemental's body) lands at opacity 0.8, which the captures matched. */
export const TRANSMISSION_OPACITY_LOSS = 0.22;

interface TransmissiveLike {
  transmission?: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  needsUpdate: boolean;
}

/** True when the material would take three's transmission pass. */
export function isTransmissive(material: { transmission?: number }): boolean {
  return (material.transmission ?? 0) > 0;
}

/** Turn a transmissive material into a translucent one: no transmission
 *  (so no pass), alpha blending with an opacity derived from the factor,
 *  and no depth write, the same state GLTFLoader gives an alphaMode BLEND
 *  material. Returns true when the material changed. */
export function neutralizeTransmission(material: TransmissiveLike): boolean {
  const transmission = material.transmission ?? 0;
  if (transmission <= 0) return false;
  material.transmission = 0;
  material.transparent = true;
  material.opacity = Math.min(material.opacity, 1 - transmission * TRANSMISSION_OPACITY_LOSS);
  material.depthWrite = false;
  material.needsUpdate = true;
  return true;
}

/** Every material under a parsed GLB's scene, once each. */
export function neutralizeGltfTransmission(gltf: { scene: THREE.Object3D }): number {
  const seen = new Set<THREE.Material>();
  let changed = 0;
  // A loader stub in a test may hand over a scene with no graph at all.
  if (typeof gltf.scene?.traverse !== 'function') return 0;
  gltf.scene.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      if (neutralizeTransmission(entry as unknown as TransmissiveLike)) changed++;
    }
  });
  return changed;
}
