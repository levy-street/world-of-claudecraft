// Drains a work queue across browser idle slots instead of one blocking loop,
// so expensive per-item work (e.g. building far terrain chunks) doesn't stall
// the first frame. Pure and DOM-free at import time: the scheduler is only
// touched when drain() actually runs, so this module is safe to unit test in
// plain Node (no jsdom) by injecting a fake scheduler.

export interface IdleBudget {
  didTimeout: boolean;
  timeRemaining: () => number;
  /** Present only for the paced timer used where requestIdleCallback is absent. */
  source?: 'cooperative-timer';
}

export type IdleScheduler = (callback: (deadline?: IdleBudget) => void, timeoutMs: number) => void;

export interface IdleSlotResult {
  /** True only after the configured timeout-deferral ceiling was exhausted. */
  forcedProgress: boolean;
  /** Distinguishes real idle budget, rIC timeout, and the Safari timer fallback. */
  source: 'idle' | 'idle-timeout' | 'cooperative-timer';
  /** Snapshot of the browser's remaining idle budget when the slot resolved. */
  timeRemainingMs: number;
}

export interface IdleSlotOptions {
  scheduler?: IdleScheduler;
  /**
   * Number of timed-out callbacks to defer before resolving with forcedProgress.
   * This lets expensive callers avoid immediately piling work onto a busy frame,
   * while a finite ceiling guarantees fallback progress.
   */
  maxTimeoutDeferrals?: number;
}

function defaultScheduler(callback: (deadline?: IdleBudget) => void, timeoutMs: number): void {
  const win = globalThis as typeof globalThis & {
    requestIdleCallback?: (
      cb: (deadline: IdleBudget) => void,
      opts?: { timeout?: number },
    ) => number;
  };
  if (typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(callback, { timeout: timeoutMs });
  } else {
    // Safari may not expose requestIdleCallback. A zero-delay timer is not idle
    // time and can stack expensive work into consecutive busy frames. Honour
    // the caller's full timeout (with a one-frame floor) and label it honestly.
    const delayMs = Math.max(16, timeoutMs);
    setTimeout(
      () =>
        callback({
          didTimeout: true,
          source: 'cooperative-timer',
          timeRemaining: () => 0,
        }),
      delayMs,
    );
  }
}

/** Resolves in the next browser idle slot. One-argument callers retain the
 * Promise<void> contract. Callers that need to schedule expensive work pass
 * options and receive whether the finite timeout ceiling forced progress. */
export function idleSlot(timeoutMs: number): Promise<void>;
export function idleSlot(timeoutMs: number, options: IdleSlotOptions): Promise<IdleSlotResult>;
export function idleSlot(timeoutMs: number, options: IdleSlotOptions = {}): Promise<unknown> {
  const schedule = options.scheduler ?? defaultScheduler;
  const maxTimeoutDeferrals = Math.max(0, Math.floor(options.maxTimeoutDeferrals ?? 0));
  let timeoutDeferrals = 0;
  return new Promise((resolve) => {
    const ready = (deadline?: IdleBudget): void => {
      const budget = deadline ?? {
        didTimeout: false,
        timeRemaining: () => Number.POSITIVE_INFINITY,
      };
      const remaining = Math.max(0, budget.timeRemaining());
      if (!budget.didTimeout && remaining <= 0) {
        schedule(ready, timeoutMs);
        return;
      }
      if (budget.didTimeout && timeoutDeferrals < maxTimeoutDeferrals) {
        timeoutDeferrals++;
        schedule(ready, timeoutMs);
        return;
      }
      resolve({
        forcedProgress: budget.didTimeout,
        source:
          budget.source === 'cooperative-timer'
            ? 'cooperative-timer'
            : budget.didTimeout
              ? 'idle-timeout'
              : 'idle',
        timeRemainingMs: remaining,
      });
    };
    schedule(ready, timeoutMs);
  });
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
    const step = (deadline?: IdleBudget): void => {
      if (options.cancelled?.()) {
        resolve();
        return;
      }
      const budget = deadline ?? {
        didTimeout: false,
        timeRemaining: () => Number.POSITIVE_INFINITY,
      };
      if (!budget.didTimeout && budget.timeRemaining() <= 0) {
        schedule(step, options.timeoutMs);
        return;
      }
      const batchSize = Math.max(1, Math.floor(options.batchSize));
      const maxItems = budget.didTimeout ? 1 : batchSize;
      const end = Math.min(index + maxItems, items.length);
      for (; index < end; index++) {
        if (!budget.didTimeout && budget.timeRemaining() <= 0) break;
        worker(items[index]);
      }
      if (index < items.length) schedule(step, options.timeoutMs);
      else resolve();
    };
    schedule(step, options.timeoutMs);
  });
}
