import { describe, expect, it } from 'vitest';
import { selectionHeightTarget } from '../src/editor/placement_height_core';

describe('placement height controls', () => {
  it('allows assets to cross through ground level in both directions', () => {
    expect(selectionHeightTarget(0, -0.5, [0])).toBe(-0.5);
    expect(selectionHeightTarget(-0.5, 0.5, [-0.5])).toBe(0.5);
  });

  it('limits the whole selection by its highest and lowest members', () => {
    expect(selectionHeightTarget(0, 5, [-12, 199.5])).toBe(0.5);
    expect(selectionHeightTarget(10, 5, [-199.75, 10])).toBe(9.75);
    expect(selectionHeightTarget(0, 1, [200])).toBe(0);
  });

  it('includes the active placement in the limit even with an empty member list', () => {
    expect(selectionHeightTarget(199, 500, [])).toBe(200);
    expect(selectionHeightTarget(-199, -500, [])).toBe(-200);
  });

  it('ignores non-finite input without corrupting saved heights', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      expect(selectionHeightTarget(2, invalid, [2])).toBe(2);
      expect(selectionHeightTarget(2, 3, [invalid])).toBe(2);
    }
  });
});
