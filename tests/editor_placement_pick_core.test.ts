import { describe, expect, it } from 'vitest';
import {
  cyclePlacementPick,
  exactPlacementCandidates,
  resolvePlacementPick,
} from '../src/editor/placement_pick_core';

const hit = (index: number, distance: number, direct = true) => ({ index, distance, direct });

describe('placement pick candidates', () => {
  it('keeps front surface order, removes duplicate meshes and never promotes broad bounds', () => {
    expect(
      exactPlacementCandidates(
        [hit(2, 0.1, false), hit(3, 7), hit(1, 3), hit(1, 6), hit(0, 1)],
        (index) => index !== 0,
      ),
    ).toEqual([1, 3]);
  });

  it('breaks exact distance ties by stable document index', () => {
    expect(exactPlacementCandidates([hit(7, 3), hit(2, 3)], () => true)).toEqual([2, 7]);
  });

  it('ignores malformed distances and applies the chooser limit after deduplication', () => {
    expect(
      exactPlacementCandidates(
        [hit(0, NaN), hit(1, -1), hit(2, Infinity), hit(3, 1), hit(3, 2), hit(4, 3), hit(5, 4)],
        () => true,
        2,
      ),
    ).toEqual([3, 4]);
  });

  it.each([NaN, Infinity, -1])(
    'rejects a single malformed distance %s without a limit masking it',
    (distance) => {
      expect(exactPlacementCandidates([hit(0, distance)], () => true)).toEqual([]);
    },
  );

  it('retains an explicit back-piece choice for dragging but clears it outside that point', () => {
    const choice = { index: 4, x: 100, y: 100 };
    expect(resolvePlacementPick([3, 4], choice, 108, 105)).toBe(4);
    expect(resolvePlacementPick([3, 4], choice, 116, 100)).toBe(4);
    expect(resolvePlacementPick([3, 4], choice, 116.001, 100)).toBe(3);
    expect(resolvePlacementPick([3, 4], choice, 130, 100)).toBe(3);
    expect(resolvePlacementPick([3], choice, 100, 100)).toBe(3);
    expect(resolvePlacementPick([], choice, 100, 100)).toBeNull();
  });
  it('cycles only stable candidates at a stationary release, resets at new spots and wraps', () => {
    const first = cyclePlacementPick([8, 2, 5], null, 10, 10);
    expect(first?.index).toBe(8);
    const second = cyclePlacementPick([8, 2, 5], first, 11, 10);
    expect(second?.index).toBe(2);
    const third = cyclePlacementPick([8, 2, 5], second, 11, 10);
    expect(third?.index).toBe(5);
    expect(cyclePlacementPick([8, 2, 5], third, 11, 10)?.index).toBe(8);
    expect(cyclePlacementPick([8, 5], second, 11, 10)?.index).toBe(8);
    expect(cyclePlacementPick([8, 2, 5], second, 18, 10)?.index).toBe(8);
    expect(cyclePlacementPick([], third, 11, 10)).toBeNull();
  });
});
