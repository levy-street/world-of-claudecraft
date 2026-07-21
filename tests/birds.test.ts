import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBirds } from '../src/render/birds';

// DUNGEON_X_THRESHOLD = 600 (src/sim/data.ts): x beyond this is inside an
// instance, where the sky — and the flock — must not render.
const INDOORS_X = 700;

describe('ambient bird flock', () => {
  it('builds a non-empty flock under a single group', () => {
    const { group } = buildBirds(1234);
    expect(group.children.length).toBeGreaterThan(0);
    // Every bird is a sub-group of two wing meshes.
    for (const bird of group.children) {
      expect(bird).toBeInstanceOf(THREE.Group);
      expect(bird.children.length).toBe(2);
    }
  });

  it('is reproducible for a given seed and varies across seeds', () => {
    const a = buildBirds(42);
    const b = buildBirds(42);
    const c = buildBirds(43);
    a.update(0, 0, 0.05);
    b.update(0, 0, 0.05);
    c.update(0, 0, 0.05);
    const pos = (v: { group: THREE.Group }) => v.group.children[0].position.clone();
    expect(pos(a).distanceTo(pos(b))).toBeLessThan(1e-9);
    expect(pos(a).distanceTo(pos(c))).toBeGreaterThan(0);
  });

  it('hides the flock when the player is inside an instance', () => {
    const { group, update } = buildBirds(7);
    update(INDOORS_X, 0, 0.1);
    expect(group.visible).toBe(false);
    // Back outdoors it shows again.
    update(0, 0, 0.1);
    expect(group.visible).toBe(true);
  });

  it('keeps the flock within sky range of the player as they travel', () => {
    const { group, update } = buildBirds(99);
    // March the player a long way; the flock must recycle to stay nearby
    // rather than being abandoned in the distance.
    let px = 0;
    for (let i = 0; i < 400; i++) {
      px += 5; // 5 yd/step
      if (px > 580) px = 0; // stay in the overworld band
      update(px, 0, 0.1);
    }
    for (const bird of group.children) {
      const dx = bird.position.x - px;
      const dz = bird.position.z - 0;
      // DESPAWN_RADIUS (165) plus the flock's back-formation extent.
      expect(Math.hypot(dx, dz)).toBeLessThan(220);
    }
  });

  it('flaps wings symmetrically and within amplitude', () => {
    const { group, update } = buildBirds(5);
    update(0, 0, 0.13);
    for (const bird of group.children) {
      const [lw, rw] = bird.children as THREE.Mesh[];
      // Opposite wings mirror about the forward axis.
      expect(lw.rotation.z).toBeCloseTo(-rw.rotation.z, 9);
      expect(Math.abs(lw.rotation.z)).toBeLessThanOrEqual(0.56);
    }
  });
});
