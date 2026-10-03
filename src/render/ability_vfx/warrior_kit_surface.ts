import * as THREE from 'three';
import { GFX } from '../gfx';

export type WarriorKitSurface = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;

/** The Warrior kit's lit surface in the tier's material family: MeshStandard
 *  where the tier draws standard materials, Lambert where the rest of the tier
 *  does (Low, the iOS memory profile). MeshStandard scales its diffuse by
 *  (1 - metalness), so the Lambert base colour takes the same factor: the
 *  diffuse term matches and only the specular highlight goes. */
export function warriorKitSurface(
  name: string,
  options: THREE.MeshStandardMaterialParameters,
): WarriorKitSurface {
  if (GFX.standardMaterials) return new THREE.MeshStandardMaterial({ ...options, name });
  const { roughness: _roughness, metalness, ...lambert } = options;
  const material = new THREE.MeshLambertMaterial({ ...lambert, name });
  material.color.multiplyScalar(1 - (metalness ?? 0));
  return material;
}

let slotMap: THREE.DataTexture | null = null;

/** The map every kit surface holds until its sheet binds, and the hammer's for
 *  good. three keys a program on the map slot's presence and uv channel, never
 *  on the texture, so the boot warm-up links the very program the kit draws and
 *  the bind swaps the sheet in without a relink. Shared across renderers and
 *  never disposed: no pool disposes its maps, and a rebuilt renderer reuses it. */
export function warriorKitSlotMap(): THREE.Texture {
  if (!slotMap) {
    slotMap = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    slotMap.name = 'warrior-kit-slot';
    slotMap.needsUpdate = true;
  }
  return slotMap;
}
