import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { warlockPetScaleAtLevel } from '../src/sim/pet/warlock_pet_growth';

describe('warlockPetScaleAtLevel', () => {
  it.each([
    [1, 0.55],
    [7, 0.55],
    [8, 0.65],
    [13, 0.65],
    [14, 0.75],
    [19, 0.75],
    [20, 0.85],
  ])('uses the authored Emberkin scale at owner level %i', (level, scale) => {
    expect(warlockPetScaleAtLevel(MOBS.emberkin, level)).toBe(scale);
  });

  it('leaves pets without authored growth at their base scale', () => {
    expect(warlockPetScaleAtLevel(MOBS.gloomshade, 20)).toBe(MOBS.gloomshade.scale);
  });
});
