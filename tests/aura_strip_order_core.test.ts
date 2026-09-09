// Urgency banding for the player's aura strips (src/ui/aura_strip_order_core.ts).
// Pure, so this drives the resolver directly; the ordering it produces once the view
// fills its slot pool from it is covered in tests/auras_view.test.ts.

import { describe, expect, it } from 'vitest';
import {
  AURA_URGENCY_BUCKET_COUNT,
  AURA_URGENCY_BUCKET_MODE,
  AURA_URGENCY_BUCKET_SECONDS,
  AURA_URGENCY_BUCKET_UPKEEP,
  auraUrgencyBucket,
} from '../src/ui/aura_strip_order_core';

describe('auraUrgencyBucket', () => {
  it('pins the band bounds, so a boundary move is a deliberate edit', () => {
    // Literals, not a re-derivation from the exported array: a test that compares the
    // constant to itself would pass no matter what the bounds became.
    expect(AURA_URGENCY_BUCKET_SECONDS).toEqual([60, 300, 1800]);
    expect(AURA_URGENCY_BUCKET_UPKEEP).toBe(3);
    expect(AURA_URGENCY_BUCKET_MODE).toBe(4);
    expect(AURA_URGENCY_BUCKET_COUNT).toBe(5);
  });

  it('lands each remaining time in its band', () => {
    expect(auraUrgencyBucket(9, false)).toBe(0);
    expect(auraUrgencyBucket(34, false)).toBe(0);
    expect(auraUrgencyBucket(120, false)).toBe(1);
    expect(auraUrgencyBucket(900, false)).toBe(2);
    expect(auraUrgencyBucket(1800, false)).toBe(AURA_URGENCY_BUCKET_UPKEEP);
    expect(auraUrgencyBucket(3600, false)).toBe(AURA_URGENCY_BUCKET_UPKEEP);
  });

  it('treats each bound as exclusive, so the boundary second falls in the SLOWER band', () => {
    // One assertion per bound, both sides: a single-sided check would pass with the
    // comparison flipped from `<` to `<=`.
    expect(auraUrgencyBucket(59.9, false)).toBe(0);
    expect(auraUrgencyBucket(60, false)).toBe(1);
    expect(auraUrgencyBucket(299.9, false)).toBe(1);
    expect(auraUrgencyBucket(300, false)).toBe(2);
    expect(auraUrgencyBucket(1799.9, false)).toBe(2);
    expect(auraUrgencyBucket(1800, false)).toBe(AURA_URGENCY_BUCKET_UPKEEP);
  });

  it('bands a toggle as a mode however much time the sim claims is left on it', () => {
    // The sim backs a stance/form with 3600s of scaffolding; banding it by that number
    // would drop it in the middle of the upkeep buffs instead of at the far end.
    expect(auraUrgencyBucket(3600, true)).toBe(AURA_URGENCY_BUCKET_MODE);
    // Even a toggle the sim says is nearly gone stays a mode, never band 0.
    expect(auraUrgencyBucket(1, true)).toBe(AURA_URGENCY_BUCKET_MODE);
  });

  it('bands a non-finite remaining as a mode, matching the suppressed countdown', () => {
    expect(auraUrgencyBucket(Number.POSITIVE_INFINITY, false)).toBe(AURA_URGENCY_BUCKET_MODE);
    expect(auraUrgencyBucket(Number.NaN, false)).toBe(AURA_URGENCY_BUCKET_MODE);
  });

  it('keeps an expiring aura maximally urgent rather than clamping it away', () => {
    expect(auraUrgencyBucket(0, false)).toBe(0);
    expect(auraUrgencyBucket(-1, false)).toBe(0);
  });

  it('never returns a band outside the pass range a caller iterates', () => {
    for (const remaining of [-5, 0, 1, 59, 60, 299, 300, 1799, 1800, 100000]) {
      for (const toggle of [false, true]) {
        const b = auraUrgencyBucket(remaining, toggle);
        expect(Number.isInteger(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(AURA_URGENCY_BUCKET_COUNT);
      }
    }
  });
});
