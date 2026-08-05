// The bot's loop scheduler: the pure decision core (overlap, coalescing, idle
// backoff, jitter) and the driver that chains one timeout after another.
//
// Every timing case here drives the virtual clock from tests/helpers/synthetic_clock.ts
// and asserts the ABSOLUTE virtual time each run happened at. Orderings and lower
// bounds are deliberately absent: `>= 2000` also passes for a scheduler that waited
// ten minutes, so it pins nothing about the cadence this file exists to guarantee.
//
// Vitest fake timers are deliberately not used (see the synthetic clock's header): a
// clock captured at construction does not move under them, and a fractional delay is
// allowed to fire EARLY, so a jittered delay of 900.0 could land at 899 and the band
// assertions below would be unfalsifiable.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  beginRun,
  DEFAULT_IDLE_DECAY,
  DEFAULT_JITTER_RATIO,
  endRun,
  initialRunState,
  jitteredDelayMs,
  LoopScheduler,
  MAX_JITTER_RATIO,
  MIN_INTERVAL_MS,
  nextIntervalMs,
  requestKick,
  resolveCadence,
  type ScheduledTask,
  type SchedulerTimerHandle,
  type SchedulerTimers,
  type TaskCadence,
} from '../bot/scheduler';
import { type SyntheticClock, syntheticClock } from './helpers/synthetic_clock';

/**
 * A SchedulerTimers backed entirely by virtual time. Its sleep ADVANCES now(),
 * which the synthetic clock guarantees by construction: a hand-rolled rig whose
 * sleep leaves now() alone makes a gate loop starve the macrotask queue, so the
 * run HANGS rather than failing and no test timeout ever fires.
 */
function clockTimers(clock: SyntheticClock): SchedulerTimers {
  let nextId = 1;
  const cancelled = new Set<number>();
  return {
    setTimeout(cb: () => void, ms: number): SchedulerTimerHandle {
      const id = nextId++;
      void clock.sleep(ms).then(() => {
        if (!cancelled.has(id)) cb();
      });
      return id;
    },
    clearTimeout(handle: SchedulerTimerHandle): void {
      cancelled.add(handle as number);
    },
  };
}

/** A promise resolved by hand, so a run can be held open across clock advances. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolveIt) => {
    release = (): void => resolveIt();
  });
  return { promise, resolve: () => release() };
}

/** The D1 shape for the future outbox: 3 s active decaying to 15 s idle. */
const OUTBOX: TaskCadence = { activeMs: 3000, idleMs: 15_000 };

describe('scheduler cadence math', () => {
  it('pins the exported defaults against literals', () => {
    // Against LITERALS, never against themselves: driving a case BY a constant and
    // asserting AGAINST it is a self-comparison that passes for any value.
    expect(DEFAULT_IDLE_DECAY).toBe(2);
    expect(DEFAULT_JITTER_RATIO).toBe(0.1);
  });

  it('fills the cadence defaults and starts a task at its active interval', () => {
    expect(resolveCadence({ activeMs: 3000 })).toEqual({
      activeMs: 3000,
      idleMs: 3000,
      decay: 2,
    });
    // A decay override that is NOT the fallback, so the case can actually fail.
    expect(resolveCadence({ activeMs: 3000, idleMs: 15_000, decay: 3 })).toEqual({
      activeMs: 3000,
      idleMs: 15_000,
      decay: 3,
    });
    // Below 1 would SHRINK the interval on an empty run, so it falls back.
    expect(resolveCadence({ activeMs: 3000, decay: 0.5 }).decay).toBe(2);
    expect(initialRunState(OUTBOX)).toEqual({
      running: false,
      kickPending: false,
      intervalMs: 3000,
    });
  });

  it('falls back to MIN_INTERVAL_MS rather than 0 for an unusable active interval', () => {
    // The worst failure this module can have: an interval of 0 arms a zero-delay
    // timeout whose callback arms another, which is a hot spin that starves the
    // macrotask queue and WEDGES the process instead of failing. Every unusable
    // shape has to land on the floor, not on zero.
    expect(MIN_INTERVAL_MS).toBe(1000);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(resolveCadence({ activeMs: bad as unknown as number }).activeMs).toBe(MIN_INTERVAL_MS);
      expect(resolveCadence({ activeMs: bad as unknown as number }).activeMs).not.toBe(0);
    }
    // A valid value is passed through UNTOUCHED, however small: the floor is a
    // fallback, not a clamp, so a D13 operator override is never silently changed.
    expect(resolveCadence({ activeMs: 250 }).activeMs).toBe(250);
  });

  it('snaps back to the active interval whenever a run did work', () => {
    expect(nextIntervalMs(15_000, OUTBOX, true)).toBe(3000);
    expect(nextIntervalMs(6000, OUTBOX, true)).toBe(3000);
  });

  it('decays an idle interval by the decay factor and CLAMPS at the idle ceiling', () => {
    // Driven until the clamp is actually REACHED: a bound test that stops short of
    // its bound is constant-true and would pass with the clamp deleted.
    expect(nextIntervalMs(3000, OUTBOX, false)).toBe(6000);
    expect(nextIntervalMs(6000, OUTBOX, false)).toBe(12_000);
    expect(nextIntervalMs(12_000, OUTBOX, false)).toBe(15_000);
    // And it STAYS there rather than creeping past on the next empty run.
    expect(nextIntervalMs(15_000, OUTBOX, false)).toBe(15_000);
  });

  it('honors a decay override different from the default', () => {
    const cadence: TaskCadence = { activeMs: 3000, idleMs: 15_000, decay: 3 };
    expect(nextIntervalMs(3000, cadence, false)).toBe(9000);
    expect(nextIntervalMs(9000, cadence, false)).toBe(15_000);
  });

  it('does not decay at all when the idle interval is not above the active one', () => {
    expect(nextIntervalMs(5000, { activeMs: 5000 }, false)).toBe(5000);
    expect(nextIntervalMs(5000, { activeMs: 5000, idleMs: 2000 }, false)).toBe(5000);
  });
});

