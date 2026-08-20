import { describe, expect, it } from 'vitest';
import { runBoundedLane } from '../src/render/build_lane_core';

// The runner that keeps the zone-build worker pool fed. Three properties carry
// the whole design: submission follows the nearest-first order the caller
// computed, never more jobs are in flight than the pool has workers (an
// unbounded fan-out would post a whole zone at once and lose arrival order),
// and one failing job falls back on its own without abandoning the rest of the
// zone.

/** A promise plus its resolver, so a test drives completion order by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('bounded build lane', () => {
  it('submits in order and never exceeds the limit in flight', async () => {
    const items = [0, 1, 2, 3, 4, 5, 6];
    const gates = items.map(() => deferred());
    const submitted: number[] = [];
    let inFlight = 0;
    let peak = 0;

    const lane = runBoundedLane(items, 3, async (item) => {
      submitted.push(item);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gates[item].promise;
      inFlight--;
    });

    // Only the first `limit` may have started before anything completes.
    await Promise.resolve();
    expect(submitted).toEqual([0, 1, 2]);

    // Completing out of order still submits in order.
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(submitted).toEqual([0, 1, 2, 3]);

    for (const gate of gates) gate.resolve();
    await lane;
    expect(submitted).toEqual(items);
    expect(peak).toBe(3);
  });

  it('runs the synchronous prefix of each job in submission order', async () => {
    const claimed: string[] = [];
    await runBoundedLane(['a', 'b', 'c', 'd'], 4, async (item) => {
      claimed.push(item);
      await new Promise((r) => setTimeout(r, item === 'a' ? 5 : 0));
    });
    expect(claimed).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lets a failing job fall back without aborting the rest', async () => {
    const built: number[] = [];
    const fellBack: number[] = [];
    await runBoundedLane([0, 1, 2, 3], 2, async (item) => {
      const offThread = item !== 2;
      if (!offThread) {
        fellBack.push(item);
        built.push(item);
        return;
      }
      await Promise.resolve();
      built.push(item);
    });
    expect(fellBack).toEqual([2]);
    expect(built.sort()).toEqual([0, 1, 2, 3]);
  });

  it('contains a rejection, reports it, and keeps going', async () => {
    const errors: number[] = [];
    const done: number[] = [];
    await runBoundedLane(
      [0, 1, 2, 3],
      2,
      async (item) => {
        if (item === 1) throw new Error('worker died');
        await Promise.resolve();
        done.push(item);
      },
      { onError: (_error, index) => errors.push(index) },
    );
    expect(errors).toEqual([1]);
    expect(done.sort()).toEqual([0, 2, 3]);
  });

  it('stops submitting once the caller cancels, and still awaits what started', async () => {
    // Deterministic: with limit 2 the lane submits 0 and 1, then parks on the
    // race; item 1 cancels while both are in flight, so the check before item
    // 2 is the first one that sees it. Exactly [0, 1] started, never 2.
    const started: number[] = [];
    const finished: number[] = [];
    let cancelled = false;
    await runBoundedLane(
      [0, 1, 2, 3, 4, 5],
      2,
      async (item) => {
        started.push(item);
        await Promise.resolve();
        if (item === 1) cancelled = true;
        // A second await, so a lane that returned at the break instead of
        // draining what it started would resolve with this still unrun.
        await new Promise((resolve) => setTimeout(resolve, 0));
        finished.push(item);
      },
      { shouldStop: () => cancelled },
    );
    expect(started).toEqual([0, 1]);
    // Cancelling stops SUBMISSION only: every started job is awaited to the
    // end before the lane resolves.
    expect(finished.slice().sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it('treats a zero or negative limit as one in flight rather than deadlocking', async () => {
    const order: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await runBoundedLane([0, 1, 2], 0, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      order.push(item);
      inFlight--;
    });
    expect(order).toEqual([0, 1, 2]);
    expect(peak).toBe(1);
  });
});
