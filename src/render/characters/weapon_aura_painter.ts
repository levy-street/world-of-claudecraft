import * as THREE from 'three';
import type { WeaponAuraPlan } from './weapon_aura_core';

export interface WeaponAuraHandle {
  readonly meshCount: number;
  dispose(): void;
}

class PaintedWeaponAura implements WeaponAuraHandle {
  constructor(private readonly meshes: THREE.Mesh[]) {}

  get meshCount(): number {
    return this.meshes.length;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
    this.meshes.length = 0;
  }
}

/** Paint additive shells over the selected live held slots. Geometry remains
 * shared with the weapon payload; only the small aura materials are owned. */
export function paintWeaponAura(model: THREE.Object3D, plan: WeaponAuraPlan): WeaponAuraHandle {
  const slots = new Set(plan.slots);
  const holders: THREE.Object3D[] = [];
  model.traverse((object) => {
    if (
      (object.userData.swapWeaponHolder || object.userData.swapOffhandHolder) &&
      slots.has(object.userData.heldSlot as number)
    ) {
      holders.push(object);
    }
  });

  const meshes: THREE.Mesh[] = [];
  for (const holder of holders) {
    holder.traverse((object) => {
      const weapon = object as THREE.Mesh;
      if (!weapon.isMesh || !weapon.userData.weaponMesh || !weapon.parent) return;
      const aura = new THREE.Mesh(
        weapon.geometry,
        new THREE.MeshBasicMaterial({
          color: plan.color,
          transparent: true,
          opacity: plan.opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      aura.position.copy(weapon.position);
      aura.quaternion.copy(weapon.quaternion);
      aura.scale.copy(weapon.scale).multiplyScalar(plan.scale);
      aura.renderOrder = 3;
      aura.userData.weaponVfxMesh = true;
      aura.userData.weaponAuraId = plan.id;
      weapon.parent.add(aura);
      meshes.push(aura);
    });
  }
  return new PaintedWeaponAura(meshes);
}