describe('scheduler jitter band', () => {
  it('maps the unit draw onto the exact edges and center of the band', () => {
    expect(jitteredDelayMs(1000, 0.1, 0)).toBe(900);
    expect(jitteredDelayMs(1000, 0.1, 0.5)).toBe(1000);
    expect(jitteredDelayMs(1000, 0.1, 1)).toBe(1100);
    expect(jitteredDelayMs(1000, 0.1, 0.999)).toBeCloseTo(1099.8, 6);
  });

  it('returns the base exactly when the ratio is zero', () => {
    expect(jitteredDelayMs(1000, 0, 0)).toBe(1000);
    expect(jitteredDelayMs(1000, 0, 1)).toBe(1000);
  });

  it('never returns a negative, zero or non-finite delay for a usable base', () => {
    // The band's LOWER EDGE is the hazard: at a ratio of 1 it is exactly zero, and
    // a zero delay arms a timeout whose callback arms another, which is a hot spin
    // that wedges the process rather than failing. MIN_INTERVAL_MS does not cover
    // this, because it floors the BASE and the jitter is applied after it.
    expect(MAX_JITTER_RATIO).toBe(0.5);
    expect(jitteredDelayMs(1000, 1, 0)).toBe(500); // clamped to MAX_JITTER_RATIO
    expect(jitteredDelayMs(1000, 5, 0)).toBe(500);
    // A ratio at the ceiling still never bottoms out at zero, for any draw.
    for (const draw of [0, 0.25, 0.5, 0.75, 1]) {
      expect(jitteredDelayMs(1000, MAX_JITTER_RATIO, draw)).toBeGreaterThanOrEqual(500);
    }
    // A negative or non-finite ratio means no jitter at all, never a negative band.
    expect(jitteredDelayMs(1000, -0.3, 0)).toBe(1000);
    expect(jitteredDelayMs(1000, Number.NaN, 0)).toBe(1000);
    // Infinity is NOT finite, so it takes the same no-jitter branch as NaN rather
    // than the MAX_JITTER_RATIO clamp: only a finite over-large ratio is clamped.
    expect(jitteredDelayMs(1000, Number.POSITIVE_INFINITY, 0)).toBe(1000);
    // An unusable BASE has no sensible delay to produce, so it yields 0 and the
    // caller's own floor is what keeps that off a timer.
    expect(jitteredDelayMs(-5, 0.1, 0)).toBe(0);
    expect(jitteredDelayMs(Number.POSITIVE_INFINITY, 0.1, 0)).toBe(0);
    expect(jitteredDelayMs(Number.NaN, 0.1, 0)).toBe(0);
    // A broken random source degrades to the CENTER, never to a zero delay.
    expect(jitteredDelayMs(1000, 0.1, Number.NaN)).toBe(1000);
  });
});

describe('scheduler run state', () => {
  it('refuses a second concurrent claim on the same task', () => {
    const first = beginRun(initialRunState(OUTBOX));
    expect(first.started).toBe(true);
    expect(first.state.running).toBe(true);
    const second = beginRun(first.state);
    expect(second.started).toBe(false);
    expect(second.state).toBe(first.state);
  });

  it('runs a kick immediately when idle and defers it while a run is in flight', () => {
    const idle = initialRunState(OUTBOX);
    const immediate = requestKick(idle);
    expect(immediate.runNow).toBe(true);
    expect(immediate.state.kickPending).toBe(false);

    const running = beginRun(idle).state;
    const deferredKick = requestKick(running);
    expect(deferredKick.runNow).toBe(false);
    expect(deferredKick.state.kickPending).toBe(true);
  });

  it('collapses N kicks during one run into exactly one follow-up', () => {
    let state = beginRun(initialRunState(OUTBOX)).state;
    for (let i = 0; i < 5; i++) state = requestKick(state).state;
    expect(state.kickPending).toBe(true);

    const first = endRun(state, OUTBOX, true);
    expect(first.followUpNow).toBe(true);
    // Cleared in the returned state, so the follow-up cannot fire a second time.
    expect(first.state.kickPending).toBe(false);
    expect(first.state.running).toBe(false);

    const second = endRun(first.state, OUTBOX, true);
    expect(second.followUpNow).toBe(false);
  });

  it('carries the decayed interval out of an empty run and the active one out of work', () => {
    const started = beginRun(initialRunState(OUTBOX)).state;
    expect(endRun(started, OUTBOX, false).state.intervalMs).toBe(6000);
    expect(endRun(started, OUTBOX, true).state.intervalMs).toBe(3000);
  });
});

