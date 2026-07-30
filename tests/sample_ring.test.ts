import { describe, expect, it } from 'vitest';
import { NumberSampleRing, TimedNumberSampleRing } from '../src/game/sample_ring';

describe('NumberSampleRing', () => {
  it('keeps insertion order until full and overwrites only the oldest values', () => {
    const ring = new NumberSampleRing(3);
    ring.push(1);
    ring.push(2);
    expect(ring.toArray()).toEqual([1, 2]);

    ring.push(3);
    ring.push(4);
    ring.push(5);
    expect(ring.length).toBe(3);
    expect(ring.toArray()).toEqual([3, 4, 5]);
  });

  it('clears without reallocating its public capacity', () => {
    const ring = new NumberSampleRing(2);
    ring.push(7);
    ring.clear();
    ring.push(9);
    expect(ring.capacity).toBe(2);
    expect(ring.toArray()).toEqual([9]);
  });

  it('rejects invalid capacities', () => {
    expect(() => new NumberSampleRing(0)).toThrow(RangeError);
    expect(() => new NumberSampleRing(1.5)).toThrow(RangeError);
  });
});

describe('TimedNumberSampleRing', () => {
  it('prunes expired samples in O(1) cursor steps and preserves the live window', () => {
    const ring = new TimedNumberSampleRing(4);
    ring.push(10, 1);
    ring.push(20, 2);
    ring.push(30, 3);
    ring.pruneBefore(20);

    expect(ring.snapshotSince(0)).toEqual({ values: [2, 3], firstAt: 20, lastAt: 30 });
  });

  it('returns a requested suffix after capacity wraparound', () => {
    const ring = new TimedNumberSampleRing(3);
    ring.push(10, 1);
    ring.push(20, 2);
    ring.push(30, 3);
    ring.push(40, 4);

    expect(ring.snapshotSince(25)).toEqual({ values: [3, 4], firstAt: 30, lastAt: 40 });
    expect(ring.snapshotSince(50)).toEqual({ values: [], firstAt: null, lastAt: null });
  });
});
