// The shader warm worker's scheduler (src/render/shader_warm_worker_core.ts):
// which request is submitted next, and how many links stay in flight. Two
// rules, and the file is only worth its size if both hold: the highest
// priority first and arrival order within a priority, and an AIMD window
// that starts at two links, grows on fast settles up to the platform cap and
// halves on a slow one. Everything here is driven by an injected clock, so a
// settlement duration is a number this file chooses, never a wall reading.

import { describe, expect, it } from 'vitest';
import {
  createWarmScheduler,
  SHADER_WARM_LINK_DEADLINE_MS,
  SHADER_WARM_MAX_WINDOW_DESKTOP,
  SHADER_WARM_MAX_WINDOW_MOBILE,
  SHADER_WARM_RETAINED_DESKTOP,
  SHADER_WARM_RETAINED_MOBILE,
  SHADER_WARM_WINDOW_CONFIG,
  type WarmScheduler,
} from '../src/render/shader_warm_worker_core';

interface Rig {
  scheduler: WarmScheduler;
  advance(ms: number): void;
  /** Take every request the window admits right now. */
  drain(): number[];
}

function rig(maxWindow = SHADER_WARM_MAX_WINDOW_DESKTOP): Rig {
  let now = 0;
  const scheduler = createWarmScheduler({ now: () => now }, maxWindow);
  return {
    scheduler,
    advance(ms) {
      now += ms;
    },
    drain() {
      const taken: number[] = [];
      for (;;) {
        const next = scheduler.takeNext();
        if (!next) return taken;
        taken.push(next.id);
      }
    },
  };
}

describe('the window the worker paces itself with', () => {
  it('pins the AIMD literals the cold-link table settled', () => {
    // Read off the cross-platform cold-link measurements: a settle under the
    // fast bound is a driver with headroom, one past the slow bound is a
    // driver already queueing. Moving either silently re-tunes every
    // platform at once.
    expect(SHADER_WARM_WINDOW_CONFIG).toEqual({
      initialWindowLinks: 2,
      minWindowLinks: 1,
      maxWindowLinks: 4,
      initialLinkEstimate: 1,
      increaseLinks: 1,
      fastSettlementMs: 150,
      slowSettlementMs: 400,
      noProgressMs: 4_000,
      maxSleepMs: 16,
    });
  });

  it('pins the two platform caps, the phone under the desktop', () => {
    expect(SHADER_WARM_MAX_WINDOW_DESKTOP).toBe(4);
    expect(SHADER_WARM_MAX_WINDOW_MOBILE).toBe(2);
    expect(SHADER_WARM_MAX_WINDOW_MOBILE).toBeLessThan(SHADER_WARM_MAX_WINDOW_DESKTOP);
  });

  it('pins the retention caps, the phone keeping the smaller set', () => {
    // The worker keeps a linked program alive after its resolve (whether the
    // browser cache survives a deleteProgram is unmeasured); a phone's GPU
    // memory is shared with the compositor, so it holds far fewer.
    expect(SHADER_WARM_RETAINED_DESKTOP).toBe(256);
    expect(SHADER_WARM_RETAINED_MOBILE).toBe(64);
    expect(SHADER_WARM_RETAINED_MOBILE).toBeLessThan(SHADER_WARM_RETAINED_DESKTOP);
  });

  it('drops a wedged link at the AIMD own no-progress bound, not a bound of its own', () => {
    // The deadline and the budget's stall bound must be the same number: a
    // link the worker still waits on past the point admission closed is
    // exactly the one that would hold the lane shut for good.
    expect(SHADER_WARM_LINK_DEADLINE_MS).toBe(4_000);
    expect(SHADER_WARM_LINK_DEADLINE_MS).toBe(SHADER_WARM_WINDOW_CONFIG.noProgressMs);
  });

  it('clamps a caller window into the config bounds, never past the maximum', () => {
    expect(rig(99).scheduler.snapshot().budget.maxWindowLinks).toBe(4);
    expect(rig(0).scheduler.snapshot().budget.maxWindowLinks).toBe(1);
  });
});