describe('scheduler driver', () => {
  it('never starts a second run while one is still in flight', async () => {
    const clock = syntheticClock();
    const gate = deferred();
    let runs = 0;
    let concurrent = 0;
    let peakConcurrent = 0;
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'slow-sweep',
      cadence: { activeMs: 1000 },
      run: async () => {
        runs++;
        concurrent++;
        peakConcurrent = Math.max(peakConcurrent, concurrent);
        await gate.promise;
        concurrent--;
        return true;
      },
    });
    expect(scheduler.size).toBe(1);

    task.start();
    await clock.advanceTo(1000);
    expect(runs).toBe(1);

    // Ten whole intervals pass with the run still open. A repeating interval timer
    // would have stacked ten more sweeps by here.
    await clock.advanceTo(11_000);
    expect(runs).toBe(1);
    // A kick mid-run cannot open a second door into the run either.
    task.kick();
    expect(runs).toBe(1);
    expect(peakConcurrent).toBe(1);

    gate.resolve();
    await clock.advanceTo(11_000);
    // The pending kick is the follow-up, and it runs at once rather than waiting.
    expect(runs).toBe(2);
    task.stop();
  });

  it('collapses several kicks during one run into exactly one extra run', async () => {
    const clock = syntheticClock();
    const gate = deferred();
    const runAt: number[] = [];
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'guild-create-storm',
      cadence: { activeMs: 1000 },
      run: async () => {
        runAt.push(clock.now());
        if (runAt.length === 1) await gate.promise;
        return true;
      },
    });

    task.start();
    await clock.advanceTo(1000);
    expect(runAt).toEqual([1000]);

    // The GUILD_CREATE trap: Discord re-sends it on every re-IDENTIFY, so a
    // reconnect storm delivers a burst of kicks against one in-flight sweep.
    task.kick();
    task.kick();
    task.kick();
    gate.resolve();
    await clock.advanceTo(1000);
    // Exactly two, not "at least two": four kicks against one run are one follow-up.
    expect(runAt).toEqual([1000, 1000]);
    task.stop();
  });

  it('walks the cadence toward idle across real runs, and snaps back on work', async () => {
    // The pure decay is pinned above; this is the DRIVER actually using it, which
    // is the only thing that can catch the work signal being read backwards. The
    // random source is the band centre, so every delay is exactly the interval and
    // these are cadences rather than jittered samples of them.
    const clock = syntheticClock();
    const runAt: number[] = [];
    let work = false;
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'outbox',
      cadence: OUTBOX,
      run: async () => {
        runAt.push(clock.now());
        return work;
      },
    });

    task.start();
    // 3000 active, then each empty run doubles the wait: +6000, +12000, then the
    // 15000 ceiling, and it STAYS there rather than creeping past.
    await clock.advanceTo(3000);
    expect(runAt).toEqual([3000]);
    await clock.advanceTo(9000);
    expect(runAt).toEqual([3000, 9000]);
    await clock.advanceTo(21_000);
    expect(runAt).toEqual([3000, 9000, 21_000]);
    await clock.advanceTo(36_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000]);
    expect(task.intervalMs()).toBe(15_000);

    // One run that finds work puts the loop straight back on its active cadence,
    // so the next is 3000 later and not another idle window.
    work = true;
    await clock.advanceTo(51_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000, 51_000]);
    expect(task.intervalMs()).toBe(3000);
    await clock.advanceTo(54_000);
    expect(runAt).toEqual([3000, 9000, 21_000, 36_000, 51_000, 54_000]);
    task.stop();
  });

  it('chains the next run only after the previous one settles', async () => {
    const clock = syntheticClock();
    const runAt: number[] = [];
    // 0.5 is the band's center, so every delay is exactly the base interval and the
    // times below are the cadence itself rather than a jittered sample of it.
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'relay',
      cadence: { activeMs: 1000 },
      run: async () => {
        runAt.push(clock.now());
        return true;
      },
    });

    scheduler.startAll();
    // The first delay is armed at start, and each later one only after the previous
    // run settles: three runs exactly one interval apart, not a fixed 0/1000/2000
    // rhythm laid down in advance.
    await clock.advanceTo(3000);
    expect(runAt).toEqual([1000, 2000, 3000]);
    // Work every time, so the interval never left the active cadence.
    expect(task.intervalMs()).toBe(1000);
    scheduler.stopAll();
  });

  it('catches a throwing run, counts it as no work, and keeps the chain alive', async () => {
    const clock = syntheticClock();
    const runAt: number[] = [];
    const errors: Array<{ message: string; name: string }> = [];
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'role-sync',
      cadence: { activeMs: 1000, idleMs: 8000 },
      run: async () => {
        runAt.push(clock.now());
        throw new Error('discord said no');
      },
      onError: (error, name) => {
        errors.push({ message: (error as Error).message, name });
      },
    });

    task.start();
    await clock.advanceTo(1000);
    expect(runAt).toEqual([1000]);
    expect(errors).toEqual([{ message: 'discord said no', name: 'role-sync' }]);
    // No work, so the interval decays rather than hammering a failing endpoint.
    expect(task.intervalMs()).toBe(2000);

    // And the chain continues: the next run lands one DECAYED interval later.
    await clock.advanceTo(3000);
    expect(runAt).toEqual([1000, 3000]);
    expect(task.intervalMs()).toBe(4000);
    task.stop();
  });

  it('stops cleanly before a run and while a run is in flight', async () => {
    const clock = syntheticClock();
    const runAt: number[] = [];
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const idle = scheduler.add({
      name: 'never-runs',
      cadence: { activeMs: 1000 },
      run: async () => {
        runAt.push(clock.now());
        return true;
      },
    });
    idle.start();
    idle.stop();
    await clock.advanceTo(10_000);
    expect(runAt).toEqual([]);

    const gate = deferred();
    const inFlightAt: number[] = [];
    const scheduler2 = new LoopScheduler(clockTimers(clock), () => 0.5);
    const busy = scheduler2.add({
      name: 'stops-mid-run',
      cadence: { activeMs: 1000 },
      run: async () => {
        inFlightAt.push(clock.now());
        await gate.promise;
        return true;
      },
    });
    busy.start();
    await clock.advanceTo(11_000);
    expect(inFlightAt).toEqual([11_000]);

    // The kick lands FIRST, while the task is still live, so a follow-up really is
    // pending when stop() arrives: this reaches the followUpNow branch of the
    // settle, which stopping with nothing pending would not.
    //
    // Honest limit, corrected in the third mutation round: this case does NOT pin
    // the in-flight GENERATION check, and an earlier comment here claimed it did.
    // Deleting either half of that check survives, because the task stays stopped
    // and `!this.active` settles the run on its own. The generation is only
    // load bearing once a restart makes `active` true again while a stale run is
    // still in flight, which is a separate case in the lifecycle block below.
    busy.kick();
    busy.stop();
    // And a kick after stop is ignored outright.
    busy.kick();
    gate.resolve();
    await clock.advanceTo(40_000);
    expect(inFlightAt).toEqual([11_000]);
  });

  it('spreads two loops on the same interval across the exact jitter band', async () => {
    const clock = syntheticClock();
    const draws = [0, 1];
    let drawn = 0;
    const runAt = new Map<string, number[]>();
    const scheduler = new LoopScheduler(clockTimers(clock), () => draws[drawn++] ?? 0.5);
    for (const name of ['alpha', 'beta']) {
      runAt.set(name, []);
      scheduler.add({
        name,
        cadence: { activeMs: 1000 },
        run: async () => {
          (runAt.get(name) as number[]).push(clock.now());
          return true;
        },
      });
    }
    expect(scheduler.size).toBe(2);

    scheduler.startAll();
    // The band's edges for base 1000 at the default ratio: 900 and 1100. Two loops
    // armed in the same boot would otherwise stay phase-locked forever.
    await clock.advanceTo(1100);
    expect(runAt.get('alpha')).toEqual([900]);
    expect(runAt.get('beta')).toEqual([1100]);
    scheduler.stopAll();
    await clock.advanceTo(20_000);
    expect(runAt.get('alpha')).toEqual([900]);
    expect(runAt.get('beta')).toEqual([1100]);
  });

  it('refuses a duplicate task name rather than leaking the replaced timer', () => {
    const scheduler = new LoopScheduler(clockTimers(syntheticClock()), () => 0.5);
    const options = { name: 'relay', cadence: { activeMs: 1000 }, run: async () => true };
    scheduler.add(options);
    // An Error instance, not a string: rejects/toThrow against a string is a
    // SUBSTRING match, which passes for a message that merely contains it.
    expect(() => scheduler.add(options)).toThrow(
      new Error('[bot] scheduler already has a task named relay'),
    );
    expect(scheduler.size).toBe(1);
  });

  it('refuses a task whose active interval is not positive, loudly at wiring time', () => {
    // The complement of the MIN_INTERVAL_MS fallback. The fallback keeps the pure
    // helpers safe; this makes a wiring bug (a lost config value reaching add as
    // undefined or 0) fail at boot rather than run at a cadence nobody chose.
    const scheduler = new LoopScheduler(clockTimers(syntheticClock()), () => 0.5);
    for (const bad of [0, -5, Number.NaN, undefined]) {
      expect(() =>
        scheduler.add({
          name: `bad-${String(bad)}`,
          cadence: { activeMs: bad as unknown as number },
          run: async () => true,
        }),
      ).toThrow(new Error(`[bot] scheduler task bad-${String(bad)} needs a positive activeMs`));
    }
    // Nothing was registered, so a refused task cannot leave a half-built entry
    // behind that a later startAll would arm.
    expect(scheduler.size).toBe(0);
  });

  it('forwards to the ambient timers, and unrefs, when no timers are injected', () => {
    // Constructed BEFORE the globals are stubbed: stub-then-construct would also
    // pass for a default that CAPTURED the global, so it would not guard the rule.
    const scheduler = new LoopScheduler();
    const task = scheduler.add({
      name: 'default-path',
      cadence: { activeMs: 1000 },
      jitterRatio: 0,
      run: async () => true,
    });

    const armed: Array<{ ms: number; callable: boolean }> = [];
    const cleared: unknown[] = [];
    let unrefs = 0;
    const handle = {
      unref: (): void => {
        unrefs++;
      },
    };
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((cb: () => void, ms: number) => {
      armed.push({ ms, callable: typeof cb === 'function' });
      return handle;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = ((h: unknown) => {
      cleared.push(h);
    }) as unknown as typeof globalThis.clearTimeout;
    try {
      task.start();
      task.stop();
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }

    // BOTH arguments, not just the first: a one-parameter stub type-checks against
    // an arity-reduced forward and would hide a dropped delay.
    expect(armed).toEqual([{ ms: 1000, callable: true }]);
    expect(cleared).toEqual([handle]);
    expect(unrefs).toBe(1);
  });

  it('forwards to a real random source when none is injected', () => {
    // The case above pins jitterRatio to 0, which makes the delay 1000 for EVERY
    // possible draw, so it says nothing at all about the default random source:
    // replacing `() => Math.random()` with `() => Number.NaN` survived it. Here
    // the ratio is the real default, so the draw has to land in the band, and a
    // non-finite draw would fall back to the centre and never vary.
    const armed: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((_cb: () => void, ms: number) => {
      armed.push(ms);
      return 0;
    }) as unknown as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => {}) as unknown as typeof globalThis.clearTimeout;
    try {
      // Many tasks, because one draw could land anywhere in the band by chance;
      // what no broken source can fake is a SPREAD of distinct values.
      const scheduler = new LoopScheduler();
      for (let i = 0; i < 40; i++) {
        scheduler
          .add({ name: `t${i}`, cadence: { activeMs: 1000 }, run: async () => true })
          .start();
      }
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }

    expect(armed).toHaveLength(40);
    // Every delay inside the exact default band, and none of them the bare base.
    for (const ms of armed) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(1000 * (1 - DEFAULT_JITTER_RATIO));
      expect(ms).toBeLessThanOrEqual(1000 * (1 + DEFAULT_JITTER_RATIO));
    }
    // And the whole point of jitter: the loops do NOT all land on the same tick.
    // A constant or non-finite draw collapses this to one value.
    expect(new Set(armed).size).toBeGreaterThan(1);
  });
});

