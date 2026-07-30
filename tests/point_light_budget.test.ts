import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyPointLightBudget,
  pointLightPadCount,
  type RankedPointLight,
} from '../src/render/point_light_budget';

const RANGE_SQ = 100 * 100;

function rankedLight(x: number, z: number, base: number | null = 5): RankedPointLight {
  const light = new THREE.PointLight(0xffffff, base ?? 5, 10, 2);
  light.position.set(x, 0, z);
  return { light, d2: 0, worldPos: new THREE.Vector3(x, 0, z), base, dynamic: false };
}

function visibleCount(ranked: RankedPointLight[]): number {
  return ranked.filter((entry) => entry.light.visible).length;
}

describe('pointLightPadCount', () => {
  it('fills the whole budget when no real lights exist', () => {
    expect(pointLightPadCount(0, 6)).toBe(6);
  });

  it('tops up when fewer real lights than the budget exist', () => {
    expect(pointLightPadCount(4, 6)).toBe(2);
  });

  it('adds nothing once the budget is met or exceeded', () => {
    expect(pointLightPadCount(6, 6)).toBe(0);
    expect(pointLightPadCount(9, 6)).toBe(0);
  });
});

describe('applyPointLightBudget', () => {
  it('keeps exactly min(ranked, visibleCount) lights visible, pads pin the total', () => {
    for (const count of [0, 2, 6, 9]) {
      const ranked: RankedPointLight[] = [];
      for (let i = 0; i < count; i++) ranked.push(rankedLight(i * 2, 0));
      applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ);
      expect(visibleCount(ranked)).toBe(Math.min(count, 6));
      expect(visibleCount(ranked) + pointLightPadCount(ranked.length, 6)).toBe(6);
    }
  });

  it('sorts by distance so the visible set is the nearest one', () => {
    const a = rankedLight(1, 0);
    const b = rankedLight(2, 0);
    const c = rankedLight(3, 0);
    const ranked = [c, b, a];
    applyPointLightBudget(ranked, 0, 0, 2, 2, RANGE_SQ);
    expect(a.light.visible).toBe(true);
    expect(b.light.visible).toBe(true);
    expect(c.light.visible).toBe(false);
  });

  it('only lights inside the live budget and range shine', () => {
    const near = rankedLight(1, 0);
    const mid = rankedLight(5, 0);
    const far = rankedLight(500, 0);
    // Sorted input: the function skips sorting when everything fits the budget.
    const ranked = [near, mid, far];
    applyPointLightBudget(ranked, 0, 0, 6, 2, RANGE_SQ);
    expect(near.light.intensity).toBe(5);
    expect(mid.light.intensity).toBe(5);
    expect(far.light.intensity).toBe(0);
    expect(far.light.visible).toBe(true); // counted, but contributes nothing
  });

  it('leaves base-less (externally driven) light intensity alone while shining', () => {
    const driven = rankedLight(1, 0, null);
    driven.light.intensity = 7;
    applyPointLightBudget([driven], 0, 0, 6, 6, RANGE_SQ);
    expect(driven.light.intensity).toBe(7);
    const outOfRange = rankedLight(500, 0, null);
    outOfRange.light.intensity = 7;
    applyPointLightBudget([outOfRange], 0, 0, 6, 6, RANGE_SQ);
    expect(outOfRange.light.intensity).toBe(0);
  });
});
