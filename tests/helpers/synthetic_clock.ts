// A fully virtual clock for driving modules that take an injected time seam.
//
// Deliberately NOT vitest fake timers. Two traps make real timers the wrong tool
// for this job, and both are recorded in the packet's state.md:
//  - a clock CAPTURED at construction does not move under fake timers, so a test
//    built on them can pass for an implementation that quietly reads the real
//    clock;
//  - a fractional delay is allowed to fire EARLY, so a wait computed from a
//    float (a Discord retry_after, say) can expire a hair before its window.
// A virtual clock has neither problem: time only moves when the test moves it,
// and the schedule that comes out is exactly reproducible, which is what makes
// a recorded-schedule determinism assertion meaningful.

export interface SyntheticClock {
  /** Milliseconds since this clock's origin. */
  now(): number;
  /** Resolves once virtual time has reached `now() + ms`. */
  sleep(ms: number): Promise<void>;
  /** Move time forward to an absolute point, waking everything due on the way. */
  advanceTo(to: number): Promise<void>;
  /** Move time forward by a delta, waking everything due on the way. */
  advanceBy(ms: number): Promise<void>;
  /** Jump to each next scheduled wake in turn until nothing is pending. */
  runAll(maxSteps?: number): Promise<void>;
  /** How many sleepers are waiting. */
  pending(): number;
}

interface Waiter {
  at: number;
  seq: number;
  resolve: () => void;
}

/** Drain the microtask queue so awaited continuations get to run. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

export function syntheticClock(start = 0): SyntheticClock {
  let current = start;
  let seq = 0;
  const waiters: Waiter[] = [];

  // Ties break on insertion order, so two sleepers that wake at the same
  // instant resolve in the order they went to sleep. Without that the schedule
  // would depend on sort stability and the determinism test would be a coin flip.
  const byDueTime = (a: Waiter, b: Waiter): number => a.at - b.at || a.seq - b.seq;

  const wakeDue = (): void => {
    waiters.sort(byDueTime);
    while (waiters.length > 0 && waiters[0].at <= current) {
      const due = waiters.shift() as Waiter;
      due.resolve();
    }
  };

  const advanceTo = async (to: number): Promise<void> => {
    // Step to each intermediate wake rather than jumping straight to `to`, so a
    // sleep scheduled BY a woken continuation still sees the right `now()`.
    for (;;) {
      await flushMicrotasks();
      waiters.sort(byDueTime);
      const next = waiters.find((w) => w.at <= to);
      if (next === undefined) break;
      current = Math.max(current, next.at);
      wakeDue();
    }
    current = Math.max(current, to);
    await flushMicrotasks();
  };

  return {
    now: () => current,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        // A non-positive wait is not a scheduling event at all; resolving on the
        // microtask queue keeps it from silently becoming a zero-length timer.
        if (!(ms > 0)) {
          resolve();
          return;
        }
        waiters.push({ at: current + ms, seq: seq++, resolve });
      }),
    advanceTo,
    advanceBy: (ms: number) => advanceTo(current + ms),
    async runAll(maxSteps = 1000): Promise<void> {
      for (let step = 0; step < maxSteps; step++) {
        await flushMicrotasks();
        if (waiters.length === 0) return;
        waiters.sort(byDueTime);
        await advanceTo(waiters[0].at);
      }
      throw new Error(`syntheticClock.runAll did not settle within ${maxSteps} steps`);
    },
    pending: () => waiters.length,
  };
}
