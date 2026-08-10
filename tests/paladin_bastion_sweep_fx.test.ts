import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  PALADIN_BASTION_SWEEP_PROJECTION_SCALE,
  PaladinBastionSweepFx,
  paladinBastionSweepProjectionPlan,
} from '../src/render/characters/paladin_bastion_sweep_fx';

describe('Paladin Bastion Sweep shield projection', () => {
  it('grows during anticipation, peaks at impact, and vanishes after recovery', () => {
    expect(paladinBastionSweepProjectionPlan(null).active).toBe(false);
    expect(paladinBastionSweepProjectionPlan(0.08).opacity).toBeGreaterThan(0);
    expect(paladinBastionSweepProjectionPlan(0.24).trail).toBeGreaterThan(0.5);
    const impact = paladinBastionSweepProjectionPlan(0.32);
    expect(impact.opacity).toBeGreaterThan(0.8);
    expect(impact.rune).toBe(1);
    expect(paladinBastionSweepProjectionPlan(0.6).opacity).toBeLessThan(0.25);
    expect(paladinBastionSweepProjectionPlan(0.72).active).toBe(false);
    expect(PALADIN_BASTION_SWEEP_PROJECTION_SCALE).toBe(2);
  });

  it('keeps the equipped shield attached and disposes only its light projection', () => {
    const model = new THREE.Group();
    const shieldHand = new THREE.Group();
    shieldHand.name = 'handslotl';
    model.add(shieldHand);
    const physicalShield = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.7, 0.12),
      new THREE.MeshBasicMaterial(),
    );
    physicalShield.name = 'equippedPhysicalShield';
    shieldHand.add(physicalShield);

    const effect = new PaladinBastionSweepFx(model);
    const projection = shieldHand.getObjectByName('paladinBastionSweepFx');
    const ownedGeometries = new Set<THREE.BufferGeometry>();
    const ownedMaterials = new Set<THREE.Material>();
    projection?.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      ownedGeometries.add(mesh.geometry);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) ownedMaterials.add(material);
    });
    const geometryDispose = [...ownedGeometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialDispose = [...ownedMaterials].map((material) => vi.spyOn(material, 'dispose'));

    effect.update(0.32, 0.32);
    expect(physicalShield.parent).toBe(shieldHand);
    expect(physicalShield.visible).toBe(true);
    expect(projection?.visible).toBe(true);

    effect.dispose();
    expect(physicalShield.parent).toBe(shieldHand);
    expect(physicalShield.visible).toBe(true);
    expect(shieldHand.getObjectByName('paladinBastionSweepFx')).toBeUndefined();
    for (const dispose of geometryDispose) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of materialDispose) expect(dispose).toHaveBeenCalledTimes(1);

    physicalShield.geometry.dispose();
    (physicalShield.material as THREE.Material).dispose();
  });
});
