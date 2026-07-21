import { describe, expect, it } from 'vitest';
import { estimateQuantile, histogramBarPoints } from '../../src/admin/histogram_stats';
import type { CalibrationHistogram } from '../../src/admin/types';

function hist(partial: Partial<CalibrationHistogram>): CalibrationHistogram {
  return {
    id: 'test.metric_ms',
    count: 0,
    min: 0,
    max: 0,
    sum: 0,
    buckets: [],
    overflowCount: 0,
    ...partial,
  };
}

describe('estimateQuantile', () => {
  it('returns null on an empty histogram', () => {
    expect(estimateQuantile(hist({}), 0.5)).toBeNull();
  });

  it('returns the single value for a one-sample histogram', () => {
    const h = hist({
      count: 1,
      min: 3000,
      max: 3000,
      sum: 3000,
      buckets: [
        { le: 1000, count: 0 },
        { le: 4000, count: 1 },
      ],
    });
    expect(estimateQuantile(h, 0.5)).toBe(3000);
    expect(estimateQuantile(h, 0.99)).toBe(3000);
  });

  it('interpolates inside the containing bucket and reaches max at q=1', () => {
    const h = hist({
      count: 2,
      min: 10,
      max: 30,
      sum: 40,
      buckets: [
        { le: 10, count: 1 },
        { le: 25, count: 0 },
        { le: 50, count: 1 },
      ],
    });
    expect(estimateQuantile(h, 1)).toBe(30);
    expect(estimateQuantile(h, 0.25)).toBeLessThanOrEqual(10);
  });

  it('lands the quantile in the overflow when the tail is above the last bound', () => {
    const h = hist({
      count: 4,
      min: 5,
      max: 200,
      sum: 335,
      buckets: [
        { le: 10, count: 2 },
        { le: 50, count: 1 },
      ],
      overflowCount: 1,
    });
    const p99 = estimateQuantile(h, 0.99);
    expect(p99).not.toBeNull();
    expect(p99!).toBeGreaterThan(50);
    expect(p99!).toBeLessThanOrEqual(200);
  });
});

describe('histogramBarPoints', () => {
  it('trims leading and trailing empty buckets', () => {
    const h = hist({
      count: 3,
      min: 12,
      max: 60,
      sum: 100,
      buckets: [
        { le: 10, count: 0 },
        { le: 25, count: 2 },
        { le: 100, count: 1 },
        { le: 1000, count: 0 },
      ],
    });
    expect(histogramBarPoints(h)).toEqual([
      { label: '<=25', value: 2 },
      { label: '<=100', value: 1 },
    ]);
  });

  it('appends an overflow bar labeled past the last bound', () => {
    const h = hist({
      count: 1,
      min: 9999,
      max: 9999,
      sum: 9999,
      buckets: [{ le: 100, count: 0 }],
      overflowCount: 1,
    });
    expect(histogramBarPoints(h)).toEqual([{ label: '>100', value: 1 }]);
  });

  it('returns no bars for an empty histogram', () => {
    expect(histogramBarPoints(hist({ buckets: [{ le: 10, count: 0 }] }))).toEqual([]);
  });
});
