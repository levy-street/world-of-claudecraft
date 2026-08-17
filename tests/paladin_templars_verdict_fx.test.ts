import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  PaladinTemplarsVerdictFx,
  paladinTemplarsVerdictFxPlan,
} from '../src/render/characters/paladin_templars_verdict_fx';

function weaponRig(): { model: THREE.Group; weapon: THREE.Mesh } {
  const model = new THREE.Group();
  const holder = new THREE.Group();
  holder.userData.swapWeaponHolder = true;
  holder.userData.heldSlot = 0;
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 0.18));
  weapon.userData.weaponMesh = true;
  holder.add(weapon);
  model.add(holder);
  return { model, weapon };
}

describe('Paladin Templar Verdict weapon effect', () => {
  it('charges, trails through release, flashes on impact, and fades during recovery', () => {
    expect(paladinTemplarsVerdictFxPlan(null)).toEqual({
      active: false,
      edge: 0,
      orbit: 0,
      trail: 0,
      impact: 0,
    });

    const charge = paladinTemplarsVerdictFxPlan(0.18);
    expect(charge.edge).toBeGreaterThan(0.55);
    expect(charge.orbit).toBeGreaterThan(0.45);
    expect(charge.trail).toBe(0);

    const release = paladinTemplarsVerdictFxPlan(0.31);
    expect(release.edge).toBeGreaterThan(0.8);
    expect(release.trail).toBeGreaterThan(0.55);

    const impact = paladinTemplarsVerdictFxPlan(0.4);
    expect(impact.impact).toBe(1);
    expect(impact.edge).toBeGreaterThan(0.8);

    const recovery = paladinTemplarsVerdictFxPlan(0.7);
    expect(recovery.active).toBe(true);
    expect(recovery.edge).toBeLessThan(0.4);
    expect(recovery.impact).toBe(0);
    expect(paladinTemplarsVerdictFxPlan(0.8).active).toBe(false);
  });

  it('builds a golden overlay without changing the weapon mesh or geometry', () => {
    const { model, weapon } = weaponRig();
    const geometry = weapon.geometry;
    const material = weapon.material;
    const fx = new PaladinTemplarsVerdictFx(model);

    fx.update(0.31, 0.016);
    expect(weapon.geometry).toBe(geometry);
    expect(weapon.material).toBe(material);
    expect(model.getObjectByName('paladinTemplarsVerdictFx')).toBeDefined();
    expect(
      model.getObjectByName('paladinTemplarsVerdictFx')?.children.some((child) => child.visible),
    ).toBe(true);

    fx.update(null, 0.016);
    expect(
      model.getObjectByName('paladinTemplarsVerdictFx')?.children.every((child) => !child.visible),
    ).toBe(true);
    fx.dispose();
    expect(model.getObjectByName('paladinTemplarsVerdictFx')).toBeUndefined();
  });
});