describe('scheduler purity', () => {
  it('reads no clock and arms no repeating timer of its own', () => {
    const source = readFileSync(new URL('../bot/scheduler.ts', import.meta.url), 'utf8');
    // Comments are stripped first (block, then line) so prose ABOUT a banned call
    // cannot red this, and so a banned call cannot hide behind a trailing comment.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('setInterval');
    expect(code).not.toContain('Date.now');
    expect(code).not.toContain('performance.now');
    expect(code).not.toContain('require(');
    // Zero imports at all: the decision core has nothing to import, and the driver
    // takes its two IO seams as parameters.
    expect(code).not.toMatch(/^\s*import\s/m);
    // A vacuity floor: the stripper must not have eaten the file it is scanning.
    expect(code).toContain('export class LoopScheduler');
  });
});

describe('scheduler debounce mode (the presence push)', () => {
  /**
   * The presence-push shape: no chain of its own, one run per open window. The
   * random source sits at an EDGE of the jitter band rather than its center, so
   * if a debounce delay were ever jittered every exact time below would move and
   * these cases would fail rather than quietly accept a jittered window.
   */
  function debounceRig(): {
    clock: SyntheticClock;
    runAt: number[];
    task: ScheduledTask;
    gate: ReturnType<typeof deferred>;
  } {
    const clock = syntheticClock();
    const runAt: number[] = [];
    const gate = deferred();
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0);
    const task = scheduler.add({
      name: 'presence-push',
      mode: 'debounce',
      cadence: { activeMs: 4000 },
      run: async () => {
        runAt.push(clock.now());
        if (runAt.length === 1) await gate.promise;
      },
    });
    task.start();
    return { clock, runAt, task, gate };
  }

  it('arms nothing on start, so an unkicked debounce never runs', async () => {
    // The whole difference from a poll loop: start() gives a debounce task no
    // chain at all. A repeating task here would have run a thousand times.
    const { clock, runAt } = debounceRig();
    await clock.advanceTo(1_000_000);
    expect(runAt).toEqual([]);
  });

  it('runs exactly one full window after the first kick, unjittered', async () => {
    const { clock, runAt, task, gate } = debounceRig();
    gate.resolve();
    task.kick();
    // Not one tick earlier: the window is the debounce, so 3999 must be empty.
    await clock.advanceTo(3999);
    expect(runAt).toEqual([]);
    await clock.advanceTo(4000);
    expect(runAt).toEqual([4000]);
    // And nothing repeats afterwards, because a debounce has no chain.
    await clock.advanceTo(100_000);
    expect(runAt).toEqual([4000]);
  });

  it('folds a burst of kicks into ONE run and never defers the deadline', async () => {
    // The voice/presence burst this exists for. Every event in the window costs
    // one run, and a kick at 3999 must not push the deadline out to 7999: a
    // steady burst would otherwise defer the push forever.
    const { clock, runAt, task, gate } = debounceRig();
    gate.resolve();
    task.kick();
    await clock.advanceTo(1000);
    task.kick();
    await clock.advanceTo(3999);
    task.kick();
    expect(runAt).toEqual([]);
    await clock.advanceTo(4000);
    expect(runAt).toEqual([4000]);
    // Well past where each later kick WOULD have landed had it armed a timer of
    // its own (5000 and 7999). Stopping at 4000 would miss exactly that leak: the
    // first window still fires on time, and the orphaned timers fire afterwards.
    await clock.advanceTo(50_000);
    expect(runAt).toEqual([4000]);
  });

  it('opens the follow-up window at run SETTLE, not at event time, exactly once', async () => {
    // A DELIBERATE deviation from the presenceTimer this replaces, and the arm is
    // built so the two are distinguishable rather than accidentally equal. The old
    // guard cleared itself BEFORE starting the push, so an event during the push
    // armed its window from EVENT time; here the window opens when the run
    // SETTLES. That guarantees a full quiet window BETWEEN pushes instead of
    // allowing two to land a moment apart, which is the anti-storm direction.
    //
    // The run is held open across a clock advance so the two differ: the kick
    // lands at 5000 and the run settles at 6000, so event-time would fire at 9000
    // and settle-time fires at 10000. Resolving the gate before advancing (as an
    // earlier version of this test did) collapses both onto the same number and
    // the assertion becomes true for either implementation.
    const { clock, runAt, task, gate } = debounceRig();
    task.kick();
    await clock.advanceTo(4000);
    expect(runAt).toEqual([4000]); // run 1 is now in flight, holding the gate

    await clock.advanceTo(5000);
    task.kick();
    task.kick();
    task.kick();
    await clock.advanceTo(6000);
    gate.resolve();
    await clock.advanceTo(6000); // flush the settle WITHOUT moving time

    await clock.advanceTo(9000);
    expect(runAt).toEqual([4000]); // event-time semantics would have fired here
    await clock.advanceTo(10_000);
    expect(runAt).toEqual([4000, 10_000]);
    // Three kicks, one follow-up: still exactly one, not one per kick.
    await clock.advanceTo(100_000);
    expect(runAt).toEqual([4000, 10_000]);
  });

  it('opens its window at the ACTIVE interval, never the idle or the decayed one', async () => {
    // Found by mutation, third round: swapping armDebounce's `activeMs` for
    // `idleMs` survived the whole suite, because every debounce case above sets
    // activeMs ALONE, and resolveCadence then makes idleMs equal to it. So the
    // two values were never distinguishable and the window read whichever it
    // liked. This case sets them apart.
    //
    // The second half pins the other door into the same bug: a debounce window is
    // the DEBOUNCE, so it must come from the cadence, never from the task's own
    // decayed interval. Nothing else says so, and the two are equal until an empty
    // run has stretched one of them.
    const clock = syntheticClock();
    const runAt: number[] = [];
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0);
    const task = scheduler.add({
      name: 'presence-push',
      mode: 'debounce',
      cadence: { activeMs: 4000, idleMs: 30_000 },
      run: async () => {
        runAt.push(clock.now());
      },
    });

    task.start();
    task.kick();
    await clock.advanceTo(4000);
    expect(runAt).toEqual([4000]); // 4000, not the idle 30_000

    // That run reported no work, so the task's own interval decayed. The next
    // window must ignore it and stay one active interval wide.
    expect(task.intervalMs()).toBe(8000);
    task.kick();
    await clock.advanceTo(7999);
    expect(runAt).toEqual([4000]);
    await clock.advanceTo(8000);
    expect(runAt).toEqual([4000, 8000]); // 4000 + 4000, not 4000 + 8000
    task.stop();
  });

  it('cancels an armed window on stop, and ignores kicks afterwards', async () => {
    const { clock, runAt, task, gate } = debounceRig();
    gate.resolve();
    task.kick();
    await clock.advanceTo(2000);
    task.stop();
    await clock.advanceTo(100_000);
    expect(runAt).toEqual([]);
    task.kick();
    await clock.advanceTo(200_000);
    expect(runAt).toEqual([]);
  });
});

