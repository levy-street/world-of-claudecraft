import * as THREE from 'three';
import { SwordmasterDashPainter } from './swordmaster_dash_painter';
import type { SwordmasterVisualPlan } from './swordmaster_fx_core';

type EntityAnchor = (entityId: number, heightFraction: number) => THREE.Vector3 | null;
type MotionPath = {
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  readonly to: { readonly x: number; readonly y: number; readonly z: number };
};

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
  private readonly dash: SwordmasterDashPainter;
  private nextSlot = 0;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: EntityAnchor,
    private readonly destinationAnchor: EntityAnchor = anchor,
  ) {
    this.dash = new SwordmasterDashPainter(scene);
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

  paint(
    plan: SwordmasterVisualPlan,
    sourceId: number,
    targetId: number,
    sourceFacing = 0,
    motionPath?: MotionPath,
  ): void {
    if (plan.kind === 'dash') {
      const renderedStart = this.anchor(sourceId, 0.5);
      const renderedEnd = this.destinationAnchor(sourceId, 0.5);
      const height = motionPath && renderedStart ? renderedStart.y - motionPath.from.y : 0;
      const start = motionPath
        ? new THREE.Vector3(motionPath.from.x, motionPath.from.y + height, motionPath.from.z)
        : renderedStart;
      const end = motionPath
        ? new THREE.Vector3(motionPath.to.x, motionPath.to.y + height, motionPath.to.z)
        : renderedEnd;
      if (start && end) this.dash.paint(plan, sourceId, start, end);
      return;
    }
    const source = this.anchor(sourceId, plan.anchor === 'source' ? 0.08 : 0.5);
    const target = this.anchor(targetId, 0.5);
    const at = plan.anchor === 'source' ? source : target;
    if (!at) return;

    const effectKey = `${sourceId}:${plan.anchor === 'source' ? sourceId : targetId}:${plan.abilityId}:${plan.kind}`;
    if (this.slots.some((slot) => slot.mesh.visible && slot.effectKey === effectKey)) {
      return;
    }

    const targetFacing =
      source && target ? Math.atan2(target.x - source.x, target.z - source.z) : sourceFacing;
    // Source-centered flourishes carry a self target, so their direction cannot
    // be inferred from the source-to-target vector. Use the entity's live
    // facing supplied by the renderer instead.
    const facing = plan.anchor === 'source' ? sourceFacing : targetFacing;
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
    this.dash.update(dt);
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
    this.dash.dispose();
    for (const slot of this.slots) {
      slot.mesh.removeFromParent();
      slot.mesh.material.dispose();
    }
    this.geometry.dispose();
  }
}
