import { describe, expect, it } from 'vitest';
import { hoardCavernHeroSpots } from '../src/render/hoard_cavern_foliage_core';
import { buildHoardValleyPlan, HOARD_VALLEY_ZONE_IDS } from '../src/render/hoard_valley_core';

describe('cavern hero tree placement', () => {
  it('preserves hero landmarks across static presets in every biome', () => {
    for (const zoneId of HOARD_VALLEY_ZONE_IDS) {
      const input = {
        zoneId,
        seed: 1729,
        layout: { zMin: 0, zMax: 140, floorHalfX: 34, dais: { x: 0, z: 125, r: 12 } },
      };
      const high = hoardCavernHeroSpots(buildHoardValleyPlan({ ...input, low: false }), 3);
      const low = hoardCavernHeroSpots(buildHoardValleyPlan({ ...input, low: true }), 3);
      expect(high).toEqual(low);
      expect(high.length).toBeGreaterThan(0);
      expect(high.length).toBeLessThanOrEqual(6);
    }
  });
});
