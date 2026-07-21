// Drains a work queue across browser idle slots instead of one blocking loop,
// so expensive per-item work (e.g. building far terrain chunks) doesn't stall
// the first frame. Pure and DOM-free at import time: the scheduler is only
// touched when drain() actually runs, so this module is safe to unit test in
// plain Node (no jsdom) by injecting a fake scheduler.

export type IdleScheduler = (callback: () => void, timeoutMs: number) => void;

function defaultScheduler(callback: () => void, timeoutMs: number): void {
  const win = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
  };
  if (typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(callback, { timeout: timeoutMs });
  } else {
    setTimeout(callback, 0);
  }
}

export interface IdleQueueOptions {
  /** Max items worked per idle slot. Keeps any single callback cheap. */
  batchSize: number;
  /** requestIdleCallback timeout: forces progress even under sustained load. */
  timeoutMs: number;
  /** Injectable for tests; defaults to requestIdleCallback with a setTimeout fallback. */
  scheduler?: IdleScheduler;
  /** Polled before every batch; once true, the queue stops scheduling and resolves. */
  cancelled?: () => boolean;
}

/**
 * Runs `worker` over every item in `items`, a bounded batch per idle slot,
 * until the queue is empty. Resolves once all items are processed, or as soon
 * as `cancelled()` reports true (it does not keep walking the remaining items).
 */
export function runIdleQueue<T>(
  items: readonly T[],
  worker: (item: T) => void,
  options: IdleQueueOptions,
): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  const schedule = options.scheduler ?? defaultScheduler;
  let index = 0;
  return new Promise((resolve) => {
    const step = (): void => {
      if (options.cancelled?.()) {
        resolve();
        return;
      }
      const end = Math.min(index + options.batchSize, items.length);
      for (; index < end; index++) worker(items[index]);
      if (index < items.length) schedule(step, options.timeoutMs);
      else resolve();
    };
    schedule(step, options.timeoutMs);
  });
}
