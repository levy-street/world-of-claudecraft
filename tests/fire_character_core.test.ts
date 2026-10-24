import { describe, expect, it } from 'vitest';
import {
  FIRE_CHARACTERS,
  fireBlackbodyLinearRgb,
  fireCharacterFor,
  HEARTH_FIRE,
} from '../src/render/fire/fire_character_core';
import type { BiomeId } from '../src/sim/types';

describe('fire character presets', () => {
  it('defines positive physical parameters for every realm biome', () => {
    const biomes = Object.keys(FIRE_CHARACTERS) as BiomeId[];
    expect(biomes.length).toBeGreaterThanOrEqual(15);
    for (const biome of biomes) {
      const ch = fireCharacterFor(biome);
      expect(ch).toBe(FIRE_CHARACTERS[biome]);
      expect(ch.smokeDensity).toBeGreaterThan(0);
      expect(ch.smokeDensity).toBeLessThan(0.5);
      expect(ch.swirl).toBeGreaterThan(0.5);
      expect(ch.draft).toBeGreaterThan(0.5);
    }
    expect(fireCharacterFor('unknown' as BiomeId)).toBe(HEARTH_FIRE);
  });

  it('produces monotonic blackbody radiance from crimson tips to white-hot core', () => {
    const cold = fireBlackbodyLinearRgb(0, HEARTH_FIRE);
    const tip = fireBlackbodyLinearRgb(0.28, HEARTH_FIRE);
    const body = fireBlackbodyLinearRgb(0.68, HEARTH_FIRE);
    const core = fireBlackbodyLinearRgb(1.25, HEARTH_FIRE);

    expect(cold).toEqual([0, 0, 0]);
    const luma = (rgb: [number, number, number]) =>
      0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    expect(luma(tip)).toBeGreaterThan(0);
    expect(luma(body)).toBeGreaterThan(luma(tip));
    expect(luma(core)).toBeGreaterThan(luma(body));
    // Hot core exceeds the 1.32 HDR bloom threshold so campfires glow naturally.
    expect(luma(core)).toBeGreaterThan(1.32);
    // Crimson tips are red-dominant; white-hot core raises blue and green channels.
    expect(tip[0]).toBeGreaterThan(tip[1] * 2);
    expect(core[2]).toBeGreaterThan(tip[2] * 5);
  });
});