describe('scheduler kick from IDLE, and the task lifecycle', () => {
  /** A plain repeating task on the virtual clock, jitter pinned to the centre. */
  function rig(cadence: TaskCadence = { activeMs: 1000 }): {
    clock: SyntheticClock;
    runAt: number[];
    task: ScheduledTask;
    scheduler: LoopScheduler;
  } {
    const clock = syntheticClock();
    const runAt: number[] = [];
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'sweep',
      cadence,
      run: async () => {
        runAt.push(clock.now());
        return true;
      },
    });
    return { clock, runAt, task, scheduler };
  }

  it('runs a kick IMMEDIATELY when idle, and drops the delay it made stale', async () => {
    // The GUILD_CREATE path main.ts actually uses, and the one branch of kick()
    // the mid-run cases never reach. The 500 proves the kick ran at once rather
    // than waiting, the absence of a 1000 proves no second run came from the
    // delay the kick made stale, and the 1500 proves the chain re-armed from the
    // kick rather than keeping its old phase.
    //
    // Honest limit, found by mutation: this does NOT prove the `clearArmed()`
    // inside kick() specifically. Deleting it survives, because schedule() clears
    // the handle again before re-arming and the overlap guard absorbs a stale
    // timer that fires during a slow run. That line is defense in depth, not a
    // load-bearing one, and no assertion can distinguish it.
    const { clock, runAt, task } = rig();
    task.start();
    await clock.advanceTo(500);
    expect(runAt).toEqual([]);

    task.kick();
    await clock.advanceTo(500);
    expect(runAt).toEqual([500]);

    await clock.advanceTo(1000);
    expect(runAt).toEqual([500]); // the stale delay did NOT fire
    await clock.advanceTo(1500);
    expect(runAt).toEqual([500, 1500]);
    task.stop();
  });

  it('ignores a second start(), so a loop cannot be armed twice', async () => {
    // Idempotence at the API level. Honest limit, found by mutation: deleting the
    // `if (this.active) return` guard survives this, because schedule() clears the
    // previously armed handle before arming the next, so a second start replaces
    // the chain rather than adding one. The guard is defense in depth; what this
    // test does pin is the OBSERVABLE contract, that N starts give one cadence.
    const { clock, runAt, task } = rig();
    task.start();
    task.start();
    task.start();
    await clock.advanceTo(3000);
    expect(runAt).toEqual([1000, 2000, 3000]);
    task.stop();
  });

  it('can be restarted after a stop, with no ghost chain from before', async () => {
    const { clock, runAt, task } = rig();
    task.start();
    await clock.advanceTo(1000);
    expect(runAt).toEqual([1000]);
    task.stop();
    await clock.advanceTo(10_000);
    expect(runAt).toEqual([1000]);

    task.start();
    await clock.advanceTo(11_000);
    // Exactly one more: the pre-stop chain did not resume alongside the new one.
    expect(runAt).toEqual([1000, 11_000]);
    task.stop();
  });

  it('leaves only the NEW chain armed when a restart lands mid-run', async () => {
    // The one case the generation counter actually decides, and the one the
    // restart case above does not reach: stop() arrives while a run is still in
    // flight, start() arms a fresh chain, and only THEN does the old run settle.
    // Its settle must not re-arm, or the delay start() just armed is silently
    // replaced by one computed from the stale run's state.
    //
    // Found by mutation, third round: deleting the `generation++` in stop(), or
    // the generation half of the in-flight check in execute(), survived the whole
    // suite. The existing mid-run stop case cannot see either, because there the
    // task stays stopped and `!this.active` settles it on its own; only a restart
    // makes `active` true again while a stale run is still holding a generation.
    //
    // The decaying cadence is what makes the two outcomes tell apart. The chain
    // start() armed carries the PRE-settle interval (1000), so the next run is at
    // 2000; a settle that wrongly re-armed would cancel it and arm the DECAYED
    // interval instead (2000 from t=1000), putting the run at 3000.
    //
    // The retired run publishes nothing at all, so the interval it would have
    // decayed never reaches the restarted task: the run at 2000 starts from 1000
    // and decays from there.
    const clock = syntheticClock();
    const runAt: number[] = [];
    const gate = deferred();
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'sweep',
      cadence: { activeMs: 1000, idleMs: 8000 },
      run: async () => {
        runAt.push(clock.now());
        if (runAt.length === 1) await gate.promise;
        return false; // no work, so an errant settle decays before it re-arms
      },
    });

    task.start();
    await clock.advanceTo(1000);
    expect(runAt).toEqual([1000]);

    task.stop();
    task.start();
    gate.resolve();

    await clock.advanceTo(2000);
    expect(runAt).toEqual([1000, 2000]);
    // And the restarted chain decays from its OWN interval, not the retired run's:
    // 1000 doubles to 2000, so the next run is at 4000.
    await clock.advanceTo(3999);
    expect(runAt).toEqual([1000, 2000]);
    await clock.advanceTo(4000);
    expect(runAt).toEqual([1000, 2000, 4000]);
    task.stop();
  });

  it('never runs a restarted chain BESIDE the run the stop abandoned', async () => {
    // Both halves of the restart contract at once, and the reason this case exists.
    //
    // stop() can retire a run's generation but it cannot cancel the promise, so an
    // abandoned run keeps executing. The first shape of this fix released the
    // overlap claim in stop(), which traded the deadlock below for genuine
    // overlap: the restarted chain's first run entered while the abandoned one was
    // still inside options.run(). So the claim is NOT released. start() arms
    // nothing while a run is in flight, and the abandoned run's settle hands the
    // chain over on its way out.
    //
    // The deadlock this replaced, reproduced against the real module before the
    // fix: the retired run returned early on its stale generation while the newly
    // armed timer was refused by the overlap guard, so neither owner armed
    // anything and the task was dead for the life of the process, with no counter
    // and no log. `runAt` stopped at [1000] no matter how far the clock advanced.
    //
    // Honest limit, found by mutation: this does NOT prove the `if
    // (this.state.running) return` in start() specifically, and no assertion can.
    // Deleting it arms one timer that beginRun then refuses, and the handover
    // arms the chain either way, so the two are indistinguishable in behavior.
    // It is defense in depth like the `clearArmed()` inside kick() and the
    // double-start guard; what IS load bearing, and what this case does pin, is
    // that stop() leaves the claim in place (the peak assertions) and that the
    // retired run hands the chain back (the runs after the gate opens).
    const clock = syntheticClock();
    const runAt: number[] = [];
    const gate = deferred();
    let live = 0;
    let peak = 0;
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'sweep',
      cadence: { activeMs: 1000 },
      run: async () => {
        live += 1;
        peak = Math.max(peak, live);
        runAt.push(clock.now());
        if (runAt.length === 1) await gate.promise;
        live -= 1;
        return true;
      },
    });

    task.start();
    await clock.advanceTo(1000);
    expect(runAt).toEqual([1000]);

    task.stop();
    task.start();

    // NOT overlap: the abandoned run still holds the task, so the restart waits
    // however long it takes rather than starting a second body beside it.
    await clock.advanceTo(9000);
    expect(runAt).toEqual([1000]);
    expect(peak).toBe(1);

    // NOT a deadlock either: the abandoned run's settle hands the chain over, and
    // the restarted task resumes at its own cadence from that moment.
    gate.resolve();
    await clock.advanceTo(10_000);
    expect(runAt).toEqual([1000, 10_000]);
    await clock.advanceTo(11_000);
    expect(runAt).toEqual([1000, 10_000, 11_000]);
    expect(peak).toBe(1);
    task.stop();
  });

  it('hands a kick that arrived during the abandoned run to the restarted chain', async () => {
    // The handover carries the pending kick rather than dropping it. A kick that
    // lands after the restart is aimed at the LIVE task, and losing it would lose
    // exactly one GUILD_CREATE re-sync on the reconnect path this exists for.
    const clock = syntheticClock();
    const runAt: number[] = [];
    const gate = deferred();
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'sweep',
      cadence: { activeMs: 1000 },
      run: async () => {
        runAt.push(clock.now());
        if (runAt.length === 1) await gate.promise;
        return true;
      },
    });

    task.start();
    await clock.advanceTo(1000);
    task.stop();
    task.start();
    task.kick(); // coalesced: the abandoned run still holds the task
    await clock.advanceTo(5000);
    expect(runAt).toEqual([1000]);

    // The settle honors it AT ONCE rather than waiting out a fresh interval,
    // which is what a kick means everywhere else in this module.
    gate.resolve();
    await clock.advanceTo(5000);
    expect(runAt).toEqual([1000, 5000]);
    // And the ordinary chain resumes from that run's own settle.
    await clock.advanceTo(6000);
    expect(runAt).toEqual([1000, 5000, 6000]);
    task.stop();
  });

  it('resumes the ordinary chain after a coalesced follow-up run', async () => {
    // The follow-up path returns early rather than calling schedule(), so the
    // chain has to be re-armed by the follow-up's OWN settle. Nothing pinned that.
    const clock = syntheticClock();
    const runAt: number[] = [];
    const gate = deferred();
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'sweep',
      cadence: { activeMs: 1000 },
      run: async () => {
        runAt.push(clock.now());
        if (runAt.length === 1) await gate.promise;
        return true;
      },
    });
    task.start();
    await clock.advanceTo(1000);
    task.kick();
    gate.resolve();
    await clock.advanceTo(1000);
    expect(runAt).toEqual([1000, 1000]); // the collapsed follow-up
    await clock.advanceTo(2000);
    expect(runAt).toEqual([1000, 1000, 2000]); // and the chain carries on
    task.stop();
  });

  it('routes a throwing run to the default sink and keeps the chain alive', async () => {
    // The default onError path, which the explicit-sink tests never take.
    const clock = syntheticClock();
    const runAt: number[] = [];
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args);
    };
    try {
      const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
      const task = scheduler.add({
        name: 'sweep',
        cadence: { activeMs: 1000 },
        run: async () => {
          runAt.push(clock.now());
          throw new Error('discord said no');
        },
      });
      task.start();
      await clock.advanceTo(2000);
      task.stop();
    } finally {
      console.error = original;
    }
    expect(runAt).toEqual([1000, 2000]);
    expect(logged).toHaveLength(2);
    expect(logged[0][0]).toBe('[bot] scheduled task sweep failed');
  });

  it('survives an onError sink that throws, which is the claim at that catch', async () => {
    // Stated in the source and otherwise unbacked: a broken error sink must not be
    // the thing that stops the loop, or one bad log line silently ends syncing.
    const clock = syntheticClock();
    const runAt: number[] = [];
    const scheduler = new LoopScheduler(clockTimers(clock), () => 0.5);
    const task = scheduler.add({
      name: 'sweep',
      cadence: { activeMs: 1000 },
      run: async () => {
        runAt.push(clock.now());
        throw new Error('discord said no');
      },
      onError: () => {
        throw new Error('the sink is broken too');
      },
    });
    task.start();
    await clock.advanceTo(3000);
    expect(runAt).toEqual([1000, 2000, 3000]);
    task.stop();
  });
});

