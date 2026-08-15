// Soul Rend's transparent clone: three keys programs on `transparent` /
// `depthWrite`, so this variant must be compiled before the first mark.
import * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';

export const SOUL_REND_OPACITY = 0.58;
export const SOUL_REND_TINT_HEX = 0x4f0505;
export const SOUL_REND_EMISSIVE_HEX = 0x2a0000;
export const SOUL_REND_EMISSIVE_INTENSITY = 0.35;

const SOUL_REND_TINT = new THREE.Color(SOUL_REND_TINT_HEX);

export function applySoulRendOverlay(material: THREE.Material): THREE.Material {
  const marked = cloneMaterialWithHooks(material);
  marked.transparent = true;
  marked.opacity = SOUL_REND_OPACITY;
  marked.depthWrite = false;
  const withColor = marked as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };
  if (withColor.color) withColor.color.copy(SOUL_REND_TINT);
  if (withColor.emissive) {
    withColor.emissive.setHex(SOUL_REND_EMISSIVE_HEX);
    withColor.emissiveIntensity = Math.max(
      withColor.emissiveIntensity ?? 0,
      SOUL_REND_EMISSIVE_INTENSITY,
    );
  }
  return marked;
}
