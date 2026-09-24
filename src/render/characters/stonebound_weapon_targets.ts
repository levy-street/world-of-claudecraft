import type * as THREE from 'three';
import { weaponAttackStyle } from './weapon_attack_style_core';

/** Structural stone follows actual weapon holders, whose two swap tags differ.
 * Generic color overlays retain their existing mainhand-only selection. */
export function weaponAuraTargets(
  model: THREE.Object3D,
  stonebound: boolean,
  mainhand: string | null,
  offhand: string | null,
): THREE.Object3D[] {
  const holders: THREE.Object3D[] = [];
  const dual = stonebound && weaponAttackStyle(mainhand, offhand) === 'dualwield';
  model.traverse((node) => {
    if (
      node.userData.swapWeaponHolder ||
      (dual && node.userData.heldPropHolder && node.userData.heldSlot === 1)
    )
      holders.push(node);
  });
  return holders;
}
