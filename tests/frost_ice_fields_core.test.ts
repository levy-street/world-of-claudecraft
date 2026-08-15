import { describe, expect, it } from 'vitest';
import { planFrostIceSpireSites } from '../src/render/frost_ice_fields_core';

describe('Frostveil modeled ice-spire placement', () => {
  it('keeps the five authored fields and all 43 deterministic candidates', () => {
    const sites = planFrostIceSpireSites(() => 2);
    expect(sites).toHaveLength(43);
    expect(sites).toEqual(planFrostIceSpireSites(() => 2));
    expect(new Set(sites.map((site) => site.fieldIndex))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(sites.map((site) => site.variant))).toEqual(new Set([0, 1, 2]));
  });

  it('rejects water while preserving floor seating and bounded transforms', () => {
    const sites = planFrostIceSpireSites((x) => (x > 0 ? -4 : 3.25));
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThan(43);
    for (const site of sites) {
      expect(site.y).toBe(3.25);
      expect(site.scale).toBeGreaterThanOrEqual(0.75);
      expect(site.scale).toBeLessThanOrEqual(2.15);
      expect(Math.abs(site.tilt)).toBeLessThanOrEqual(0.25);
    }
  });

  it('returns an empty plan when every candidate is underwater', () => {
    expect(planFrostIceSpireSites(() => -8)).toEqual([]);
  });
});
