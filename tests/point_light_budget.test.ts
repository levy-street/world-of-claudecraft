import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyPointLightBudget,
  flickerContributingFireLights,
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

  it('keeps the prior full-rank order when discarded-tail lights later tie', () => {
    const a = rankedLight(4, 0);
    const b = rankedLight(1, 0);
    const c = rankedLight(3, 0);
    const d = rankedLight(2, 0);
    const ranked = [a, b, c, d];

    applyPointLightBudget(ranked, 0, 0, 2, 2, RANGE_SQ);
    expect(ranked.map((entry) => entry.light)).toEqual([b.light, d.light, c.light, a.light]);

    c.worldPos.set(1, 0, 0);
    a.worldPos.set(-1, 0, 0);
    b.worldPos.set(10, 0, 0);
    d.worldPos.set(11, 0, 0);
    applyPointLightBudget(ranked, 0, 0, 2, 1, RANGE_SQ);

    expect(ranked.slice(0, 2).map((entry) => entry.light)).toEqual([c.light, a.light]);
    expect(c.light.intensity).toBe(5);
    expect(a.light.intensity).toBe(0);
  });

  it('only lights inside the live budget and range shine', () => {
    const near = rankedLight(1, 0);
    const mid = rankedLight(5, 0);
    const far = rankedLight(500, 0);
    // Already sorted by distance, so this stays green regardless of the sort guard.
    const ranked = [near, mid, far];
    applyPointLightBudget(ranked, 0, 0, 6, 2, RANGE_SQ);
    expect(near.light.intensity).toBe(5);
    expect(mid.light.intensity).toBe(5);
    expect(far.light.intensity).toBe(0);
    expect(far.light.visible).toBe(true); // counted, but contributes nothing
  });

  it('sorts by distance when the live budget truncates fewer lights than visibleCount', () => {
    // liveBudget(2) < ranked.length(3) <= visibleCount(6): a sort guard keyed off
    // visibleCount alone would skip sorting here even though the live budget still
    // truncates the ranked list, so array order (not distance) would pick the
    // winners. All three lights sit inside range so only the live-budget cutoff
    // is under test.
    const near = rankedLight(1, 0);
    const mid = rankedLight(5, 0);
    const farInRange = rankedLight(50, 0);
    const ranked = [farInRange, near, mid]; // misordered: farthest listed first
    applyPointLightBudget(ranked, 0, 0, 6, 2, RANGE_SQ);
    expect(near.light.intensity).toBe(5);
    expect(mid.light.intensity).toBe(5);
    expect(farInRange.light.intensity).toBe(0);
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

  it('flickers only fire lights that survive the live budget and range', () => {
    const near = rankedLight(1, 0, null);
    const overBudget = rankedLight(2, 0, null);
    const uncounted = rankedLight(3, 0, null);
    near.fireIndex = 4;
    overBudget.fireIndex = 5;
    uncounted.fireIndex = 6;
    near.light.userData.baseIntensity = 8;
    overBudget.light.intensity = 91;
    uncounted.light.intensity = 92;
    const ranked = [uncounted, overBudget, near];

    applyPointLightBudget(ranked, 0, 0, 2, 1, RANGE_SQ);
    flickerContributingFireLights(ranked, 0.75, 2, 1, RANGE_SQ);

    expect(near.light.intensity).toBe(8 + Math.sin(0.75 * 11 + 4 * 1.7) * 2.5 * (8 / 11));
    expect(overBudget.light.intensity).toBe(0);
    expect(uncounted.light.intensity).toBe(92);
  });

  it('does not flicker view lights or counted fire lights outside range', () => {
    const fire = rankedLight(1, 0, null);
    const view = rankedLight(2, 0, null);
    const outOfRange = rankedLight(500, 0, null);
    fire.fireIndex = 2;
    outOfRange.fireIndex = 3;
    view.light.intensity = 77;
    outOfRange.light.intensity = 78;
    const ranked = [fire, view, outOfRange];

    applyPointLightBudget(ranked, 0, 0, 6, 6, RANGE_SQ);
    flickerContributingFireLights(ranked, 0.5, 6, 6, RANGE_SQ);

    expect(fire.light.intensity).toBe(11 + Math.sin(0.5 * 11 + 2 * 1.7) * 2.5);
    expect(view.light.intensity).toBe(77);
    expect(outOfRange.light.intensity).toBe(0);
  });

  it('wires contributor flicker after the renderer completes selection', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const methodStart = source.indexOf('private budgetFireLights(');
    const methodEnd = source.indexOf('// light shafts fade', methodStart);
    const method = source.slice(methodStart, methodEnd);
    const selection = method.indexOf('applyPointLightBudget(');
    const flickerGate = method.indexOf('if (flicker) {');
    const flickerCall = method.indexOf('flickerContributingFireLights(');

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(selection).toBeGreaterThan(-1);
    expect(flickerGate).toBeGreaterThan(selection);
    expect(flickerCall).toBeGreaterThan(flickerGate);
    expect(source).toContain('this.budgetFireLights(p.pos.x, p.pos.z, true);');
  });
});
