import { describe, expect, it } from 'vitest';
import { drainBuild, runBuildInSlices, type SteppedBuild } from '../src/render/stepped_build_core';

/** A build of `pieces` pieces, each costing `costMs` on the shared fake clock. */
function* counted(
  pieces: number,
  clock: { now: number },
  costMs: number,
  log: number[],
): SteppedBuild<number[]> {
  for (let i = 0; i < pieces; i++) {
    clock.now += costMs;
    log.push(i);
    yield;
  }
  return log.slice();
}

describe('stepped zone feature builds', () => {
  it('drains a stepped build to its result in one call', () => {
    const clock = { now: 0 };
    expect(drainBuild(counted(5, clock, 1, []))).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs at most the budget plus one piece per slice, and yields before each slice', async () => {
    const clock = { now: 0 };
    const slices: { started: number; ms: number }[] = [];
    let yields = 0;
    const result = await runBuildInSlices(counted(20, clock, 2, []), 5, {
      now: () => clock.now,
      yieldSlice: async () => {
        yields++;
      },
      onSlice: (started, ms) => slices.push({ started, ms }),
    });
    expect(result).toEqual([...Array(20).keys()]);
    // 2 ms pieces under a 5 ms budget: three pieces per slice (the third
    // crosses the deadline), and the last slice finishes the build.
    expect(slices.every((slice) => slice.ms <= 5 + 2)).toBe(true);
    expect(slices.length).toBeGreaterThan(5);
    expect(yields).toBe(slices.length);
  });

  it('produces the same result however the slices fall', async () => {
    const reference = drainBuild(counted(30, { now: 0 }, 1, []));
    for (const budget of [0.5, 1, 3, 100]) {
      const clock = { now: 0 };
      const sliced = await runBuildInSlices(counted(30, clock, 1, []), budget, {
        now: () => clock.now,
        yieldSlice: async () => undefined,
      });
      expect(sliced).toEqual(reference);
    }
  });

  it('stops between slices once cancelled and closes the build', async () => {
    const clock = { now: 0 };
    const log: number[] = [];
    let closed = false;
    function* build(): SteppedBuild<string> {
      try {
        for (let i = 0; i < 50; i++) {
          clock.now += 1;
          log.push(i);
          yield;
        }
        return 'done';
      } finally {
        closed = true;
      }
    }
    let slices = 0;
    const result = await runBuildInSlices(build(), 3, {
      now: () => clock.now,
      yieldSlice: async () => undefined,
      cancelled: () => slices >= 2,
      onSlice: () => {
        slices++;
      },
    });
    expect(result).toBeUndefined();
    expect(closed).toBe(true);
    expect(log.length).toBeLessThan(50);
    const ranBeforeCancel = log.length;
    expect(ranBeforeCancel).toBeGreaterThan(0);
  });
});
