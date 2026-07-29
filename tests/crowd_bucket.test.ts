import { describe, expect, it } from 'vitest';
import { CROWD_BUCKET_LABELS, crowdBucketLabel } from '../src/game/crowd_bucket';

describe('crowd bucket labels', () => {
  it('pins the fixed label catalog the server sanitizer must mirror', () => {
    expect(CROWD_BUCKET_LABELS).toEqual(['lt10', '10-24', '25-49', '50-99', '100plus', 'unknown']);
  });

  it('buckets every boundary edge on the ruled thresholds', () => {
    expect(crowdBucketLabel(0)).toBe('lt10');
    expect(crowdBucketLabel(9)).toBe('lt10');
    expect(crowdBucketLabel(10)).toBe('10-24');
    expect(crowdBucketLabel(24)).toBe('10-24');
    expect(crowdBucketLabel(25)).toBe('25-49');
    expect(crowdBucketLabel(49)).toBe('25-49');
    expect(crowdBucketLabel(50)).toBe('50-99');
    expect(crowdBucketLabel(99)).toBe('50-99');
    expect(crowdBucketLabel(100)).toBe('100plus');
    expect(crowdBucketLabel(5000)).toBe('100plus');
  });

  it('keeps fractional counts inside their integer band', () => {
    expect(crowdBucketLabel(9.9)).toBe('lt10');
    expect(crowdBucketLabel(99.5)).toBe('50-99');
  });

  it('folds missing and nonsensical counts to unknown', () => {
    expect(crowdBucketLabel(null)).toBe('unknown');
    expect(crowdBucketLabel(undefined)).toBe('unknown');
    expect(crowdBucketLabel(Number.NaN)).toBe('unknown');
    expect(crowdBucketLabel(Number.POSITIVE_INFINITY)).toBe('unknown');
    expect(crowdBucketLabel(-1)).toBe('unknown');
  });
});
