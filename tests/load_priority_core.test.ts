import { describe, expect, it } from 'vitest';
import { minimumLoadPriority, nextPendingIndex } from '../src/render/assets/load_priority_core';

describe('asset load priority edge cases', () => {
  it('has no candidate for an empty queue and keeps a lone request eligible', () => {
    expect(nextPendingIndex([])).toBe(-1);
    expect(nextPendingIndex([{ priority: () => Infinity }])).toBe(0);
  });

  it('keeps unprioritized requests at zero and ties in arrival order', () => {
    expect(nextPendingIndex([{ priority: () => 5 }, {}, {}])).toBe(1);
    expect(nextPendingIndex([{}, { priority: () => 0 }])).toBe(0);
  });

  it('does not let unavailable distances starve a finite-distance request', () => {
    expect(nextPendingIndex([{ priority: () => NaN }, { priority: () => 2 }])).toBe(1);
    expect(minimumLoadPriority([() => NaN, () => Infinity, () => 2])).toBe(2);
    expect(minimumLoadPriority([])).toBe(Infinity);
  });
});
