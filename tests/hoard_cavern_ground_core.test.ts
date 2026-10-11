import { describe, expect, it } from 'vitest';
import {
  buildHoardCavernGroundPlan,
  hoardCavernGroundSample,
} from '../src/render/hoard_cavern_ground_core';
import {
  type HoardValleyLayoutInput,
  HOARD_VALLEY_ZONE_PROFILES as zones,
} from '../src/render/hoard_valley_core';

const layout: HoardValleyLayoutInput = {
  zMin: 0,
  zMax: 100,
  dais: { x: 0, z: 90, r: 5 },
  shellPolygon: [
    { x: -5, z: 0 },
    { x: 5, z: 0 },
    { x: 5, z: 20 },
    { x: 25, z: 40 },
    { x: 25, z: 100 },
    { x: -25, z: 100 },
    { x: -25, z: 40 },
    { x: -5, z: 20 },
  ],
};

describe('cavern mineral ground', () => {
  it('has no color seams at old strip edges and preserves snow versus ash identity', () => {
    for (let z = 2.5; z < 100; z += 2.5) {
      const a = hoardCavernGroundSample(layout, zones.amberfall, 42, 0, z - 0.0001).color;
      const b = hoardCavernGroundSample(layout, zones.amberfall, 42, 0, z + 0.0001).color;
      expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeLessThan(0.001);
    }
    const snow = hoardCavernGroundSample(layout, zones.frostveil, 42, 0, 60).color;
    const ash = hoardCavernGroundSample(layout, zones.drakelands, 42, 0, 60).color;
    expect(snow.reduce((a, b) => a + b)).toBeGreaterThan(ash.reduce((a, b) => a + b) * 2);
  });
  it('welds the surface into a flat, upward facing mesh preserving gorge corners', () => {
    const plan = buildHoardCavernGroundPlan(layout, zones.amberfall, 42);
    expect(plan).toEqual(buildHoardCavernGroundPlan(layout, zones.amberfall, 42));
    const vertices = new Set<string>();
    for (let i = 0; i < plan.positions.length; i += 3) {
      expect(plan.positions[i + 1]).toBe(0.04);
      const key = `${plan.positions[i]},${plan.positions[i + 2]}`;
      expect(vertices.has(key)).toBe(false);
      vertices.add(key);
    }
    expect(vertices.has('5,20')).toBe(true);
    expect(vertices.has('25,40')).toBe(true);
    for (let i = 0; i < plan.indices.length; i += 3) {
      const [a, b, c] = plan.indices.slice(i, i + 3).map((v) => v * 3);
      const normalY =
        (plan.positions[b + 2] - plan.positions[a + 2]) * (plan.positions[c] - plan.positions[a]) -
        (plan.positions[b] - plan.positions[a]) * (plan.positions[c + 2] - plan.positions[a + 2]);
      expect(normalY).toBeGreaterThan(0);
    }
  });

  it('keeps the covered entry mineral and grows irregular biome patches in the basin', () => {
    for (const zone of Object.values(zones)) {
      expect(hoardCavernGroundSample(layout, zone, 42, 0, 3).growth).toBe(0);
      expect(hoardCavernGroundSample(layout, zone, 42, 25, 60).growth).toBe(0);
      const samples = [-15, -7, 0, 7, 15].map((x) =>
        hoardCavernGroundSample(layout, zone, 42, x, 60),
      );
      expect(Math.max(...samples.map((s) => s.growth))).toBeGreaterThan(0.3);
      expect(new Set(samples.map((s) => s.color.join(','))).size).toBe(5);
      const a = hoardCavernGroundSample(layout, zone, 42, 4, 60).color;
      const b = hoardCavernGroundSample(layout, zone, 42, 4.001, 60.001).color;
      expect(Math.max(...a.map((v, i) => Math.abs(v - b[i])))).toBeLessThan(0.001);
    }
  });
});
