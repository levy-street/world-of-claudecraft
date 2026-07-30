import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyPointLightBudget,
  type RankedPointLight,
  reconcileViewPointLights,
} from '../src/render/point_light_budget';

function rank(light: THREE.PointLight, x: number, dynamic = false): RankedPointLight {
  light.position.set(x, 0, 0);
  return {
    light,
    d2: 0,
    worldPos: light.position.clone(),
    base: dynamic ? null : light.intensity,
    dynamic,
  };
}

describe('weapon-skin point-light budgeting', () => {
  it('reconciles lights created and removed by a live weapon-skin swap', () => {
    const all: THREE.PointLight[] = [];
    const group = new THREE.Group();
    const first = new THREE.PointLight(0xffffff, 4);
    first.userData.budgetDynamic = true;
    group.add(first);

    const added = reconcileViewPointLights(group, [], all);
    expect(added.changed).toBe(true);
    expect(added.lights).toEqual([first]);
    expect(all).toEqual([first]);

    group.remove(first);
    const second = new THREE.PointLight(0xffffff, 7);
    second.userData.budgetDynamic = true;
    group.add(second);
    const replaced = reconcileViewPointLights(group, added.lights, all);
    expect(replaced.changed).toBe(true);
    expect(replaced.lights).toEqual([second]);
    expect(all).toEqual([second]);

    group.remove(second);
    const removed = reconcileViewPointLights(group, replaced.lights, all);
    expect(removed.changed).toBe(true);
    expect(removed.lights).toEqual([]);
    expect(all).toEqual([]);
  });

  it('keeps the visible light count fixed when a moving weapon light joins the pool', () => {
    const fixed = Array.from({ length: 6 }, (_, index) =>
      rank(new THREE.PointLight(0xffffff, 2), index),
    );
    applyPointLightBudget(fixed, 0, 0, 6, 6, 55 * 55);
    expect(fixed.filter((entry) => entry.light.visible)).toHaveLength(6);

    const weapon = new THREE.PointLight(0x00ffff, 9);
    const withWeapon = [...fixed, rank(weapon, 0.5, true)];
    applyPointLightBudget(withWeapon, 0, 0, 6, 6, 55 * 55);

    expect(withWeapon.filter((entry) => entry.light.visible)).toHaveLength(6);
    expect(weapon.visible).toBe(true);
    expect(weapon.intensity).toBe(9);
  });

  it('refreshes a moving weapon light position before ranking it', () => {
    const weapon = new THREE.PointLight(0xffffff, 5);
    weapon.userData.budgetDynamic = true;
    const entry = rank(weapon, 100, true);
    weapon.position.set(1, 0, 0);

    applyPointLightBudget([entry], 0, 0, 1, 1, 55 * 55);

    expect(entry.worldPos.x).toBe(1);
    expect(entry.light.intensity).toBe(5);
  });
});
