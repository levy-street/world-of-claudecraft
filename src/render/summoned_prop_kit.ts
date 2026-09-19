// Shared kit for the procedural summoned props (grand_portal.ts, hellgate.ts):
// surfaceMat-backed stone/emissive materials (shared, never disposed), the
// owned additive swirl rings, and the per-frame ring spin.

import * as THREE from 'three';
import { GFX, surfaceMat } from './gfx';

export const OWNED_MATERIALS_KEY = 'summonedOwnedMaterials';

export function stoneMaterial(color: number, roughness: number, metalness: number): THREE.Material {
  return surfaceMat({ color, roughness, metalness, flatShading: !GFX.standardMaterials });
}

export function emissiveMaterial(
  color: number,
  emissive: number,
  emissiveIntensity: number,
  roughness: number,
): THREE.Material {
  return surfaceMat({
    color,
    emissive,
    emissiveIntensity,
    roughness,
    metalness: 0.02,
    flatShading: !GFX.standardMaterials,
  });
}

/** An additive, non-depth-writing material the calling prop owns (and disposes). */
export function additiveMaterial(
  color: number,
  opacity: number,
  owned: THREE.Material[],
  extra: THREE.MeshBasicMaterialParameters = {},
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...extra,
  });
  owned.push(material);
  return material;
}

/** Concentric additive tori added to `swirl` after its disc (children[0]). */
export function addSwirlRings(
  swirl: THREE.Group,
  rings: readonly (readonly [radius: number, opacity: number, color: number])[],
  tube: number,
  owned: THREE.Material[],
): void {
  for (const [radius, opacity, color] of rings) {
    swirl.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 6, 24),
        additiveMaterial(color, opacity, owned),
      ),
    );
  }
}

/** Counter-rotate the rings (children after the disc) at increasing rates. */
export function spinSwirlRings(swirl: THREE.Object3D, phase: number, sign: 1 | -1): void {
  for (let i = 1; i < swirl.children.length; i++) {
    swirl.children[i].rotation.z = phase * (i % 2 === 0 ? sign : -sign) * (0.6 + i * 0.25);
  }
}

export function disposeOwnedMaterials(root: THREE.Object3D): void {
  const materials = root.userData[OWNED_MATERIALS_KEY] as THREE.Material[] | undefined;
  if (!materials) return;
  for (const material of new Set(materials)) material.dispose();
  delete root.userData[OWNED_MATERIALS_KEY];
}
