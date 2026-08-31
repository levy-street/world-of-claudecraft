import { describe, expect, it } from 'vitest';

import { deathGroundingOffset } from '../src/render/characters/death_grounding_core';

describe('character death grounding', () => {
  it('leaves living and early death poses at their authored height', () => {
    expect(deathGroundingOffset(false, 3.9, 3.9, 0.565)).toBe(0);
    expect(deathGroundingOffset(true, 0, 3.9, 0.565)).toBe(0);
    expect(deathGroundingOffset(true, 3.9 * 0.75, 3.9, 0.565)).toBe(0);
  });

  it('settles the model smoothly during the final quarter of the death clip', () => {
    expect(deathGroundingOffset(true, 3.9 * 0.875, 3.9, 0.565)).toBeCloseTo(0.2825, 6);
    expect(deathGroundingOffset(true, 3.9, 3.9, 0.565)).toBeCloseTo(0.565, 6);
    expect(deathGroundingOffset(true, 99, 3.9, 0.565)).toBeCloseTo(0.565, 6);
  });

  it('fails closed for clips or offsets that cannot produce a useful correction', () => {
    expect(deathGroundingOffset(true, 1, 0, 0.565)).toBe(0);
    expect(deathGroundingOffset(true, 1, 3.9, 0)).toBe(0);
    expect(deathGroundingOffset(true, 1, 3.9, -1)).toBe(0);
  });
});
