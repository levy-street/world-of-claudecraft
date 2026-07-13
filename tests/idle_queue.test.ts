import { describe, expect, it } from 'vitest';
import { runIdleQueue } from '../src/render/idle_queue';

// Deterministic fake scheduler: instead of a real idle callback, queue the
// step and let the test drain it manually so there's no reliance on real
// timers or requestIdleCallback (unavailable in the plain-Node test env).
function fakeScheduler(): {
  scheduler: (callback: () => void, timeoutMs: number) => void;
  drainAll: () => void;
} {
  const pending: (() => void)[] = [];
  return {
    scheduler: (callback) => {
      pending.push(callback);
    },
    drainAll: () => {
      while (pending.length > 0) {
        const next = pending.shift();
        next?.();
      }
    },
  };
}

describe('runIdleQueue', () => {
  it('resolves immediately for an empty queue without scheduling anything', async () => {
    const { scheduler, drainAll } = fakeScheduler();
    let scheduled = false;
    await runIdleQueue([], () => {}, {
      batchSize: 4,
      timeoutMs: 100,
      scheduler: (cb, ms) => {
        scheduled = true;
        scheduler(cb, ms);
      },
    });
    drainAll();
    expect(scheduled).toBe(false);
  });

  it('processes every item exactly once, in order, across batches', async () => {
    const { scheduler, drainAll } = fakeScheduler();
    const seen: number[] = [];
    const items = Array.from({ length: 10 }, (_, i) => i);
    const done = runIdleQueue(items, (item) => seen.push(item), {
      batchSize: 3,
      timeoutMs: 50,
      scheduler,
    });
    drainAll();
    await done;
    expect(seen).toEqual(items);
  });

  it('never processes more than batchSize items per scheduled step', async () => {
    const pending: (() => void)[] = [];
    const scheduler = (cb: () => void): void => {
      pending.push(cb);
    };
    const batchSizes: number[] = [];
    let seenThisBatch = 0;
    const items = Array.from({ length: 7 }, (_, i) => i);
    const done = runIdleQueue(
      items,
      () => {
        seenThisBatch++;
      },
      { batchSize: 3, timeoutMs: 50, scheduler },
    );
    // Run exactly one queued step at a time (a fresh scheduler call may
    // append another step mid-drain, which is fine: we only measure the
    // delta across each single step we invoke).
    let guard = 0;
    while (pending.length > 0 && guard++ < 20) {
      const before = seenThisBatch;
      const step = pending.shift();
      step?.();
      batchSizes.push(seenThisBatch - before);
    }
    await done;

    expect(batchSizes.every((n) => n <= 3)).toBe(true);
    expect(seenThisBatch).toBe(7);
  });

  it('stops scheduling and resolves as soon as cancelled() reports true', async () => {
    const { scheduler, drainAll } = fakeScheduler();
    const seen: number[] = [];
    let cancel = false;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const done = runIdleQueue(items, (item) => seen.push(item), {
      batchSize: 2,
      timeoutMs: 50,
      scheduler,
      cancelled: () => cancel,
    });
    cancel = true;
    drainAll();
    await done;
    expect(seen).toEqual([]);
  });
});
