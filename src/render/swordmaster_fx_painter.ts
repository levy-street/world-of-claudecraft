import * as THREE from 'three';
import type { SwordmasterDamageVisualPlan } from './swordmaster_fx_plan';

type EntityAnchor = (entityId: number, heightFraction: number) => THREE.Vector3 | null;

interface SwordArcSlot {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  duration: number;
  radius: number;
  baseRotationZ: number;
  spinRate: number;
  effectKey: string | null;
}

const ARC_POOL_SIZE = 24;

/** Pooled procedural cyan blade arcs. The renderer only submits plans; this
 * painter owns geometry, animation, de-duplication, and material lifetime. */
export class SwordmasterFxPainter {
  private readonly geometry = new THREE.RingGeometry(0.68, 1, 40, 1, -0.72, 1.44);
  private readonly slots: SwordArcSlot[] = [];
  private nextSlot = 0;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: EntityAnchor,
  ) {
    for (let i = 0; i < ARC_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.userData.renderCategory = 'vfx';
      scene.add(mesh);
      this.slots.push({
        mesh,
        elapsed: 0,
        duration: 0,
        radius: 1,
        baseRotationZ: 0,
        spinRate: 0,
        effectKey: null,
      });
    }
  }

  paint(plan: SwordmasterDamageVisualPlan, sourceId: number, targetId: number): void {
    const source = this.anchor(sourceId, plan.anchor === 'source' ? 0.08 : 0.5);
    const target = this.anchor(targetId, 0.5);
    const at = plan.anchor === 'source' ? source : target;
    if (!at) return;

    const effectKey = `${sourceId}:${plan.anchor === 'source' ? sourceId : targetId}:${plan.abilityId}:${plan.kind}`;
    if (this.slots.some((slot) => slot.mesh.visible && slot.effectKey === effectKey)) {
      return;
    }

    const facing = source && target ? Math.atan2(target.x - source.x, target.z - source.z) : 0;
    for (let i = 0; i < plan.arcs; i++) {
      const slot = this.slots[this.nextSlot];
      this.nextSlot = (this.nextSlot + 1) % this.slots.length;
      const spread = (i - (plan.arcs - 1) * 0.5) * 0.58;
      slot.elapsed = 0;
      slot.duration = plan.duration;
      slot.radius = plan.radius * (1 - i * 0.08);
      slot.baseRotationZ = plan.anchor === 'source' ? spread + facing : spread;
      slot.spinRate = plan.spinRate * (i % 2 === 0 ? 1 : -1);
      slot.effectKey = effectKey;
      slot.mesh.position.copy(at);
      slot.mesh.material.color.setHex(plan.color);
      slot.mesh.material.opacity = 0.9;
      slot.mesh.scale.setScalar(slot.radius * 0.72);
      if (plan.anchor === 'source') {
        slot.mesh.rotation.set(-Math.PI / 2, 0, slot.baseRotationZ);
      } else {
        slot.mesh.rotation.set(0, facing, spread);
      }
      slot.mesh.visible = true;
    }
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.mesh.visible) continue;
      slot.elapsed += dt;
      const progress = Math.min(1, slot.elapsed / slot.duration);
      if (progress >= 1) {
        slot.mesh.visible = false;
        slot.effectKey = null;
        continue;
      }
      const eased = 1 - (1 - progress) * (1 - progress);
      slot.mesh.scale.setScalar(slot.radius * (0.72 + eased * 0.34));
      slot.mesh.rotation.z = slot.baseRotationZ + slot.spinRate * slot.elapsed;
      slot.mesh.material.opacity = 0.9 * (1 - progress) ** 1.5;
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.mesh.removeFromParent();
      slot.mesh.material.dispose();
    }
    this.geometry.dispose();
  }
}