describe('warm scheduler order', () => {
  it('serves the highest priority first and arrival order within a priority', () => {
    const { scheduler } = rig();
    scheduler.enqueue({ id: 1, priority: 10 });
    scheduler.enqueue({ id: 2, priority: 30 });
    scheduler.enqueue({ id: 3, priority: 10 });
    scheduler.enqueue({ id: 4, priority: 30 });

    const order: number[] = [];
    for (;;) {
      const next = scheduler.takeNext();
      if (!next) break;
      order.push(next.id);
      // Settled at once, so the window is never what decides the order here.
      scheduler.markSettled(next.id);
    }
    expect(order).toEqual([2, 4, 1, 3]);
  });

  it('puts a late high-priority request ahead of everything below it', () => {
    // The reveal that just arrived is why the priority exists: it must not
    // queue behind a catalog that was asked for first.
    const { scheduler } = rig();
    scheduler.enqueue({ id: 1, priority: 10 });
    scheduler.enqueue({ id: 2, priority: 10 });
    scheduler.enqueue({ id: 3, priority: 40 });

    expect(scheduler.takeNext()?.id).toBe(3);
    expect(scheduler.takeNext()?.id).toBe(1);
  });

  it('ignores an id it is already carrying, pending or in flight', () => {
    const { scheduler } = rig();
    scheduler.enqueue({ id: 7, priority: 10 });
    scheduler.enqueue({ id: 7, priority: 40 });
    expect(scheduler.pendingCount()).toBe(1);

    expect(scheduler.takeNext()?.id).toBe(7);
    scheduler.enqueue({ id: 7, priority: 10 });
    expect(scheduler.pendingCount()).toBe(0);
    expect(scheduler.inFlightCount()).toBe(1);
  });
});

describe('warm scheduler admission window', () => {
  it('holds two links in flight before any settle answers', () => {
    const { scheduler } = rig();
    for (let id = 1; id <= 5; id++) scheduler.enqueue({ id, priority: 10 });

    expect(scheduler.takeNext()?.id).toBe(1);
    expect(scheduler.takeNext()?.id).toBe(2);
    expect(scheduler.takeNext()).toBeNull();
    expect(scheduler.inFlightCount()).toBe(2);
    expect(scheduler.pendingCount()).toBe(3);
    expect(scheduler.snapshot().budget.windowLinks).toBe(2);
  });

  it('admits nothing while paused, and picks up again on resume', () => {
    // The pause is the main thread saying its frames are late; a window slot
    // is not a reason to add GPU work to them.
    const { scheduler } = rig();
    for (let id = 1; id <= 3; id++) scheduler.enqueue({ id, priority: 10 });
    scheduler.pause();

    expect(scheduler.paused()).toBe(true);
    expect(scheduler.takeNext()).toBeNull();
    expect(scheduler.inFlightCount()).toBe(0);

    scheduler.resume();
    expect(scheduler.paused()).toBe(false);
    expect(scheduler.takeNext()?.id).toBe(1);
  });

  it('grows to the cap on fast settles, and stops there', () => {
    const { scheduler, advance, drain } = rig();
    for (let id = 1; id <= 12; id++) scheduler.enqueue({ id, priority: 10 });

    expect(drain()).toEqual([1, 2]);
    // Each settle lands well under the fast bound, which is what buys a slot.
    advance(10);
    scheduler.markSettled(1);
    expect(scheduler.snapshot().budget.windowLinks).toBe(3);
    expect(drain()).toEqual([3, 4]);

    advance(10);
    scheduler.markSettled(2);
    expect(scheduler.snapshot().budget.windowLinks).toBe(4);
    expect(drain()).toEqual([5, 6]);

    // At the cap the window stops: four in flight admits nothing more, and
    // more fast settles do not lift it past four.
    expect(scheduler.inFlightCount()).toBe(4);
    expect(scheduler.takeNext()).toBeNull();
    advance(10);
    scheduler.markSettled(3);
    advance(10);
    scheduler.markSettled(4);
    expect(scheduler.snapshot().budget.windowLinks).toBe(4);
  });

  it('halves the window on a settle past the slow bound', () => {
    const { scheduler, advance, drain } = rig();
    for (let id = 1; id <= 12; id++) scheduler.enqueue({ id, priority: 10 });
    drain();
    advance(10);
    scheduler.markSettled(1);
    advance(10);
    scheduler.markSettled(2);
    drain();
    expect(scheduler.snapshot().budget.windowLinks).toBe(4);

    // A driver that took 500 ms is already queueing: the window halves
    // before the queue deepens.
    advance(500);
    scheduler.markSettled(3);
    const budget = scheduler.snapshot().budget;
    expect(budget.windowLinks).toBe(2);
    expect(budget.state).toBe('backoff');
    expect(budget.lastSettlementMs).toBe(500);
  });

  it('never exceeds the phone cap, however fast the settles come back', () => {
    const { scheduler, advance, drain } = rig(SHADER_WARM_MAX_WINDOW_MOBILE);
    for (let id = 1; id <= 8; id++) scheduler.enqueue({ id, priority: 10 });

    expect(drain()).toEqual([1, 2]);
    for (const id of [1, 2]) {
      advance(5);
      scheduler.markSettled(id);
    }
    expect(scheduler.snapshot().budget.windowLinks).toBe(SHADER_WARM_MAX_WINDOW_MOBILE);
    expect(drain()).toEqual([3, 4]);
    expect(scheduler.takeNext()).toBeNull();
  });
});

