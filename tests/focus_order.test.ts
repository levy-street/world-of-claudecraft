import { describe, expect, it } from 'vitest';
import { nextFocusIndex } from '../src/ui/focus_order';

// The DOM-free boundary math behind the shared focus manager's Tab trap. The
// manager re-queries the live focusable set on every Tab and calls this to pick the
// next index; wraparound at both ends is what makes it a trap.
describe('nextFocusIndex (focus trap boundary math)', () => {
  it('steps forward within the set', () => {
    expect(nextFocusIndex(5, 0, false)).toBe(1);
    expect(nextFocusIndex(5, 2, false)).toBe(3);
  });

  it('steps backward within the set', () => {
    expect(nextFocusIndex(5, 3, true)).toBe(2);
    expect(nextFocusIndex(5, 1, true)).toBe(0);
  });

  it('wraps forward off the last element to the first (the trap floor)', () => {
    expect(nextFocusIndex(5, 4, false)).toBe(0);
    expect(nextFocusIndex(1, 0, false)).toBe(0);
  });

  it('wraps backward off the first element to the last (the trap ceiling)', () => {
    expect(nextFocusIndex(5, 0, true)).toBe(4);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });

  it('enters at an end when focus is not on any member (currentIndex < 0)', () => {
    expect(nextFocusIndex(5, -1, false)).toBe(0);
    expect(nextFocusIndex(5, -1, true)).toBe(4);
  });

  it('reports nothing focusable when the set is empty', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 3, true)).toBe(-1);
  });

  it('is deterministic: same input -> same output', () => {
    for (let i = 0; i < 6; i++) {
      expect(nextFocusIndex(6, i, false)).toBe(nextFocusIndex(6, i, false));
      expect(nextFocusIndex(6, i, true)).toBe(nextFocusIndex(6, i, true));
    }
  });
});
