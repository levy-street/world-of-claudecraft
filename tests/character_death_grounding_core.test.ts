import { describe, expect, it } from 'vitest';

import {
  deathGroundingOffset,
  deathLiftOffset,
} from '../src/render/characters/death_grounding_core';

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

describe('character death lift (a body sunk into the floor in life)', () => {
  it('raises nothing while alive, before its window, or for a bad clip or lift', () => {
    expect(deathLiftOffset(false, 2, 2.5, 1.3, 0.1, 0.55)).toBe(0);
    expect(deathLiftOffset(true, 0.2, 2.5, 1.3, 0.1, 0.55)).toBe(0);
    expect(deathLiftOffset(true, 1, 0, 1.3, 0.1, 0.55)).toBe(0);
    expect(deathLiftOffset(true, 1, 2.5, 0, 0.1, 0.55)).toBe(0);
    expect(deathLiftOffset(true, 1, 2.5, -1, 0.1, 0.55)).toBe(0);
    expect(deathLiftOffset(true, 1, 2.5, 1.3, 0.55, 0.1)).toBe(0);
  });

  it('eases the lift in across its window and holds it after', () => {
    const mid = deathLiftOffset(true, 2.5 * 0.325, 2.5, 1.3, 0.1, 0.55);
    expect(mid).toBeCloseTo(0.65, 6);
    expect(deathLiftOffset(true, 2.5 * 0.55, 2.5, 1.3, 0.1, 0.55)).toBeCloseTo(1.3, 9);
    expect(deathLiftOffset(true, 99, 2.5, 1.3, 0.1, 0.55)).toBeCloseTo(1.3, 9);
  });
});
