// Pure display math for the detection-calibration histograms: quantile estimation and
// bucket-to-bar-point shaping. Host-agnostic so it unit-tests in the default Node env.

import type { BarPoint, CalibrationHistogram } from './types';

// Estimates the q-quantile (q in [0, 1]) from cumulative bucket counts, interpolating
// linearly inside the containing bucket. The first bucket's lower edge is clamped to the
// observed min and the overflow bucket spans [last bound, observed max]. Returns null
// on an empty histogram.
export function estimateQuantile(h: CalibrationHistogram, q: number): number | null {
  if (h.count <= 0) return null;
  const rank = q * h.count;
  let cumulative = 0;
  let lower = h.min;
  for (const bucket of h.buckets) {
    const upper = Math.min(Math.max(bucket.le, lower), h.max);
    if (bucket.count > 0) {
      if (cumulative + bucket.count >= rank) {
        const within = Math.max(0, rank - cumulative) / bucket.count;
        return lower + (upper - lower) * within;
      }
      cumulative += bucket.count;
    }
    lower = Math.max(lower, Math.min(bucket.le, h.max));
  }
  if (h.overflowCount > 0) {
    const within = Math.max(0, rank - cumulative) / h.overflowCount;
    return lower + (Math.max(h.max, lower) - lower) * within;
  }
  return h.max;
}

// One bar per non-empty tail-trimmed bucket range: leading and trailing all-zero buckets
// are dropped so the chart zooms on the observed range, and the overflow (if any) gets a
// final "> last bound" bar.
export function histogramBarPoints(h: CalibrationHistogram): BarPoint[] {
  let first = h.buckets.findIndex((b) => b.count > 0);
  if (first < 0) first = h.buckets.length;
  let last = -1;
  for (let i = h.buckets.length - 1; i >= 0; i--) {
    if (h.buckets[i].count > 0) {
      last = i;
      break;
    }
  }
  const points: BarPoint[] = [];
  for (let i = first; i <= last; i++) {
    points.push({ label: `<=${h.buckets[i].le}`, value: h.buckets[i].count });
  }
  if (h.overflowCount > 0) {
    const lastBound = h.buckets.length > 0 ? h.buckets[h.buckets.length - 1].le : 0;
    points.push({ label: `>${lastBound}`, value: h.overflowCount });
  }
  return points;
}
