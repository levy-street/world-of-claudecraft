import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AOE_RING_LIFETIME, aoeRingAnim } from '../src/render/aoe_ring';
import { buildAoeRingPool, updateAoeRingPool } from '../src/render/aoe_ring_visual';

describe('combat area boundary', () => {
  it('always represents the true radius while brightness fades within the GCD', () => {
    for (const elapsed of [0, 0.001, 0.04, 0.17, 0.35, AOE_RING_LIFETIME - 0.001]) {
      const state = aoeRingAnim(elapsed);
      expect(state.active).toBe(true);
      expect(state.ringScale).toBe(1);
      expect(state.ringAlpha).toBeGreaterThan(0);
    }
    expect(aoeRingAnim(0.4).ringAlpha).toBeLessThan(aoeRingAnim(0).ringAlpha);
    expect(aoeRingAnim(AOE_RING_LIFETIME).active).toBe(false);
    expect(aoeRingAnim(-1).active).toBe(false);
  });
  it('keeps the existing shared-geometry footprint pool separate from class decoration', () => {
    const scene = new THREE.Scene();
    const slots = buildAoeRingPool(scene, 4);
    expect(slots).toHaveLength(4);
    expect(scene.children).toHaveLength(4);
    expect(new Set(slots.map((s) => s.ring.geometry)).size).toBe(1);
    for (const slot of slots) {
      expect(slot.ring.visible).toBe(false);
      expect(slot.ring.userData.renderCategory).toBe('ui3d');
      expect(slot.elapsed).toBe(AOE_RING_LIFETIME);
      slot.mat.dispose();
    }
    slots[0].elapsed = 0;
    slots[0].radius = 8;
    updateAoeRingPool(slots, 0);
    expect(slots[0].ring.scale.x).toBe(8);
    expect(slots[0].mat.opacity).toBe(1);
    updateAoeRingPool(slots, 0.8);
    expect(slots[0].ring.visible).toBe(false);
    slots[0].ring.geometry.dispose();
  });
});