describe('scheduler cadence resolution edge cases', () => {
  it('clamps a stale or out-of-band current interval back into the band', () => {
    // The doc comment claims a hand-built or stale value cannot escape the band;
    // every other case feeds a value already inside it, so both clamps were
    // unfalsifiable. Below the floor, above the ceiling, and unusable.
    expect(nextIntervalMs(100, OUTBOX, false)).toBe(6000);
    expect(nextIntervalMs(90_000, OUTBOX, false)).toBe(15_000);
    expect(nextIntervalMs(Number.NaN, OUTBOX, false)).toBe(6000);
    expect(nextIntervalMs(0, OUTBOX, false)).toBe(6000);
    expect(nextIntervalMs(-1000, OUTBOX, false)).toBe(6000);
  });

  it('falls back to the active interval for an unusable idle interval', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      expect(resolveCadence({ activeMs: 3000, idleMs: bad as unknown as number }).idleMs).toBe(
        3000,
      );
    }
  });

  it('falls back to the default decay for an unusable one, and accepts exactly 1', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -2, 0.99, undefined]) {
      expect(resolveCadence({ activeMs: 3000, decay: bad as unknown as number }).decay).toBe(
        DEFAULT_IDLE_DECAY,
      );
    }
    // Exactly 1 is legal and means an idle interval that never grows, which is a
    // real choice (back off by never backing off) rather than a bad value.
    expect(resolveCadence({ activeMs: 3000, idleMs: 15_000, decay: 1 }).decay).toBe(1);
    expect(nextIntervalMs(3000, { activeMs: 3000, idleMs: 15_000, decay: 1 }, false)).toBe(3000);
  });
});
