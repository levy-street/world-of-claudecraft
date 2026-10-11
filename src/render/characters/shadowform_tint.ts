// Shadowform ("Gloamveil"): the priest's own body tinted shadow-purple, drawn
// OPAQUE and lit. It is a program-preserving clone (material_clone_hooks.ts)
// that keeps the source's `transparent`, so it keeps the source's program: it
// never links anything and never waits on a gate. The class halo takes the
// same tint on its own additive material.

import type * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';

export const SHADOWFORM_TINT = 0x5a2a8f;
export const SHADOWFORM_EMISSIVE = 0x2a0a4a;
export const SHADOWFORM_EMISSIVE_INTENSITY = 0.4;

type TintableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/** The Shadowform clone of `source`. */
export function createShadowformTintMaterial(source: THREE.Material): THREE.Material {
  const clone = cloneMaterialWithHooks(source) as TintableMaterial;
  clone.color?.setHex(SHADOWFORM_TINT);
  if (clone.emissive) {
    clone.emissive.setHex(SHADOWFORM_EMISSIVE);
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, SHADOWFORM_EMISSIVE_INTENSITY);
  }
  return clone;
}
