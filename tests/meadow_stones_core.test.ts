import { describe, expect, it } from 'vitest';
import {
  generateMeadowStones,
  MEADOW_STONE_VARIANTS,
  MEADOW_STONE_ZONES,
} from '../src/render/meadow_stones_core';
import { zoneAt } from '../src/sim/data';
import { roadDistance, terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;

describe('meadow stones (cosmetic painterly scatter)', () => {
  const stones = generateMeadowStones(SEED);

  it('scatters a field of stones in Eastbrook Vale', () => {
    expect(stones.length).toBeGreaterThan(40);
  });

  it('places every stone inside a meadow-stone zone, off roads and above water', () => {
    for (const s of stones) {
      expect(MEADOW_STONE_ZONES.has(zoneAt(s.x, s.z).id)).toBe(true);
      expect(roadDistance(s.x, s.z)).toBeGreaterThanOrEqual(4.5);
      expect(terrainHeight(s.x, s.z, SEED)).toBeGreaterThanOrEqual(WATER_LEVEL + 1.2);
    }
  });

  it('is deterministic from the seed and keeps sizes and variants in range', () => {
    expect(generateMeadowStones(SEED)).toEqual(stones);
    for (const s of stones) {
      expect(s.variant).toBeGreaterThanOrEqual(0);
      expect(s.variant).toBeLessThan(MEADOW_STONE_VARIANTS);
      expect(s.scale).toBeGreaterThan(0.5);
      expect(s.scale).toBeLessThan(1.5);
    }
  });
});
