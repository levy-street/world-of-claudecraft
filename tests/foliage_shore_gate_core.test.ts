// The foliage passes' water-gated shore skip (src/render/foliage_shore_gate_core.ts):
// underwater anchors always skip, band-height anchors skip only near real
// water. The repro that motivated it is the Wolf Run basin (owner refinement
// round 4): dry vale ground at h about -3.05 sat inside the height-only beach
// band and lost its grass and flowers along with its green paint.
import { describe, expect, it } from 'vitest';
import { foliageShoreSkip } from '../src/render/foliage_shore_gate_core';
import { SHORE_BAND_HEIGHT } from '../src/render/shore_water_gate_core';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

describe('foliageShoreSkip', () => {
  it('always skips underwater anchors, never dry ground above the band', () => {
    expect(foliageShoreSkip(0, 0, WATER_LEVEL - 0.5, WORLD_SEED)).toBe(true);
    expect(foliageShoreSkip(0, 0, WATER_LEVEL + SHORE_BAND_HEIGHT, WORLD_SEED)).toBe(false);
    expect(foliageShoreSkip(0, 0, WATER_LEVEL + 5, WORLD_SEED)).toBe(false);
  });

  it('lets the Wolf Run basin grow: in-band height, but no water nearby', () => {
    for (const [x, z] of [
      [0, -16],
      [16, -8],
      [24, 0],
    ] as const) {
      const h = terrainHeight(x, z, WORLD_SEED);
      expect(h, `(${x},${z}) should sit inside the beach band`).toBeGreaterThan(WATER_LEVEL);
      expect(h).toBeLessThan(WATER_LEVEL + SHORE_BAND_HEIGHT);
      expect(foliageShoreSkip(x, z, h, WORLD_SEED)).toBe(false);
    }
  });

  it("keeps the town's south strand and the cove rim bare", () => {
    for (const [x, z] of [
      [-14, -136],
      [-99, -37],
    ] as const) {
      const h = terrainHeight(x, z, WORLD_SEED);
      expect(h, `(${x},${z}) should sit inside the beach band`).toBeGreaterThan(WATER_LEVEL);
      expect(h).toBeLessThan(WATER_LEVEL + SHORE_BAND_HEIGHT);
      expect(foliageShoreSkip(x, z, h, WORLD_SEED)).toBe(true);
    }
  });
});
