import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBackgroundGpuQueue, GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { withHiddenPrewarmGroups } from '../src/render/prewarm_pass';

describe('createBackgroundGpuQueue', () => {
  it('serializes independent GPU lanes without overlap', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    let releaseFirst!: () => void;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          active++;
          maxActive = Math.max(maxActive, active);
          events.push('first:start');
          releaseFirst = () => {
            active--;
            events.push('first:end');
            resolve();
          };
        }),
    );
    const second = queue.run(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      events.push('second:start');
      active--;
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(maxActive).toBe(1);
  });

  it('continues the queue after a failed lane', async () => {
    const queue = createBackgroundGpuQueue();
    const failed = queue.run(async () => {
      throw new Error('gpu lane failed');
    });
    const later = queue.run(async () => 'later');

    await expect(failed).rejects.toThrow('gpu lane failed');
    await expect(later).resolves.toBe('later');
  });

  it('cancels queued work, rejects new work, and quiesces the active unit', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push('active:start');
          releaseActive = resolve;
        }),
    );
    const pending = queue.run(async () => {
      events.push('pending');
    });
    await Promise.resolve();

    const shutdownError = new Error('renderer generation ended');
    const pendingRejected = expect(pending).rejects.toBe(shutdownError);
    const shutdown = queue.shutdown(shutdownError).then(() => events.push('shutdown'));
    expect(queue.shutdown()).toBe(queue.shutdown());
    await expect(queue.run(async () => {})).rejects.toBe(shutdownError);
    expect(events).toEqual(['active:start']);

    releaseActive();
    await Promise.all([active, pendingRejected, shutdown]);
    expect(events).toEqual(['active:start', 'shutdown']);
  });

  it('shuts down idempotently while idle', async () => {
    const queue = createBackgroundGpuQueue();
    const first = queue.shutdown();
    expect(queue.shutdown()).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it('runs higher-priority pending work first and preserves FIFO within a priority', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push('active');
          releaseActive = resolve;
        }),
      GPU_WORK_PRIORITY.BACKGROUND,
    );
    await Promise.resolve();

    const low = queue.run(async () => {
      events.push('low');
    }, GPU_WORK_PRIORITY.BOOT_RESUME);
    const highOne = queue.run(async () => {
      events.push('high-one');
    }, GPU_WORK_PRIORITY.LIVE_VIEW);
    const medium = queue.run(async () => {
      events.push('medium');
    }, GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    const highTwo = queue.run(async () => {
      events.push('high-two');
    }, GPU_WORK_PRIORITY.LIVE_VIEW);
    // Behavioral pin for the debt class: enqueued alongside a BACKGROUND
    // preview unit, the debt unit starts first.
    const preview = queue.run(async () => {
      events.push('preview');
    }, GPU_WORK_PRIORITY.BACKGROUND);
    const debt = queue.run(async () => {
      events.push('debt');
    }, GPU_WORK_PRIORITY.BOOT_DEBT);

    releaseActive();
    await Promise.all([active, low, highOne, medium, highTwo, preview, debt]);
    expect(events).toEqual(['active', 'high-one', 'high-two', 'medium', 'debt', 'preview', 'low']);
    expect(GPU_WORK_PRIORITY.ACTIONABLE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(GPU_WORK_PRIORITY.LIVE_VIEW).toBeGreaterThan(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
    // Dropped-prewarm link/upload debt outranks the cosmetic BACKGROUND
    // warmers (the preview lane starved it for minutes in production) but
    // stays under the streamed-zone prepare and every live gate.
    expect(GPU_WORK_PRIORITY.VISIBLE_PREWARM).toBeGreaterThan(GPU_WORK_PRIORITY.BOOT_DEBT);
    expect(GPU_WORK_PRIORITY.BOOT_DEBT).toBeGreaterThan(GPU_WORK_PRIORITY.BACKGROUND);
    expect(GPU_WORK_PRIORITY.BACKGROUND).toBeGreaterThan(GPU_WORK_PRIORITY.BOOT_RESUME);
  });

  it('hides a queued group synchronously before an occupied GPU lane releases', async () => {
    const queue = createBackgroundGpuQueue();
    let releaseActive!: () => void;
    const active = queue.run(
      () =>
        new Promise<void>((resolve) => {
          releaseActive = resolve;
        }),
    );
    await Promise.resolve();
    const group = { visible: true, children: [] };
    const queued = withHiddenPrewarmGroups([group], () => queue.run(async () => {}));

    expect(group.visible).toBe(false);
    releaseActive();
    await Promise.all([active, queued]);
    expect(group.visible).toBe(true);
  });

  it('records label, priority, and the sync slice separately from wall time', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = queue.run(
      () => {
        // The synchronous prologue is the main-thread block; the awaited tail
        // is the off-thread link wait and must NOT count as sync cost.
        clock += 12;
        return gate;
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-view-gate',
    );
    await Promise.resolve();
    await Promise.resolve();
    clock += 500;
    release();
    await pending;
    const stats = queue.stats();
    expect(stats.units).toBe(1);
    expect(stats.slowest[0].label).toBe('live-view-gate');
    expect(stats.slowest[0].priority).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
    expect(stats.slowest[0].syncMs).toBe(12);
    expect(stats.slowest[0].wallMs).toBe(512);
  });

  // Grant latency: the queue's contract is that a cosmetic lane never delays an
  // actionable one, and the wait between enqueue and start is the only place
  // that contract can be observed breaking. Before this, nothing measured it.
  it('records how long each unit waited for its grant', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = queue.run(() => gate, GPU_WORK_PRIORITY.BACKGROUND, 'cosmetic');
    // Let the cosmetic unit actually START before the gate is enqueued.
    // Priority only decides which PENDING unit goes next, so a gate queued in
    // the same turn would simply be picked first and measure nothing.
    await flush();
    const second = queue.run(
      () => {
        clock += 3;
      },
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'live-gate',
    );
    clock += 700;
    release();
    await Promise.all([first, second]);
    const stats = queue.stats();
    const byLabel = new Map(stats.slowest.map((unit) => [unit.label, unit]));
    expect(byLabel.get('cosmetic')?.waitMs).toBe(0);
    expect(byLabel.get('live-gate')?.waitMs).toBe(700);
    expect(stats.worstWaitMs).toBe(700);
    // And it is readable per lane, which is what names the victim without
    // reading every unit row.
    const actionable = stats.recent.lanes.find(
      (lane) => lane.priority === GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
    );
    expect(actionable).toMatchObject({ units: 1, worstWaitMs: 700 });
  });

  // The wait alone was a symptom: it said a lane got delayed without saying by
  // what. These pin the attribution that turns it into a diagnosis.
  it('names the unit a delayed one was waiting behind', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const holder = queue.run(() => gate, GPU_WORK_PRIORITY.BACKGROUND, 'cosmetic-holder');
    await flush();
    const waiter = queue.run(
      () => {
        clock += 2;
      },
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'live-gate',
    );
    clock += 600;
    release();
    await Promise.all([holder, waiter]);
    const waits = queue.stats().longestWaits;
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({
      label: 'live-gate',
      priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      waitMs: 600,
      // The whole point: an actionable unit delayed 600 ms, and the report names
      // the cosmetic unit it sat behind instead of leaving it unattributable.
      blockedBy: 'cosmetic-holder',
      blockedByPriority: GPU_WORK_PRIORITY.BACKGROUND,
      waitedOnTailCap: false,
    });
  });

  it('marks a wait spent behind the released-tail cap', async () => {
    // The mechanism a RELEASED tail still delays a live gate with: releasing the
    // tail frees the serial slot but keeps a cap slot, and the drain loop refuses
    // to START anything while the cap is full. Without this flag that wait is
    // indistinguishable from waiting behind an ordinary holder, and the two call
    // for opposite fixes.
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, tailLimit: 1 });
    let settleLink!: () => void;
    const tail = queue.run(
      () => {
        clock += 1;
        return new Promise<void>((resolve) => {
          settleLink = resolve;
        });
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'preview:armory:skin',
      { releaseTail: true },
    );
    await flush();
    // The queue is now free of a RUNNING unit, yet the cap is full.
    expect(queue.stats().active).toBeNull();
    const waiter = queue.run(
      () => {
        clock += 2;
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
    );
    await flush();
    clock += 900;
    settleLink();
    await Promise.all([tail, waiter]);
    const wait = queue.stats().longestWaits.find((entry) => entry.label === 'live-gate');
    expect(wait).toBeDefined();
    expect(wait?.waitedOnTailCap).toBe(true);
    expect(wait?.waitMs).toBe(900);
    // And it names the occupant, so the report says WHICH lane's tail held the cap.
    expect(wait?.tails).toEqual(['preview:armory:skin']);
  });

  it('blames nothing when the queue was idle, rather than a unit that long since finished', async () => {
    // The null branch of blockedBy is the one that says "you waited on the cap
    // or on a scheduling hop, not behind a holder". Without resetting the
    // holder when the queue drains it is unreachable after the first unit of
    // the session, and the readout accuses a unit that settled arbitrarily long
    // ago: a diagnostic naming an innocent unit, inside the tool built to stop
    // exactly that.
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    await queue.run(
      () => {
        clock += 5;
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'long-gone',
    );
    await flush();
    // The queue is idle now. A later arrival that still measures a wait (a
    // scheduling hop a long task stretched) waited on nothing this queue holds.
    const pending = queue.run(() => {}, GPU_WORK_PRIORITY.ACTIONABLE_VIEW, 'late-gate');
    clock += 40;
    await pending;
    const wait = queue.stats().longestWaits.find((entry) => entry.label === 'late-gate');
    expect(wait).toBeDefined();
    expect(wait?.blockedBy).toBeNull();
    expect(wait?.blockedByPriority).toBeNull();
  });

  it('charges only the FIRST unit of a frameless burst as unshared', async () => {
    // The limitation, pinned at its real shape rather than the alarming
    // version. overlappingUnits resets only in noteFrame, so units passing
    // between two frames count their predecessors: the first is clean, every
    // later one is marked shared. worstUnsharedFrameGapMs therefore reports the
    // FIRST unit of a burst, which is rarely the worst one. That matters
    // because world entry, where the prewarm hitches live, is exactly such a
    // burst.
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(0);
    // Growing costs, so the worst unit is the LAST one and the unshared arm
    // demonstrably does not report it.
    for (const cost of [20, 40, 80, 160]) {
      await queue.run(
        () => {
          clock += cost;
        },
        GPU_WORK_PRIORITY.BOOT_DEBT,
        `boot:${cost}`,
      );
    }
    clock += 100;
    queue.noteFrame(clock);
    const stats = queue.stats();
    const first = stats.blockiest.find((unit) => unit.label === 'boot:20');
    const worst = stats.blockiest.find((unit) => unit.label === 'boot:160');
    expect(first?.sharedFrameGap).toBe(1);
    expect(worst?.sharedFrameGap).toBeGreaterThan(1);
    // The clean arm reports the first unit, not the worst: 20 ms against the
    // 160 ms one that actually dominated.
    expect(stats.worstUnsharedFrameGapMs).toBe(20);
    expect(stats.worstFrameGapMs).toBeGreaterThan(stats.worstUnsharedFrameGapMs);
  });

  it('marks a unit that arrived while the loop was ALREADY parked on the cap', async () => {
    // The arm the park counter alone cannot see. Without it a FALSE here means
    // only "no park began during my wait", so the signal could confirm a cap
    // wait but never rule one out, which is useless for the releaseTail
    // experiment it exists to settle.
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, tailLimit: 1 });
    let settleLink!: () => void;
    const tail = queue.run(
      () => {
        clock += 1;
        return new Promise<void>((resolve) => {
          settleLink = resolve;
        });
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'preview:armory:skin',
      { releaseTail: true },
    );
    await flush();
    // First arrival makes the loop park on the full cap.
    const early = queue.run(() => {}, GPU_WORK_PRIORITY.BACKGROUND, 'early');
    await flush();
    // This one arrives while that park is ALREADY under way, and the same park
    // releases both, so no counter advance happens during its wait.
    clock += 500;
    const late = queue.run(() => {}, GPU_WORK_PRIORITY.LIVE_VIEW, 'late-gate');
    clock += 300;
    settleLink();
    await Promise.all([tail, early, late]);
    const wait = queue.stats().longestWaits.find((entry) => entry.label === 'late-gate');
    expect(wait).toBeDefined();
    expect(wait?.waitedOnTailCap).toBe(true);
    expect(wait?.tails).toEqual(['preview:armory:skin']);
  });

  it('does not blame the cap for a unit enqueued from the settling tail promise', async () => {
    // The microtask order that makes this subtle: settle() resolves the unit's
    // public promise BEFORE it releases the parked loop, so a reaction to that
    // promise runs while the loop is still formally parked. A unit enqueued
    // there never waited on the cap, and reporting one would put stale
    // occupants next to it in the readout.
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, tailLimit: 1 });
    let settleLink!: () => void;
    const tail = queue.run(
      () => {
        clock += 1;
        return new Promise<void>((resolve) => {
          settleLink = resolve;
        });
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'preview:armory:skin',
      { releaseTail: true },
    );
    await flush();
    const parked = queue.run(() => {}, GPU_WORK_PRIORITY.BACKGROUND, 'parked');
    await flush();
    // Enqueue from the tail's own continuation: this is the reaction that runs
    // before the drain loop resumes. The clock advance AFTER the enqueue is
    // what gives the unit a measurable wait, so it reaches the ranking at all
    // (a zero wait is dropped, which made a first version of this test vacuous).
    const chained = tail.then(() => {
      const started = queue.run(() => {}, GPU_WORK_PRIORITY.LIVE_VIEW, 'chained');
      clock += 300;
      return started;
    });
    clock += 200;
    settleLink();
    await Promise.all([tail, parked, chained]);
    const wait = queue.stats().longestWaits.find((entry) => entry.label === 'chained');
    expect(wait).toBeDefined();
    expect(wait?.waitMs).toBe(300);
    // It waited, but not on the cap: the slot was free before it ever existed.
    expect(wait?.waitedOnTailCap).toBe(false);
    expect(wait?.tails).toEqual([]);
  });

  it('keeps units granted immediately out of the wait ranking', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    await queue.run(() => {
      clock += 5;
    }, GPU_WORK_PRIORITY.BACKGROUND);
    // A unit that never waited is not "the least delayed one", it is not a
    // member: keeping it out is what makes a short list readable.
    expect(queue.stats().longestWaits).toEqual([]);
  });

  it('reports a recent interval beside the lifetime maxima', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, recentWindowMs: 1000 });
    await queue.run(() => {
      clock += 400;
    }, GPU_WORK_PRIORITY.BACKGROUND);
    expect(queue.stats().recent).toMatchObject({ windowMs: 1000, units: 1, worstSyncMs: 400 });
    clock += 5000;
    const later = queue.stats();
    // The lifetime maximum keeps the record; the interval arm goes quiet. That
    // difference is what makes a pacing A/B readable at all.
    expect(later.worstSyncMs).toBe(400);
    expect(later.recent).toMatchObject({ units: 0, worstSyncMs: 0, lanes: [] });
  });

  it('counts a late-settling released tail in the interval it settled in', async () => {
    // The interval window is keyed on SETTLE time, not start time, and this is
    // the case that decides it. A released tail can live for seconds (a driver
    // link) and finish long after a unit that started later. Keyed on START it
    // would be filed under a moment already outside the window and vanish from
    // the interval it actually cost, and (because records arrive in settle
    // order) it would also sit unsorted behind a younger sample where the
    // prefix prune cannot reach it, inflating "recent" for the rest of the
    // session.
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, recentWindowMs: 150 });
    let settleLink!: () => void;
    const tail = queue.run(
      () => {
        clock += 5;
        return new Promise<void>((resolve) => {
          settleLink = resolve;
        });
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'released-gate',
      { releaseTail: true },
    );
    await flush();
    clock = 100;
    await queue.run(() => {
      clock += 5;
    }, GPU_WORK_PRIORITY.BACKGROUND);
    clock = 400;
    settleLink();
    await tail;
    const stats = queue.stats();
    // The BACKGROUND unit settled at 105, outside a 150 ms window ending at 400,
    // so it is correctly gone. The tail settled AT 400 and must be present.
    expect(stats.recent.units).toBe(1);
    expect(stats.recent.lanes.map((lane) => lane.priority)).toEqual([GPU_WORK_PRIORITY.LIVE_VIEW]);
    // And the lifetime counters still saw both, so nothing was lost by rolling.
    expect(stats.units).toBe(2);
  });

  it('keeps the slowest units by sync slice, bounded, defaulting the label', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, slowestLimit: 2 });
    for (const ms of [5, 30, 10, 20]) {
      await queue.run(() => {
        clock += ms;
      });
    }
    const stats = queue.stats();
    expect(stats.units).toBe(4);
    expect(stats.slowest.map((unit) => unit.syncMs)).toEqual([30, 20]);
    expect(stats.slowest[0].label).toBe('unlabeled');
    expect(stats.totalSyncMs).toBe(65);
    expect(stats.worstSyncMs).toBe(30);
  });

  // The syncMs blind spot (measured 13 August 2026): armory prewarm units
  // reported 9 to 12 ms of syncMs while costing live frames 200 to 550 ms,
  // because syncMs stops at the work function's FIRST await and everything the
  // unit blocks afterwards books in no unit at all. A lane whose whole purpose
  // is "never cost a live frame" cannot be validated by a metric that cannot
  // see the frames. These pin the frame-gap attribution that replaces it.
  it('attributes a frame gap that opens after the work function first await', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(clock);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const unit = queue.run(
      () => {
        clock += 10;
        return gate;
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'armory-skin',
    );
    await Promise.resolve();
    await Promise.resolve();
    // A live frame lands while the tail is still off-thread: nothing lost yet.
    clock += 16;
    queue.noteFrame(clock);
    // Then the tail blocks the main thread outright, so no frame runs until it
    // settles. This is the span syncMs cannot see.
    clock += 550;
    release();
    await unit;

    const stats = queue.stats();
    expect(stats.slowest[0].label).toBe('armory-skin');
    expect(stats.slowest[0].syncMs).toBe(10);
    expect(stats.slowest[0].frameGapMs).toBe(550);
    expect(stats.worstFrameGapMs).toBe(550);
  });

  it('ranks the blockiest units by frame gap, not by the sync slice', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(clock);
    // A big synchronous prologue that costs one frame.
    await queue.run(
      () => {
        clock += 40;
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'fat-prologue',
    );
    clock += 2;
    queue.noteFrame(clock);
    // A tiny prologue whose tail then blocks far longer.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sneaky = queue.run(
      () => {
        clock += 5;
        return gate;
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'sneaky-tail',
    );
    await Promise.resolve();
    await Promise.resolve();
    clock += 300;
    release();
    await sneaky;

    const stats = queue.stats();
    expect(stats.slowest[0].label).toBe('fat-prologue');
    expect(stats.blockiest[0].label).toBe('sneaky-tail');
    expect(stats.blockiest[0].frameGapMs).toBe(305);
    expect(stats.blockiest[0].syncMs).toBe(5);
  });

  it('attributes only the part of a frame gap that overlaps the unit', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(clock);
    // 200 ms of ambient stall BEFORE any unit exists: not this unit's doing.
    clock += 200;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const unit = queue.run(() => gate, GPU_WORK_PRIORITY.BACKGROUND, 'late-arrival');
    await Promise.resolve();
    await Promise.resolve();
    clock += 60;
    queue.noteFrame(clock);
    release();
    await unit;

    const stats = queue.stats();
    expect(stats.slowest[0].frameGapMs).toBe(60);
  });

  // Clamped, not dropped. Dropping was tried and made the metric non-monotone in
  // badness: the worst block in a session reported 0, fell out of `blockiest`
  // (whose membership is a positive gap), and left a smaller earlier span holding
  // the record, i.e. the worse a unit behaved the better it looked.
  it('clamps a frame gap beyond the discontinuity cap instead of dropping it', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, frameGapIgnoreMs: 1000 });
    queue.noteFrame(clock);
    let releaseSmall!: () => void;
    const small = new Promise<void>((resolve) => (releaseSmall = resolve));
    const earlier = queue.run(() => small, GPU_WORK_PRIORITY.BACKGROUND, 'ordinary-unit');
    await Promise.resolve();
    await Promise.resolve();
    clock += 400;
    releaseSmall();
    await earlier;
    clock += 5;
    queue.noteFrame(clock);

    let releaseHuge!: () => void;
    const huge = new Promise<void>((resolve) => (releaseHuge = resolve));
    const worst = queue.run(() => huge, GPU_WORK_PRIORITY.BACKGROUND, 'hidden-tab');
    await Promise.resolve();
    await Promise.resolve();
    clock += 5000;
    releaseHuge();
    await worst;

    const stats = queue.stats();
    const byLabel = Object.fromEntries(stats.slowest.map((unit) => [unit.label, unit]));
    expect(byLabel['ordinary-unit'].frameGapMs).toBe(400);
    expect(byLabel['hidden-tab'].frameGapMs).toBe(1000);
    expect(stats.worstFrameGapMs).toBe(1000);
    expect(stats.blockiest[0].label).toBe('hidden-tab');
  });

  // World entry pushes dozens of units through the queue before the frame loop
  // is armed at all, so the first noteFrame has to reset the overlap counter or
  // every boot unit stays folded into it for the whole session and every later
  // charge reads as shared. Boot is the window the prewarm hitches live in.
  it('resets the overlap counter on the first frame, so boot units do not poison it', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    // Five units drain before any frame is ever noted.
    for (let index = 0; index < 5; index++) {
      await queue.run(() => {
        clock += 2;
      });
    }
    queue.noteFrame(clock);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const alone = queue.run(() => gate, GPU_WORK_PRIORITY.BACKGROUND, 'first-live-unit');
    await Promise.resolve();
    await Promise.resolve();
    clock += 300;
    release();
    await alone;

    const stats = queue.stats();
    const unit = stats.slowest.find((entry) => entry.label === 'first-live-unit');
    expect(unit?.frameGapMs).toBe(300);
    expect(unit?.sharedFrameGap).toBe(1);
  });

  // A running max only moves on a record, and the forensics vector diffs values,
  // so a max goes silent on the second and every later occurrence of the same
  // cost: the exact empty diff this metric exists to remove.
  it('accumulates a total frame gap that keeps moving after the worst is set', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(clock);
    for (const ms of [300, 120, 120]) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const unit = queue.run(() => gate);
      await Promise.resolve();
      await Promise.resolve();
      clock += ms;
      release();
      await unit;
      clock += 5;
      queue.noteFrame(clock);
    }

    const stats = queue.stats();
    expect(stats.worstFrameGapMs).toBe(300);
    // 300 + 120 + 120: the two later units move the total while leaving the max
    // untouched, which is the whole point of carrying both.
    expect(stats.totalFrameGapMs).toBe(540);
  });

  // A released tail IS charged, and the exclusion that was briefly tried here is
  // the wrong fix: the preview prewarm lane releases its tail while doing its
  // real main-thread work there, so a tail-blind metric goes silent on the very
  // misuse it exists to expose. The ambiguity that motivated the exclusion is
  // carried by sharedFrameGap instead (pinned by the test below).
  it('charges a released tail that blocks, since its work is still main-thread', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(clock);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const unit = queue.run(
      () => {
        clock += 3;
        return gate;
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'released-gate',
      { releaseTail: true },
    );
    await Promise.resolve();
    await Promise.resolve();
    // 400 frameless milliseconds pass while only this released tail is in
    // flight, so the charge is unambiguous: nothing else could have caused it.
    clock += 400;
    release();
    await unit;

    const stats = queue.stats();
    // 403, not 400: the unit started at 0 alongside the last frame, so the whole
    // frameless span it was in flight for counts, its 3 ms prologue included.
    expect(stats.slowest[0].label).toBe('released-gate');
    expect(stats.slowest[0].frameGapMs).toBe(403);
    expect(stats.slowest[0].sharedFrameGap).toBe(1);
  });

  // The passenger case, and the one a live capture got wrong before this pin
  // existed: a long released tail is charged a gap another unit caused, and on
  // frameGapMs alone it outranks the culprit. sharedFrameGap is what separates
  // them, and it must count a unit that started AND settled inside the span,
  // which is precisely the shape of the real culprit.
  it('marks a gap shared by several in-flight units, culprit and passenger alike', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    queue.noteFrame(clock);
    let releaseLink!: () => void;
    const link = new Promise<void>((resolve) => (releaseLink = resolve));
    const gate = queue.run(
      () => {
        clock += 1;
        return link;
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    await Promise.resolve();
    await Promise.resolve();
    // A second unit starts and blocks outright while the link is still settling.
    const heavy = queue.run(
      () => {
        clock += 500;
      },
      GPU_WORK_PRIORITY.BACKGROUND,
      'heavy-prewarm',
    );
    await heavy;
    clock += 5;
    queue.noteFrame(clock);
    releaseLink();
    await gate;

    const stats = queue.stats();
    const byLabel = Object.fromEntries(stats.slowest.map((unit) => [unit.label, unit]));
    // Both are charged, and both say the charge is shared, so neither can be
    // read as proven. The sync slices then separate them: 500 against 1.
    expect(byLabel['heavy-prewarm'].frameGapMs).toBe(500);
    expect(byLabel['heavy-prewarm'].sharedFrameGap).toBe(2);
    expect(byLabel['live-gate'].sharedFrameGap).toBe(2);
    expect(byLabel['heavy-prewarm'].syncMs).toBe(500);
    expect(byLabel['live-gate'].syncMs).toBe(1);
  });

  it('reports a zero frame gap when the host never feeds the frame clock', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    await queue.run(() => {
      clock += 90;
    });

    const stats = queue.stats();
    expect(stats.slowest[0].syncMs).toBe(90);
    expect(stats.slowest[0].frameGapMs).toBe(0);
    expect(stats.worstFrameGapMs).toBe(0);
    expect(stats.blockiest).toEqual([]);
  });

  it('exposes the running unit with its age and reports none while idle', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    expect(queue.stats().active).toBeNull();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const running = queue.run(() => gate, GPU_WORK_PRIORITY.LIVE_VIEW, 'live-view-compile');
    const behind = queue.run(async () => {}, GPU_WORK_PRIORITY.BACKGROUND, 'texture-chunk');
    await Promise.resolve();
    clock += 250;

    const busy = queue.stats();
    expect(busy.active).toEqual({
      label: 'live-view-compile',
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
      ageMs: 250,
      atMs: 0,
    });
    expect(busy.pending).toBe(1);
    expect(busy.units).toBe(0);

    release();
    await Promise.all([running, behind]);
    const idle = queue.stats();
    expect(idle.active).toBeNull();
    expect(idle.pending).toBe(0);
    expect(idle.units).toBe(2);
  });

  it('records a never-settling unit past the threshold without counting it as completed', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 4000 });
    // The shape of the r165 compileAsync deadlock: the unit's promise never
    // settles, so no completion callback ever runs for it.
    void queue.run(
      () => new Promise<void>(() => {}),
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'wedged-compile',
    );
    void queue.run(async () => {}, GPU_WORK_PRIORITY.BACKGROUND, 'texture-chunk');
    await Promise.resolve();

    clock += 3999;
    expect(queue.stats().stalls).toEqual([]);
    clock += 1;
    const stalled = queue.stats();
    expect(stalled.stallCount).toBe(1);
    expect(stalled.stalls).toEqual([
      {
        label: 'wedged-compile',
        priority: GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
        ageMs: 4000,
        atMs: 0,
        settled: false,
      },
    ]);
    expect(stalled.active?.label).toBe('wedged-compile');
    expect(stalled.pending).toBe(1);
    // It is a stall, not a completed unit: nothing lands in the completed-unit
    // reporting, which is exactly why it used to be invisible.
    expect(stalled.units).toBe(0);
    expect(stalled.totalSyncMs).toBe(0);
    expect(stalled.worstSyncMs).toBe(0);
    expect(stalled.slowest).toEqual([]);

    clock += 10_000;
    const later = queue.stats();
    expect(later.stallCount).toBe(1);
    expect(later.stalls[0].ageMs).toBe(14_000);
    expect(later.stalls[0].settled).toBe(false);
    expect(later.active?.ageMs).toBe(14_000);
  });

  it('settles a stall when the unit finishes and leaves the slowest ring on sync time', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = queue.run(
      () => {
        clock += 8;
        return gate;
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      'zone-prewarm',
    );
    await Promise.resolve();
    await Promise.resolve();
    clock += 5000;
    release();
    await slow;

    const stats = queue.stats();
    expect(stats.active).toBeNull();
    expect(stats.stallCount).toBe(1);
    expect(stats.stalls).toEqual([
      {
        label: 'zone-prewarm',
        priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,
        ageMs: 5008,
        atMs: 0,
        settled: true,
      },
    ]);
    // Completed-unit reporting is unchanged: the sync slice, not the wall time,
    // still drives worstSyncMs and the slowest ring.
    expect(stats.units).toBe(1);
    expect(stats.worstSyncMs).toBe(8);
    expect(stats.slowest[0].syncMs).toBe(8);
    expect(stats.slowest[0].wallMs).toBe(5008);
  });

  it('bounds the retained stalls while counting every one of them', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 100, stallLimit: 2 });
    for (const label of ['first', 'second', 'third']) {
      await queue.run(
        () => {
          clock += 500;
        },
        GPU_WORK_PRIORITY.BACKGROUND,
        label,
      );
    }
    const stats = queue.stats();
    expect(stats.stallCount).toBe(3);
    expect(stats.stalls.map((stall) => stall.label)).toEqual(['second', 'third']);
    expect(stats.stalls.every((stall) => stall.settled)).toBe(true);
    expect(stats.units).toBe(3);
  });

  // The released-tail policy (see the tail policy header in the module): a
  // unit that DECLARES its awaited tail as an off-thread wait releases the
  // queue after its synchronous prologue, bounded by the tail cap.
  const flush = async (rounds = 12): Promise<void> => {
    for (let index = 0; index < rounds; index++) await Promise.resolve();
  };

  it('releases a declared wait-only tail so lower-priority lanes keep draining', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let settleLink!: () => void;
    const gated = queue.run(
      () => {
        events.push('gate:prologue');
        return new Promise<string>((resolve) => {
          settleLink = () => resolve('linked');
        });
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    const upload = queue.run(
      async () => {
        events.push('upload');
      },
      GPU_WORK_PRIORITY.VISIBLE_PREWARM,
      'texture-chunk-upload',
    );

    await flush();
    // The upload no longer waits out the link; the gate itself is still pending.
    expect(events).toEqual(['gate:prologue', 'upload']);
    await upload;
    settleLink();
    await expect(gated).resolves.toBe('linked');
  });

  it('lets a higher-priority unit run to completion while a slow gate link settles', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    let settleLink!: () => void;
    let gateSettled = false;
    const gated = queue
      .run(
        () =>
          new Promise<void>((resolve) => {
            settleLink = resolve;
          }),
        GPU_WORK_PRIORITY.LIVE_VIEW,
        'slow-live-gate',
        { releaseTail: true },
      )
      .then(() => {
        gateSettled = true;
      });
    await flush();
    const actionable = queue.run(
      async () => {
        events.push('actionable');
      },
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'actionable-gate',
    );

    await actionable;
    expect(events).toEqual(['actionable']);
    expect(gateSettled).toBe(false);
    settleLink();
    await gated;
    expect(gateSettled).toBe(true);
  });

  it('caps concurrent released tails and resumes, by priority, when one settles', async () => {
    const queue = createBackgroundGpuQueue({ tailLimit: 2 });
    const events: string[] = [];
    const links: Array<() => void> = [];
    const gate = (name: string) =>
      queue.run(
        () => {
          events.push(`${name}:prologue`);
          return new Promise<void>((resolve) => {
            links.push(resolve);
          });
        },
        GPU_WORK_PRIORITY.LIVE_VIEW,
        name,
        { releaseTail: true },
      );
    const first = gate('first');
    const second = gate('second');
    await flush();
    expect(events).toEqual(['first:prologue', 'second:prologue']);

    const third = gate('third');
    const actionable = queue.run(
      async () => {
        events.push('actionable');
      },
      GPU_WORK_PRIORITY.ACTIONABLE_VIEW,
      'actionable-gate',
    );
    await flush();
    // Two tails in flight fill the cap: NOTHING else starts, not even the
    // higher-priority unit (the cap is what bounds concurrent driver work).
    // The documented cap-limited readout is the triple: pending grows,
    // active null, waitingTails full.
    expect(events).toEqual(['first:prologue', 'second:prologue']);
    const capped = queue.stats();
    expect(capped.pending).toBe(2);
    expect(capped.active).toBeNull();
    expect(capped.waitingTails.map((tail) => tail.label)).toEqual(['first', 'second']);

    links[0]();
    await flush();
    // One slot freed: the actionable unit outranks the older third gate.
    expect(events).toEqual(['first:prologue', 'second:prologue', 'actionable', 'third:prologue']);

    links[1]();
    links[2]();
    await Promise.all([first, second, third, actionable]);
    expect(queue.stats().waitingTails).toEqual([]);
  });

  it('caps released tails at 2 by default: the snapshot-burst bound', async () => {
    const queue = createBackgroundGpuQueue();
    const events: string[] = [];
    const links: Array<() => void> = [];
    for (const name of ['first', 'second', 'third']) {
      void queue.run(
        () => {
          events.push(`${name}:prologue`);
          return new Promise<void>((resolve) => {
            links.push(resolve);
          });
        },
        GPU_WORK_PRIORITY.LIVE_VIEW,
        name,
        { releaseTail: true },
      );
    }
    await flush();
    // No tailLimit override: the DEFAULT cap must hold the third gate.
    expect(events).toEqual(['first:prologue', 'second:prologue']);
    links[0]();
    await flush();
    expect(events).toEqual(['first:prologue', 'second:prologue', 'third:prologue']);
    links[1]();
    links[2]();
    await flush();
    expect(queue.stats().waitingTails).toEqual([]);
  });

  it('runs a releaseTail unit returning a non-promise through the normal serial path', async () => {
    const queue = createBackgroundGpuQueue();
    const value = await queue.run(() => 42, GPU_WORK_PRIORITY.LIVE_VIEW, 'sync-gate', {
      releaseTail: true,
    });
    expect(value).toBe(42);
    const stats = queue.stats();
    expect(stats.units).toBe(1);
    expect(stats.waitingTails).toEqual([]);
  });

  it('rejects a hostile thenable whose then throws without leaking a cap slot', async () => {
    const queue = createBackgroundGpuQueue();
    const hostile = {
      // biome-ignore lint/suspicious/noThenProperty: a deliberately broken thenable is the test subject
      then() {
        throw new Error('broken thenable');
      },
    };
    const gated = queue.run(
      () => hostile as unknown as Promise<void>,
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'hostile-gate',
      { releaseTail: true },
    );
    const later = queue.run(async () => 'later');
    await expect(gated).rejects.toThrow('broken thenable');
    await expect(later).resolves.toBe('later');
    const stats = queue.stats();
    expect(stats.waitingTails).toEqual([]);
    expect(stats.units).toBe(2);
  });

  it('records a releaseTail unit that throws synchronously and keeps draining', async () => {
    const queue = createBackgroundGpuQueue();
    const failed = queue.run(
      () => {
        throw new Error('prologue failed');
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'throwing-gate',
      { releaseTail: true },
    );
    const later = queue.run(async () => 'later');
    await expect(failed).rejects.toThrow('prologue failed');
    await expect(later).resolves.toBe('later');
    const stats = queue.stats();
    expect(stats.units).toBe(2);
    expect(stats.waitingTails).toEqual([]);
  });

  it('records a released unit on settle, keeping sync and wall time separate', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock });
    let settleLink!: () => void;
    const gated = queue.run(
      () => {
        clock += 3;
        return new Promise<void>((resolve) => {
          settleLink = resolve;
        });
      },
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    await flush();
    const inFlight = queue.stats();
    expect(inFlight.units).toBe(0);
    expect(inFlight.active).toBeNull();
    expect(inFlight.waitingTails).toEqual([
      { label: 'live-gate', priority: GPU_WORK_PRIORITY.LIVE_VIEW, ageMs: 3, atMs: 0 },
    ]);

    clock += 7000;
    settleLink();
    await gated;
    const stats = queue.stats();
    expect(stats.units).toBe(1);
    expect(stats.waitingTails).toEqual([]);
    expect(stats.slowest[0]).toEqual({
      label: 'live-gate',
      priority: GPU_WORK_PRIORITY.LIVE_VIEW,
      syncMs: 3,
      wallMs: 7003,
      atMs: 0,
      waitMs: 0,
      // Zero because this suite never feeds the frame clock, which is the
      // honest reading: nothing here observed a frame to lose, so nothing was
      // charged and no span was shared.
      frameGapMs: 0,
      sharedFrameGap: 0,
    });
    // A multi-second link is still a recorded stall, settled: the release
    // changes who waits behind it, not whether it is worth seeing.
    expect(stats.stallCount).toBe(1);
    expect(stats.stalls[0]).toMatchObject({ label: 'live-gate', settled: true, ageMs: 7003 });
  });

  it('propagates a released tail rejection and keeps draining', async () => {
    const queue = createBackgroundGpuQueue();
    let failLink!: (error: Error) => void;
    const gated = queue.run(
      () =>
        new Promise<void>((_resolve, reject) => {
          failLink = reject;
        }),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'failing-gate',
      { releaseTail: true },
    );
    const later = queue.run(async () => 'later');
    await flush();
    failLink(new Error('link failed'));
    await expect(gated).rejects.toThrow('link failed');
    await expect(later).resolves.toBe('later');
    // The reject arm still runs the full settle bookkeeping: the failed unit
    // is recorded and its cap slot is released, never leaked.
    const stats = queue.stats();
    expect(stats.waitingTails).toEqual([]);
    expect(stats.units).toBe(2);
  });

  it('records an unsettled released tail as a stall while active stays null: the wedge readout', async () => {
    let clock = 0;
    const queue = createBackgroundGpuQueue({ now: () => clock, stallMs: 4000 });
    // The r165 compileAsync deadlock shape, now on the RELEASED path (every
    // compile gate declares releaseTail): the tail never settles, the drain
    // loop is free, so active is null and the tail list plus the stall record
    // are the only evidence.
    void queue.run(
      () => new Promise<void>(() => {}),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'wedged-released',
      { releaseTail: true },
    );
    await flush();
    clock += 10_000;
    const stats = queue.stats();
    expect(stats.active).toBeNull();
    expect(stats.waitingTails).toEqual([
      { label: 'wedged-released', priority: GPU_WORK_PRIORITY.LIVE_VIEW, ageMs: 10_000, atMs: 0 },
    ]);
    expect(stats.stallCount).toBe(1);
    expect(stats.stalls).toEqual([
      {
        label: 'wedged-released',
        priority: GPU_WORK_PRIORITY.LIVE_VIEW,
        ageMs: 10_000,
        atMs: 0,
        settled: false,
      },
    ]);
    expect(stats.units).toBe(0);
  });

  it('survives a shutdown that empties pending while the drain is parked on the tail cap', async () => {
    const queue = createBackgroundGpuQueue({ tailLimit: 2 });
    const links: Array<() => void> = [];
    const gate = (name: string) =>
      queue.run(
        () =>
          new Promise<void>((resolve) => {
            links.push(resolve);
          }),
        GPU_WORK_PRIORITY.LIVE_VIEW,
        name,
        { releaseTail: true },
      );
    const first = gate('first');
    const second = gate('second');
    await flush();
    // Cap saturated; this unit parks the drain loop on the tail-cap wait.
    const parked = queue.run(async () => 'parked', GPU_WORK_PRIORITY.LIVE_VIEW, 'parked');
    await flush();

    const shutdownError = new Error('renderer generation ended');
    const parkedRejected = expect(parked).rejects.toBe(shutdownError);
    let shutdownDone = false;
    const shutdown = queue.shutdown(shutdownError).then(() => {
      shutdownDone = true;
    });
    await flush();
    expect(shutdownDone).toBe(false);

    // The tails settle AFTER shutdown spliced pending: the resumed drain must
    // observe the emptied queue instead of dereferencing a missing unit, and
    // shutdown must still resolve once both tails settle.
    links[0]();
    links[1]();
    await Promise.all([first, second, parkedRejected, shutdown]);
    expect(shutdownDone).toBe(true);
    expect(queue.stats().waitingTails).toEqual([]);
    expect(queue.stats().units).toBe(2);
  });

  it('shutdown resolves only after released tails settle', async () => {
    const queue = createBackgroundGpuQueue();
    let settleLink!: () => void;
    const gated = queue.run(
      () =>
        new Promise<void>((resolve) => {
          settleLink = resolve;
        }),
      GPU_WORK_PRIORITY.LIVE_VIEW,
      'live-gate',
      { releaseTail: true },
    );
    await flush();
    let shutdownDone = false;
    const shutdown = queue.shutdown().then(() => {
      shutdownDone = true;
    });
    await flush();
    expect(shutdownDone).toBe(false);
    settleLink();
    await Promise.all([gated, shutdown]);
    expect(shutdownDone).toBe(true);
  });

  it('wires sky, feature, archetype, and boot-resume units through one renderer queue', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const method = (startText: string, endText: string): string => {
      const start = source.indexOf(startText);
      const end = source.indexOf(endText, start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };
    const sky = method('private async prepareZoneSky(', '\n  /**\n   * Materialize the terrain');
    const features = method('prepareZoneAt(', '\n  /** Stage wall-times');
    const archetypes = method('async prewarmZoneAt(', '\n  /** Blocking-path neighborhood prepare');
    const texture = method('private prewarmTextureInIdle(', '\n  private prewarmMaterialTextures(');
    const initial = method('async prewarmInitialScene(', '\n  // Visual reactions to sim events');
    expect(source).toContain('private backgroundGpuWork = createBackgroundGpuQueue()');
    expect(sky).toContain('this.backgroundGpuWork.run(');
    expect(features).toContain('this.backgroundGpuWork.run(');
    expect(archetypes).toContain('this.backgroundGpuWork.run(');
    expect(texture).toContain('this.backgroundGpuWork.run(');
    expect(initial).toContain(
      'return this.backgroundGpuWork.run(\n                unit.run,\n                debt ? GPU_WORK_PRIORITY.BOOT_DEBT : GPU_WORK_PRIORITY.BOOT_RESUME,\n                unit.id,',
    );
    // Debt batches hold their tail (serial, settled-before-next) so the
    // driver link queue stays shallow; only cosmetic resume releases it.
    expect(initial).toContain('releaseTail: !debt,');
    // The class decision itself must stay wired to the owning entry: with
    // `const debt = false` (or the wrong id) every priority claim above
    // silently degrades to BOOT_RESUME with the suite green (QA finding B1).
    expect(initial).toContain('const debt = prewarmResumeIsDebt(entry.id);');
    // The frame clock is a SINGLE call site whose failure mode is silent good
    // news: drop it, or let an early return get in front of it, and every unit
    // reports frameGapMs 0 and an empty blockiest, which reads as "the lane cost
    // no frames" rather than as "nobody measured". Nothing else in the suite can
    // see that, because every behavior test drives noteFrame by hand.
    // The resume ledger's `started` means "handed to the queue", not "finished".
    // That semantic lives ONLY at the call site: move noteStart into the unit's
    // completion continuation and the counter silently inverts its meaning while
    // every unit test stays green, because the ledger itself is just arithmetic.
    const runUnit = initial.slice(initial.indexOf('runUnit: (unit, entry) => {'));
    const noteAt = runUnit.indexOf('resumeLedger.noteStart(entry.id);');
    const runAt = runUnit.indexOf('return this.backgroundGpuWork.run(');
    expect(noteAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(noteAt);

    const sync = method('  sync(\n', '\n    const frameStats = this.lastFrameStats;');
    expect(sync).toContain('this.backgroundGpuWork.noteFrame(');
    // After the shutdown guard: a torn-down renderer must stop the frame clock
    // rather than keep charging units that settle during teardown.
    expect(sync.indexOf('if (this.shutdownStarted) return;')).toBeLessThan(
      sync.indexOf('this.backgroundGpuWork.noteFrame('),
    );
  });
});
