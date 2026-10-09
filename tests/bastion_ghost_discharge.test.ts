import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BastionGhostDischarge } from '../src/render/sunken_bastion/bastion_ghost_discharge';

const origin = { x: 100900, y: 0, z: 5000 };
function fixture() {
  const root = new THREE.Group();
  const fx = new BastionGhostDischarge(root);
  return {
    root,
    fx,
    fire: root.getObjectByName('ghost-discharge-fire') as THREE.InstancedMesh,
    smoke: root.getObjectByName('ghost-discharge-smoke') as THREE.InstancedMesh,
  };
}

describe('ghost broadside cosmetic discharge', () => {
  it('draws simultaneous muzzle flashes and smoke in two bounded local-coordinate batches', () => {
    const f = fixture();
    for (let i = 0; i < 5; i++)
      f.fx.observe(10 + i, 'broadside', origin.x + i * 5, 2.1, origin.z, 0, 28, 0);
    f.fx.update(0.12, origin, false);
    expect(f.root.children).toHaveLength(2);
    expect(f.fire.count).toBe(70);
    expect(f.smoke.count).toBe(40);
    const matrix = new THREE.Matrix4();
    f.fire.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(0);
    expect(matrix.elements[14]).toBe(0);
    expect(f.fire.position.x).toBe(100900);
    // Cosmetic clouds survive the short authoritative impact cue, then die.
    f.fx.update(0.55, origin, false);
    expect(f.smoke.count).toBe(40);
    f.fx.update(0.6, origin, false);
    expect(f.fire.count).toBe(0);
    expect(f.smoke.count).toBe(0);
    // A repeated snapshot of the same finished cue cannot fire again.
    f.fx.observe(10, 'broadside', origin.x, 2.1, origin.z, 0, 28, 0);
    f.fx.update(0.01, origin, false);
    expect(f.fire.count).toBe(0);
    f.fx.dispose();
    expect(f.root.children).toHaveLength(0);
  });

  it('suppresses discharge motion under reduced motion and never evicts a saturated live burst', () => {
    const f = fixture();
    for (let i = 0; i < 12; i++)
      f.fx.observe(i, 'broadside', origin.x + i * 2, 2.1, origin.z, 0, 28, 0);
    f.fx.update(0.1, origin, true);
    expect(f.fire.count).toBe(0);
    expect(f.smoke.count).toBe(0);
    f.fx.update(0.01, origin, false);
    expect(f.fire.count).toBe(112);
    expect(f.smoke.count).toBe(64);
    f.fx.clear();
    expect(f.fire.count).toBe(0);
    expect(f.smoke.count).toBe(0);
    f.fx.dispose();
  });

  it('adds a simultaneous boarding wake without duplicating the anchor mechanic', () => {
    const f = fixture();
    f.fx.observe(1, 'anchor', origin.x, 1.1, origin.z, 0, 24, 0);
    f.fx.update(0.05, origin, false);
    expect(f.fire.count).toBe(0);
    f.fx.observe(2, 'boarding', origin.x, 1.1, origin.z, 0, 18, 0.1);
    f.fx.update(0.01, origin, false);
    expect(f.fire.count).toBe(12);
    expect(f.smoke.count).toBe(8);
    const matrix = new THREE.Matrix4();
    f.fire.getMatrixAt(0, matrix);
    expect(matrix.elements[14]).toBeCloseTo(0.75);
    f.fire.getMatrixAt(11, matrix);
    expect(matrix.elements[14]).toBeCloseTo(17.25);
    f.fx.dispose();
  });
});
