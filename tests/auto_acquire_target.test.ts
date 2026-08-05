// Unit tests for the pure ranking core behind auto-acquire-on-cast (issue
// #2787): src/sim/auto_acquire_target.ts. No SimContext needed; the caller
// (casting_lifecycle.ts) builds the candidate list, this file only ranks it.

import { describe, expect, it } from 'vitest';
import { type AttackerCandidate, nearestAttackerId } from '../src/sim/auto_acquire_target';

describe('nearestAttackerId', () => {
  it('returns null for an empty candidate list', () => {
    expect(nearestAttackerId([])).toBeNull();
  });

  it('picks the single candidate', () => {
    const candidates: AttackerCandidate[] = [{ id: 7, d: 12, facingDiff: 1 }];
    expect(nearestAttackerId(candidates)).toBe(7);
  });

  it('picks the strictly nearest candidate by distance', () => {
    const candidates: AttackerCandidate[] = [
      { id: 1, d: 20, facingDiff: 0 },
      { id: 2, d: 5, facingDiff: 3 }, // nearest despite a worse facing
      { id: 3, d: 15, facingDiff: 0.1 },
    ];
    expect(nearestAttackerId(candidates)).toBe(2);
  });

  it('breaks an exact distance tie on facing (smaller angle wins)', () => {
    const candidates: AttackerCandidate[] = [
      { id: 10, d: 8, facingDiff: 1.5 },
      { id: 11, d: 8, facingDiff: 0.2 }, // more nearly in front, same distance
    ];
    expect(nearestAttackerId(candidates)).toBe(11);
  });

  it('breaks an exact distance-and-facing tie on the lower entity id', () => {
    const candidates: AttackerCandidate[] = [
      { id: 42, d: 8, facingDiff: 0.5 },
      { id: 9, d: 8, facingDiff: 0.5 },
    ];
    expect(nearestAttackerId(candidates)).toBe(9);
  });

  it('is order-independent (same winner regardless of input order)', () => {
    const a: AttackerCandidate = { id: 1, d: 10, facingDiff: 0.9 };
    const b: AttackerCandidate = { id: 2, d: 6, facingDiff: 0.1 };
    const c: AttackerCandidate = { id: 3, d: 30, facingDiff: 0 };
    expect(nearestAttackerId([a, b, c])).toBe(2);
    expect(nearestAttackerId([c, b, a])).toBe(2);
    expect(nearestAttackerId([b, a, c])).toBe(2);
  });
});
