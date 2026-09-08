import * as THREE from 'three';
import { AOE_RING_LIFETIME, aoeRingAnim } from './aoe_ring';

export interface AoeRingSlot {
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  radius: number;
  elapsed: number;
}

/** Fixed pool for gameplay footprint cues; class decoration lives elsewhere. */
export function buildAoeRingPool(scene: THREE.Scene, count: number): AoeRingSlot[] {
  const geometry = new THREE.RingGeometry(0.88, 1, 64);
  geometry.rotateX(-Math.PI / 2);
  const slots: AoeRingSlot[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const ring = new THREE.Mesh(geometry, mat);
    ring.visible = false;
    ring.renderOrder = 3;
    ring.userData.renderCategory = 'ui3d';
    scene.add(ring);
    slots.push({ ring, mat, radius: 1, elapsed: AOE_RING_LIFETIME });
  }
  return slots;
}

export function updateAoeRingPool(slots: readonly AoeRingSlot[], dt: number): void {
  for (const slot of slots) {
    if (slot.elapsed >= AOE_RING_LIFETIME) continue;
    slot.elapsed += dt;
    const state = aoeRingAnim(slot.elapsed);
    slot.ring.visible = state.active;
    if (!state.active) continue;
    slot.ring.scale.setScalar(slot.radius * state.ringScale);
    slot.mat.opacity = state.ringAlpha;
  }
}