describe('warm scheduler settles and cancels', () => {
  it('cancels only what has not been submitted, and reports exactly those', () => {
    // An in-flight link is not cancellable at the driver, so claiming it was
    // dropped would tell the client a program is coming back that is not.
    const { scheduler } = rig();
    for (let id = 1; id <= 3; id++) scheduler.enqueue({ id, priority: 10 });
    scheduler.takeNext();

    expect(scheduler.cancel([1, 2, 99])).toEqual([2]);
    expect(scheduler.pendingCount()).toBe(1);
    expect(scheduler.inFlightCount()).toBe(1);
    expect(scheduler.snapshot().cancelled).toBe(1);
  });

  it('ignores a settle or a failure for an id it is not carrying', () => {
    // The worker answers late for a program the scheduler already released;
    // counting it would credit a slot that was never taken.
    const { scheduler } = rig();
    scheduler.enqueue({ id: 1, priority: 10 });
    scheduler.takeNext();
    scheduler.markSettled(1);

    scheduler.markSettled(1);
    scheduler.markSettled(404);
    scheduler.markFailed(404);
    const snapshot = scheduler.snapshot();
    expect(snapshot.settled).toBe(1);
    expect(snapshot.failed).toBe(0);
    expect(snapshot.inFlight).toBe(0);
  });

  it('counts what it did and says when there is nothing left to do', () => {
    const { scheduler, advance } = rig();
    expect(scheduler.active()).toBe(false);

    scheduler.enqueue({ id: 1, priority: 10 });
    scheduler.enqueue({ id: 2, priority: 10 });
    expect(scheduler.active()).toBe(true);
    scheduler.takeNext();
    scheduler.takeNext();
    advance(10);
    scheduler.markSettled(1);
    scheduler.markFailed(2);

    expect(scheduler.snapshot()).toMatchObject({
      pending: 0,
      inFlight: 0,
      paused: false,
      submitted: 2,
      settled: 1,
      failed: 1,
      cancelled: 0,
    });
    expect(scheduler.active()).toBe(false);
  });

  it('stays active while a link is in flight with nothing pending', () => {
    // A worker that stopped ticking here would leave the client waiting on a
    // program that is still linking.
    const { scheduler } = rig();
    scheduler.enqueue({ id: 1, priority: 10 });
    scheduler.takeNext();

    expect(scheduler.pendingCount()).toBe(0);
    expect(scheduler.active()).toBe(true);
  });
});
