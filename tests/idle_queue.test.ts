import { describe, expect, it, vi } from 'vitest';
import { idleSlot, runIdleQueue } from '../src/render/idle_queue';

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

  it('runs at most one item when a timeout forces progress with no idle budget', async () => {
    const pending: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> =
      [];
    const seen: number[] = [];
    const done = runIdleQueue([1, 2, 3], (item) => seen.push(item), {
      batchSize: 3,
      timeoutMs: 50,
      scheduler: (callback) => pending.push(callback),
    });
    pending.shift()?.({ didTimeout: true, timeRemaining: () => 0 });
    expect(seen).toEqual([1]);
    while (pending.length > 0) pending.shift()?.({ didTimeout: true, timeRemaining: () => 0 });
    await done;
    expect(seen).toEqual([1, 2, 3]);
  });

  it('reschedules without work when a normal idle callback has no time remaining', async () => {
    const pending: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> =
      [];
    const seen: number[] = [];
    const done = runIdleQueue([1], (item) => seen.push(item), {
      batchSize: 3,
      timeoutMs: 50,
      scheduler: (callback) => pending.push(callback),
    });
    pending.shift()?.({ didTimeout: false, timeRemaining: () => 0 });
    expect(seen).toEqual([]);
    pending.shift()?.({ didTimeout: false, timeRemaining: () => 5 });
    await done;
    expect(seen).toEqual([1]);
  });
});

describe('idleSlot', () => {
  it('reschedules a normal callback that has no usable idle budget', async () => {
    const pending: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> =
      [];
    const done = idleSlot(50, {
      scheduler: (callback) => pending.push(callback),
    });

    pending.shift()?.({ didTimeout: false, timeRemaining: () => 0 });
    expect(pending).toHaveLength(1);
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    pending.shift()?.({ didTimeout: false, timeRemaining: () => 3.5 });
    await expect(done).resolves.toEqual({
      forcedProgress: false,
      source: 'idle',
      timeRemainingMs: 3.5,
    });
  });

  it('defers timeout callbacks to a bounded ceiling before signaling forced progress', async () => {
    const pending: Array<(deadline: { didTimeout: boolean; timeRemaining: () => number }) => void> =
      [];
    const done = idleSlot(50, {
      maxTimeoutDeferrals: 2,
      scheduler: (callback) => pending.push(callback),
    });

    pending.shift()?.({ didTimeout: true, timeRemaining: () => 0 });
    expect(pending).toHaveLength(1);
    pending.shift()?.({ didTimeout: true, timeRemaining: () => 0 });
    expect(pending).toHaveLength(1);
    pending.shift()?.({ didTimeout: true, timeRemaining: () => 0 });

    await expect(done).resolves.toEqual({
      forcedProgress: true,
      source: 'idle-timeout',
      timeRemainingMs: 0,
    });
    expect(pending).toHaveLength(0);
  });

  it('paces Safari-style fallback slots and labels them as cooperative timer work', async () => {
    vi.useFakeTimers();
    const root = globalThis as typeof globalThis & { requestIdleCallback?: unknown };
    const previous = root.requestIdleCallback;
    Reflect.deleteProperty(root, 'requestIdleCallback');
    try {
      let settled = false;
      const done = idleSlot(250, { maxTimeoutDeferrals: 2 });
      void done.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(749);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(done).resolves.toEqual({
        forcedProgress: true,
        source: 'cooperative-timer',
        timeRemainingMs: 0,
      });
    } finally {
      if (previous === undefined) Reflect.deleteProperty(root, 'requestIdleCallback');
      else Reflect.set(root, 'requestIdleCallback', previous);
      vi.useRealTimers();
    }
  });
});
