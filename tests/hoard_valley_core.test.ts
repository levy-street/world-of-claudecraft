import { describe, expect, it } from 'vitest';
import {
  buildHoardValleyPlan,
  HOARD_VALLEY_ZONE_IDS,
  type HoardValleyLayoutInput,
  hoardValleyProfile,
  hoardValleyRevealZ,
  hoardValleySpanAtZ,
  hoardValleySurfaceTint,
} from '../src/render/hoard_valley_core';
import { VAULT_ZONE_IDS } from '../src/sim/rift/vault_seed';

const layout: HoardValleyLayoutInput = {
  zMin: -19,
  zMax: 145,
  wallX: 35,
  floorHalfX: 34,
  shellPolygon: [
    { x: 9, z: -19 },
    { x: 9, z: 10 },
    { x: 17, z: 28 },
    { x: 30, z: 50 },
    { x: 34, z: 145 },
    { x: -34, z: 145 },
    { x: -30, z: 50 },
    { x: -17, z: 28 },
    { x: -9, z: 10 },
    { x: -9, z: -19 },
  ],
  dais: { x: 0, z: 126, r: 13 },
};

describe('hoard valley visual plan', () => {
  it('keeps authored surfaces readable while cooling them at midnight', () => {
    expect(hoardValleySurfaceTint({ fog: [1, 1, 1], nightAmt: 0 })).toEqual([1, 1, 1]);
    const midnight = hoardValleySurfaceTint({ fog: [0.14, 0.2, 0.32], nightAmt: 1 });
    expect(midnight[0]).toBeGreaterThanOrEqual(0.75);
    expect(midnight[1]).toBeGreaterThanOrEqual(0.82);
    expect(midnight[2]).toBeGreaterThanOrEqual(0.93);
    expect(midnight[2]).toBeGreaterThan(midnight[0]);
  });

  it('owns a distinct ground, fog and dressing identity for every dig-site zone', () => {
    expect([...HOARD_VALLEY_ZONE_IDS].sort()).toEqual([...VAULT_ZONE_IDS].sort());
    expect(HOARD_VALLEY_ZONE_IDS).toHaveLength(8);
    expect(new Set(HOARD_VALLEY_ZONE_IDS.map((id) => hoardValleyProfile(id).biome)).size).toBe(8);
    expect(new Set(HOARD_VALLEY_ZONE_IDS.map((id) => hoardValleyProfile(id).ground)).size).toBe(8);
    expect(new Set(HOARD_VALLEY_ZONE_IDS.map((id) => hoardValleyProfile(id).dressing)).size).toBe(
      8,
    );
    for (const id of HOARD_VALLEY_ZONE_IDS) {
      const profile = hoardValleyProfile(id);
      expect(profile.fogNear).toBeGreaterThan(60);
      expect(profile.fogFar).toBeGreaterThan(profile.fogNear + 100);
    }
  });

  it('finds the gorge and its broad reveal from the authored shell', () => {
    const gorge = hoardValleySpanAtZ(layout, 0);
    const basin = hoardValleySpanAtZ(layout, 100);
    expect(gorge.maxX - gorge.minX).toBe(18);
    expect(basin.maxX - basin.minX).toBeGreaterThan(60);
    expect(hoardValleyRevealZ(layout)).toBeGreaterThan(28);
    expect(hoardValleyRevealZ(layout)).toBeLessThan(58);
  });

  it('is deterministic and keeps the fight lane and boss dais clear', () => {
    const first = buildHoardValleyPlan({
      layout,
      zoneId: 'amberfall',
      seed: 0x87654321,
      low: false,
    });
    const second = buildHoardValleyPlan({
      layout,
      zoneId: 'amberfall',
      seed: 0x87654321,
      low: false,
    });
    expect(second).toEqual(first);
    expect(first.dressing.length).toBeGreaterThan(20);
    for (const prop of first.dressing) {
      expect(Math.abs(prop.x)).toBeGreaterThan(first.centerClearHalfWidth);
      expect(Math.hypot(prop.x - layout.dais.x, prop.z - layout.dais.z)).toBeGreaterThanOrEqual(
        layout.dais.r + 7,
      );
    }
  });

  it('keeps ground and two-row boundary cover on low while shedding dressing', () => {
    const high = buildHoardValleyPlan({
      layout,
      zoneId: 'frostveil',
      seed: 77,
      low: false,
    });
    const low = buildHoardValleyPlan({
      layout,
      zoneId: 'frostveil',
      seed: 77,
      low: true,
    });
    expect(low.ground).toEqual(high.ground);
    expect(low.cliffs).toEqual(high.cliffs);
    expect(low.cliffs.length).toBeGreaterThan(150);
    expect(low.dressing.length).toBeLessThan(high.dressing.length);
    expect(low.dressing.length).toBeGreaterThan(0);
    expect(low.cliffs.some((rock) => rock.revealShoulder)).toBe(true);
  });
});
