import { describe, expect, it } from 'vitest';
import { capRoom, clampToCap } from '../src/editor/edit_caps_core';

describe('capRoom', () => {
  it('reports the remaining room under the cap', () => {
    expect(capRoom(0, 10)).toBe(10);
    expect(capRoom(7, 10)).toBe(3);
    expect(capRoom(10, 10)).toBe(0);
  });

  it('never goes negative when the store is already over the cap', () => {
    expect(capRoom(15, 10)).toBe(0);
  });
});

describe('clampToCap', () => {
  it('passes a fitting batch through untouched (same reference, no copy)', () => {
    const items = [1, 2, 3];
    const r = clampToCap(items, 0, 10);
    expect(r.accepted).toBe(items);
    expect(r.truncated).toBe(false);
  });

  it('accepts an exact fit without truncation', () => {
    const r = clampToCap([1, 2, 3], 7, 10);
    expect(r.accepted).toEqual([1, 2, 3]);
    expect(r.truncated).toBe(false);
  });

  it('REGRESSION: an overflowing batch is clamped, never silently stored', () => {
    // Audit G: pasteAt / runHills / appendPlacements pushed unbounded and the
    // sanitizer truncated on the NEXT load, silently changing the saved map.
    const r = clampToCap([1, 2, 3, 4, 5], 8, 10);
    expect(r.accepted).toEqual([1, 2]);
    expect(r.truncated).toBe(true);
  });

  it('returns an empty batch at (or past) the cap', () => {
    expect(clampToCap([1, 2], 10, 10)).toEqual({ accepted: [], truncated: true });
    expect(clampToCap([1], 12, 10)).toEqual({ accepted: [], truncated: true });
  });

  it('an empty input is never truncated', () => {
    expect(clampToCap([], 10, 10).truncated).toBe(false);
  });
});
