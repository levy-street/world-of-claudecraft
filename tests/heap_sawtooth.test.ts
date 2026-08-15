import { describe, expect, it } from 'vitest';
import { createHeapSawtooth, GC_DROP_MIN_MB } from '../src/game/heap_sawtooth';

const MB = 1024 * 1024;

function trackerFor(series: (number | null)[]) {
  const reads = [...series];
  return createHeapSawtooth({
    readUsedHeapBytes: () => {
      const next = reads.shift();
      return next === null || next === undefined ? null : next * MB;
    },
    recordFloorSeries: () => true,
  });
}

describe('heap sawtooth tracker', () => {
  it('computes hand-checked drops rates and amplitude from a ramp drop ramp series', () => {
    // 1 Hz series in MB: three rises of 10, one GC drop of 35, two rises of 10
    const heap = trackerFor([100, 110, 120, 130, 95, 105, 115]);
    for (let i = 0; i <= 6; i++) heap.sample(i * 1000);

    const s = heap.summary()!;
    expect(s.samples).toBe(7);
    expect(s.seconds).toBe(6);
    expect(s.gcDropCount).toBe(1);
    expect(s.avgDropMb).toBe(35);
    // 50 MB risen over 6 s
    expect(s.allocRateMbPerSec).toBe(8.33);
    expect(s.amplitudeMb).toBe(35);
    expect(s.lastUsedMb).toBe(115);
  });

  it('averages across multiple GC drops of different magnitudes', () => {
    const heap = trackerFor([100, 130, 95, 100, 95]);
    for (let i = 0; i <= 4; i++) heap.sample(i * 1000);

    const s = heap.summary()!;
    expect(s.gcDropCount).toBe(2);
    // drops of 35 and 5
    expect(s.avgDropMb).toBe(20);
    // rises of 30 and 5 over 4 s
    expect(s.allocRateMbPerSec).toBe(8.75);
  });

  it('exposes a copied GC-floor valley series for the dev hitch referee', () => {
    const heap = trackerFor([100, 130, 105, 150, 120]);
    for (let i = 0; i <= 4; i++) heap.sample(i * 1000);

    const valleys = heap.floorSeries();
    expect(valleys).toEqual([
      { atMs: 0, floorMb: 100 },
      { atMs: 2000, floorMb: 105 },
      { atMs: 4000, floorMb: 120 },
    ]);
    expect(heap.floorTrend()).toEqual({
      startMb: 100,
      endMb: 120,
      growthMb: 20,
      floorSamples: 3,
    });

    (valleys as { atMs: number; floorMb: number }[])[0].floorMb = 999;
    expect(heap.floorSeries()[0]).toEqual({ atMs: 0, floorMb: 100 });
  });

  it('ignores sub-floor dips as quantization noise and nets them out of the alloc rate', () => {
    // the 0.4 MB dip is Chrome quantization, not GC; the following rise is
    // judged against the unchanged 100 MB baseline, so it nets to 1 MB
    const heap = trackerFor([100, 99.6, 101]);
    for (let i = 0; i <= 2; i++) heap.sample(i * 1000);

    const s = heap.summary()!;
    expect(s.gcDropCount).toBe(0);
    expect(s.avgDropMb).toBe(0);
    expect(s.allocRateMbPerSec).toBe(0.5);
  });

  it('still catches a slow multi-sample decline once its cumulative fall crosses the floor', () => {
    // each step falls 0.8 MB, under the floor; the baseline stays parked at
    // 100 until the cumulative fall reaches 2.4 MB and registers as one drop
    const heap = trackerFor([100, 99.2, 98.4, 97.6]);
    for (let i = 0; i <= 3; i++) heap.sample(i * 1000);

    const s = heap.summary()!;
    expect(GC_DROP_MIN_MB).toBe(2);
    expect(s.gcDropCount).toBe(1);
    expect(s.avgDropMb).toBe(2.4);
    expect(s.allocRateMbPerSec).toBe(0);
  });

  it('yields a null summary when the reader has no source', () => {
    const heap = trackerFor([null, null, null, null]);
    for (let i = 0; i <= 3; i++) heap.sample(i * 1000);
    expect(heap.summary()).toBeNull();
  });

  it('yields a null summary with fewer than two samples so no rate divides by zero', () => {
    const heap = trackerFor([100]);
    heap.sample(0);
    expect(heap.summary()).toBeNull();
  });

  it('skips null reads mid-series without corrupting the elapsed span', () => {
    const heap = trackerFor([100, null, 130]);
    heap.sample(0);
    heap.sample(1000);
    heap.sample(2000);

    const s = heap.summary()!;
    expect(s.samples).toBe(2);
    expect(s.seconds).toBe(2);
    // 30 MB over the 2 s between the two REAL samples
    expect(s.allocRateMbPerSec).toBe(15);
  });

  it('resets to an empty tracker', () => {
    const heap = trackerFor([100, 110, 120]);
    heap.sample(0);
    heap.sample(1000);
    expect(heap.summary()).not.toBeNull();
    heap.reset();
    expect(heap.summary()).toBeNull();
    expect(heap.floorTrend()).toBeNull();
    expect(heap.floorSeries()).toEqual([]);
  });
});
