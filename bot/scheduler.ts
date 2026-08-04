// The bot's background-loop scheduler: the one place a poll loop's cadence, its
// overlap behavior, and its event-triggered kicks are decided.
//
// The loops this replaces were bare repeating timers, which fire on a fixed
// wall-clock rhythm whether or not the previous run has finished. That is fine
// while every sweep is fast and catastrophic the moment one is not: once a sweep
// takes longer than its period the next one starts anyway, the two contend for
// the same Discord buckets, each gets slower, and a single slow minute turns into
// a sustained storm that never drains. Chaining the timeout instead, so the next
// delay is armed only AFTER the previous run settles, makes that impossible by
// construction rather than by tuning: a run that takes ten periods costs one run,
// not ten.
//
// Split the way rate_governor.ts is split (bot/CLAUDE.md, the pure/IO rule):
//  - the DECISION half below is pure. It imports nothing, reads no clock, touches
//    no timer, and every function is a value in, value out transform over a plain
//    RunState. The overlap guard, the coalescing rule, the idle backoff, and the
//    jitter band are therefore provable in a unit test with zero IO.
//  - the DRIVER half (LoopScheduler) owns the one timer and the one random source,
//    both injected as trailing parameters with forwarding production defaults, so
//    a test drives the whole chain against a virtual clock.
//
// The coalescing rule is not a nicety. GUILD_CREATE is the natural trigger for a
// role sweep, and Discord re-sends it on every re-IDENTIFY, so a reconnect storm
// delivers a burst of them. Without coalescing that burst becomes a burst of
// sweeps; with it, any number of kicks arriving during one in-flight run collapse
// into exactly one follow-up.

/** What the injected `setTimeout` hands back. A fake may use a plain number. */
export type SchedulerTimerHandle = ReturnType<typeof setTimeout> | number;

/** The only IO the driver performs. Injected so tests can drive a virtual clock. */
export interface SchedulerTimers {
  setTimeout(cb: () => void, ms: number): SchedulerTimerHandle;
  clearTimeout(handle: SchedulerTimerHandle): void;
}

/** Active interval, and the idle interval it decays toward. */
export interface TaskCadence {
  activeMs: number;
  /** Defaults to `activeMs`, which means no decay at all. */
  idleMs?: number;
  /** Multiplier applied per idle run. Defaults to DEFAULT_IDLE_DECAY. */
  decay?: number;
}

/**
 * How a task is driven.
 *  - `repeating` (the default) is a poll loop: `start` arms the chain and each run
 *    arms the next, and a kick runs straight away.
 *  - `debounce` is an event collapser with no chain of its own: `start` arms
 *    nothing, and a kick arms ONE run `activeMs` later, with every further kick in
 *    that window folding into it. That is exactly the presence-push behavior this
 *    replaces (arm on the first event, drop the rest, fire once at the end of the
 *    window), now with the overlap guard and the coalescing rule applied to it.
 *    The delay is deliberately NOT jittered: jitter exists to decorrelate loops
 *    that would otherwise stay phase-locked, and a debounce has no phase to lock.
 */
export type TaskMode = 'repeating' | 'debounce';

export interface TaskOptions {
  name: string;
  cadence: TaskCadence;
  /**
   * Resolve true when the run did work. void or undefined counts as no work.
   *
   * The `void` in this union is load bearing rather than sloppy: several tasks
   * are existing `Promise<void>` sweeps wired straight through, the way
   * `run: () => refreshTierRoles()` is, and `Promise<void>` is NOT assignable
   * to `Promise<boolean | undefined>`, so the narrower type biome suggests
   * would force a wrapper around every one of those call sites.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: see the doc comment above
  run: () => Promise<boolean | void>;
  /** Defaults to `repeating`. */
  mode?: TaskMode;
  /** Fraction of the interval the delay is spread over. Defaults to DEFAULT_JITTER_RATIO. */
  jitterRatio?: number;
  onError?: (error: unknown, name: string) => void;
}

export interface ScheduledTask {
  readonly name: string;
  start(): void;
  /** Coalescing event-triggered kick. */
  kick(): void;
  stop(): void;
  /** Test and observability read: the current base interval, before jitter. */
  intervalMs(): number;
}

/**
 * How much an idle run stretches the interval. Two is a plain doubling, which
 * reaches a 5x idle ceiling in three empty runs: slow enough that a loop with
 * bursty work is not immediately pushed to its slowest cadence, fast enough that
 * an idle bot stops paying for polls nobody reads.
 */
export const DEFAULT_IDLE_DECAY = 2;

/**
 * Default jitter band, plus or minus 10 percent of the interval. Without it every
 * loop armed during one boot stays phase-locked forever, so they all fire on the
 * same tick and hand the rate governor a burst it then has to pace out. A tenth
 * is enough to decorrelate them without making any single cadence surprising.
 */
export const DEFAULT_JITTER_RATIO = 0.1;

/**
 * What an UNUSABLE interval resolves to. Deliberately not a clamp on a small one:
 * a valid value passes through untouched however small it is, because silently
 * rewriting a D13 operator override would be its own defect (locked ruling; the
 * pass-through is pinned in tests/discord_bot_scheduler.test.ts).
 *
 * It exists because the failure it prevents is the worst one this module can
 * have: an interval of 0 arms a
 * zero-delay timeout, whose callback arms another, which is a hot spin that
 * starves the macrotask queue and wedges the process rather than failing. Nothing
 * in production can reach it (bot/config.ts already rejects a non-positive env
 * value, and `add` throws on one below), so this is the third line of defense,
 * kept because the pure helpers are exported and callable on their own.
 */
export const MIN_INTERVAL_MS = 1000;

/**
 * The widest jitter allowed. At a ratio of 1 the bottom of the band is ZERO, so a
 * low draw would arm a zero-delay timeout whose callback arms another: the same
 * hot spin MIN_INTERVAL_MS exists to prevent, reached through a different door
 * (the floor applies to the BASE interval, and jitter is applied after it). Half
 * is a generous ceiling for something whose job is only to stop loops from
 * landing on the same tick; beyond it the jitter is not decorrelating a cadence,
 * it is replacing it.
 */
export const MAX_JITTER_RATIO = 0.5;

/** One task's whole decision state. Plain data: no timer, no promise, no clock. */
export interface RunState {
  running: boolean;
  kickPending: boolean;
  intervalMs: number;
}

/**
 * A positive finite millisecond value, or the fallback. Guarding here rather than
 * at each call site is what keeps a misconfigured env value (an empty string that
 * parsed to NaN, a negative) from becoming a zero-delay loop that spins hot.
 */
function positiveMs(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The cadence with every default filled in. */
export function resolveCadence(cadence: TaskCadence): {
  activeMs: number;
  idleMs: number;
  decay: number;
} {
  // The FALLBACK is MIN_INTERVAL_MS, never 0, because a zero becomes a zero-delay
  // timer that re-arms itself forever: a wedged process rather than a slow one. A
  // valid value is passed through untouched, however small, so an operator using
  // the D13 knobs gets exactly the cadence they asked for rather than a silently
  // clamped one.
  const activeMs = positiveMs(cadence.activeMs, MIN_INTERVAL_MS);
  // An omitted idle interval means the active one, which nextIntervalMs then
  // reads as "no decay". That is the conservative default: a caller that has not
  // thought about backoff keeps exactly the cadence it asked for.
  const idleMs = positiveMs(cadence.idleMs, activeMs);
  const rawDecay = cadence.decay;
  // Below 1 a "decay" would SHRINK the interval on an empty run, which is the
  // opposite of backing off and would hammer an idle endpoint hardest.
  const decay =
    typeof rawDecay === 'number' && Number.isFinite(rawDecay) && rawDecay >= 1
      ? rawDecay
      : DEFAULT_IDLE_DECAY;
  return { activeMs, idleMs, decay };
}

/** A fresh task's state: idle, nothing pending, at its ACTIVE cadence. */
export function initialRunState(cadence: TaskCadence): RunState {
  return { running: false, kickPending: false, intervalMs: resolveCadence(cadence).activeMs };
}

/**
 * The interval the NEXT run should wait. Work snaps straight back to the active
 * cadence (a loop that just found something is likely to find more); an empty run
 * multiplies by the decay and clamps at the idle ceiling.
 *
 * The snap back is deliberately not gradual. Adaptive backoff is only safe when
 * recovery is instant: the cost of decaying slowly is latency on the first real
 * event after a quiet spell, which is exactly the event a player is waiting on.
 */
export function nextIntervalMs(currentMs: number, cadence: TaskCadence, didWork: boolean): number {
  const { activeMs, idleMs, decay } = resolveCadence(cadence);
  if (didWork) return activeMs;
  if (idleMs <= activeMs) return activeMs;
  // The current value is clamped INTO the band before growing it, so a caller
  // passing something stale (or a hand-built state) cannot escape the ceiling.
  const base = Math.min(idleMs, Math.max(activeMs, positiveMs(currentMs, activeMs)));
  return Math.min(idleMs, base * decay);
}

/**
 * Spread one delay across the band `baseMs * (1 - ratio)` to `baseMs * (1 + ratio)`.
 *
 * Written as `base * (1 + ratio * (2 * unit - 1))` rather than interpolating
 * between the two edges, because at the midpoint that form gives back the base
 * EXACTLY for any ratio (the multiplier is 1 + 0), where the edge form leaves a
 * float residue. The result can never be negative or non-finite: a delay that
 * came out either way would arm a timer that fires immediately, forever.
 */
export function jitteredDelayMs(baseMs: number, jitterRatio: number, random01: number): number {
  const base = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 0;
  // Clamped to MAX_JITTER_RATIO, not to 1: at a ratio of 1 the bottom of the band
  // is exactly ZERO, so a low draw arms a zero-delay timeout that re-arms itself.
  // The MIN_INTERVAL_MS floor does not cover this, because it applies to the base
  // interval and the jitter is applied after it.
  const ratio = Number.isFinite(jitterRatio)
    ? Math.min(MAX_JITTER_RATIO, Math.max(0, jitterRatio))
    : 0;
  // A non-finite draw falls back to the CENTER, so a broken random source degrades
  // to an unjittered loop rather than to a zero delay.
  const unit = Number.isFinite(random01) ? Math.min(1, Math.max(0, random01)) : 0.5;
  const delay = base * (1 + ratio * (2 * unit - 1));
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

/**
 * Claim the right to run. `started` is false when a run is already in flight,
 * which is the whole overlap guard: every entry point (the armed timer and an
 * event kick alike) goes through here, so there is no second door.
 */
export function beginRun(state: RunState): { state: RunState; started: boolean } {
  if (state.running) return { state, started: false };
  return { state: { ...state, running: true }, started: true };
}

/**
 * Ask for a run now. Idle means go; in flight means remember, idempotently, so N
 * kicks during one run are one follow-up and a reconnect storm cannot multiply
 * sweeps.
 */
export function requestKick(state: RunState): { state: RunState; runNow: boolean } {
  if (!state.running) return { state, runNow: true };
  return { state: { ...state, kickPending: true }, runNow: false };
}

/**
 * Settle a run: clear the in-flight flag, consume any pending kick, and pick the
 * next interval. `followUpNow` is true exactly when a kick arrived mid-run, and
 * the returned state has it cleared, so the follow-up can only fire once.
 */
export function endRun(
  state: RunState,
  cadence: TaskCadence,
  didWork: boolean,
): { state: RunState; followUpNow: boolean } {
  const followUpNow = state.kickPending;
  return {
    state: {
      running: false,
      kickPending: false,
      intervalMs: nextIntervalMs(state.intervalMs, cadence, didWork),
    },
    followUpNow,
  };
}

/**
 * Production timers. Both defaults FORWARD to the global rather than capturing it
 * (bot/CLAUDE.md, the one injection convention): the arrow reads `setTimeout` at
 * CALL time, so a test that swaps the global after construction is still seen, and
 * the global is never invoked with an object as its `this`.
 *
 * The handle is unref'd so a pending loop delay never holds the process open, the
 * way the loops this replaces behaved. Guarded by a typeof check because an
 * injected fake may hand back a plain number, which has no unref.
 */
function productionTimers(): SchedulerTimers {
  return {
    setTimeout: (cb: () => void, ms: number): SchedulerTimerHandle => {
      const handle: SchedulerTimerHandle = setTimeout(cb, ms);
      const unref = (handle as unknown as { unref?: () => void }).unref;
      if (typeof unref === 'function') unref.call(handle);
      return handle;
    },
    clearTimeout: (handle: SchedulerTimerHandle): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

/** Where an unhandled task error goes when the caller supplies no sink. */
function defaultOnError(error: unknown, name: string): void {
  console.error(`[bot] scheduled task ${name} failed`, error);
}

/** One live loop. Created by LoopScheduler.add; not exported on its own. */
class LoopTask implements ScheduledTask {
  readonly name: string;
  private readonly options: TaskOptions;
  private readonly timers: SchedulerTimers;
  private readonly random: () => number;
  private state: RunState;
  private handle: SchedulerTimerHandle | null = null;
  private active = false;
  /**
   * Bumped by stop(). A run already in flight captures the value it started with
   * and compares on settle, which is how stop() reaches INSIDE a run: clearing the
   * armed timer alone would not stop a chain whose next link is armed by a
   * callback that has not returned yet.
   */
  private generation = 0;

  constructor(options: TaskOptions, timers: SchedulerTimers, random: () => number) {
    this.name = options.name;
    this.options = options;
    this.timers = timers;
    this.random = random;
    this.state = initialRunState(options.cadence);
  }

  intervalMs(): number {
    return this.state.intervalMs;
  }

  /**
   * Go live. A `debounce` task arms nothing here: it has no chain of its own and
   * runs only when something kicks it.
   */
  start(): void {
    if (this.active) return;
    this.active = true;
    // A run ABANDONED by an earlier stop() is still executing and still holds the
    // claim, because stop() can bump a generation but cannot cancel a promise.
    // Arming now would put the restarted chain's first run beside it, which is the
    // one thing this module exists to prevent. So the restart arms nothing and the
    // abandoned run's settle hands the chain over instead.
    if (this.state.running) return;
    if (this.options.mode !== 'debounce') this.schedule();
  }

  /**
   * A kick on a stopped task is ignored on purpose: it would be a one-off run with
   * no chain behind it, which is never what an event trigger means.
   */
  kick(): void {
    if (!this.active) return;
    const kicked = requestKick(this.state);
    this.state = kicked.state;
    // A run is already in flight: requestKick recorded the follow-up, and endRun
    // collapses however many arrive into exactly one.
    if (!kicked.runNow) return;
    if (this.options.mode === 'debounce') {
      this.armDebounce();
      return;
    }
    // Running NOW makes the armed delay stale, so drop it rather than let it fire
    // again a moment later.
    this.clearArmed();
    void this.execute();
  }

  stop(): void {
    this.active = false;
    this.generation++;
    this.clearArmed();
  }

  /**
   * Open one debounce window, unjittered. Already armed means we are inside an
   * open window, and the whole point of the window is that every event in it
   * costs exactly one run, so an existing deadline is left alone rather than
   * pushed out (a steady burst could otherwise defer the run forever).
   */
  private armDebounce(): void {
    if (!this.active || this.handle !== null) return;
    const generation = this.generation;
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      if (generation !== this.generation || !this.active) return;
      void this.execute();
    }, resolveCadence(this.options.cadence).activeMs);
  }

  private clearArmed(): void {
    if (this.handle === null) return;
    this.timers.clearTimeout(this.handle);
    this.handle = null;
  }

  /** Arm the next delay. Called only from a settled state, never from inside a run. */
  private schedule(): void {
    if (!this.active) return;
    this.clearArmed();
    const generation = this.generation;
    const ratio = this.options.jitterRatio ?? DEFAULT_JITTER_RATIO;
    const delay = jitteredDelayMs(this.state.intervalMs, ratio, this.random());
    this.handle = this.timers.setTimeout(() => {
      this.handle = null;
      if (generation !== this.generation || !this.active) return;
      void this.execute();
    }, delay);
  }

  /**
   * One run, from the overlap guard to arming the next delay. Never rejects: a run
   * that throws is counted as no work (so a failing loop backs off toward idle
   * instead of hammering) and the chain continues, because a loop that dies on its
   * first bad response is a loop that silently stops syncing.
   */
  private async execute(): Promise<void> {
    const begun = beginRun(this.state);
    this.state = begun.state;
    if (!begun.started) return;
    const generation = this.generation;
    let didWork = false;
    try {
      // Strict true only: a run that resolves undefined said nothing about having
      // found work, and reading that as work would defeat the backoff entirely.
      didWork = (await this.options.run()) === true;
    } catch (error) {
      didWork = false;
      const onError = this.options.onError ?? defaultOnError;
      try {
        onError(error, this.name);
      } catch {
        // A throwing error sink must not be the thing that kills the chain.
      }
    }
    const ended = endRun(this.state, this.options.cadence, didWork);
    if (generation !== this.generation) {
      // This run was RETIRED by a stop(). It publishes no cadence, because the
      // interval it decayed belongs to a lifecycle that ended, but it must release
      // the claim it is still holding, and if the task was restarted meanwhile it
      // owes that restart the chain: start() deliberately armed nothing so that
      // this handover is the only thing that begins the new one, which is what
      // keeps a restart from running BESIDE the run it abandoned.
      const pending = this.state.kickPending;
      this.state = { ...this.state, running: false, kickPending: false };
      if (!this.active) return;
      if (this.options.mode === 'debounce') {
        if (pending) this.armDebounce();
        return;
      }
      if (pending) void this.execute();
      else this.schedule();
      return;
    }
    if (!this.active) return;
    this.state = ended.state;
    if (this.options.mode === 'debounce') {
      // A kick that arrived mid-run waits out a FRESH window rather than running
      // straight away, which is what the debounce this replaces did: it cleared
      // its guard before starting the push, so an event during the push armed a
      // new full window. A debounce task never arms a chain of its own.
      if (ended.followUpNow) this.armDebounce();
      return;
    }
    if (ended.followUpNow) {
      // Straight into the run, unpaced and unjittered, which is the SAME contract
      // the idle arm of kick() has: an event trigger has never waited, and this
      // branch is only the deferred half of a kick that arrived mid-run. Jitter
      // would buy nothing either, since it exists to decorrelate chain arms and
      // an event-triggered run has no phase to decorrelate. Coalescing is what
      // bounds the cost: however many kicks arrive, this fires once.
      void this.execute();
      return;
    }
    this.schedule();
  }
}

/**
 * The set of background loops, and the single place they are started and stopped.
 * Both IO seams are trailing parameters with production defaults, so main.ts
 * constructs with no arguments at all and gets exactly production behavior.
 *
 * `Math.random` is the right default here: the repo's Rng rule covers `src/sim/`,
 * whose output must be reproducible from a seed, and nothing about a poll delay is
 * part of that world.
 */
export class LoopScheduler {
  private readonly tasks = new Map<string, LoopTask>();
  private readonly timers: SchedulerTimers;
  private readonly random: () => number;

  constructor(
    timers: SchedulerTimers = productionTimers(),
    random: () => number = () => Math.random(),
  ) {
    this.timers = timers;
    this.random = random;
  }

  get size(): number {
    return this.tasks.size;
  }

  /**
   * Register a loop. A duplicate name throws rather than replacing: the replaced
   * task would keep its armed timer forever with nothing left holding a handle to
   * stop it, which is a leak that reads as a working scheduler.
   */
  add(options: TaskOptions): ScheduledTask {
    if (this.tasks.has(options.name)) {
      throw new Error(`[bot] scheduler already has a task named ${options.name}`);
    }
    // Loud at boot rather than silently corrected. A non-positive cadence reaching
    // here means the wiring lost a config value, and the alternative to throwing is
    // a loop running at a cadence nobody chose.
    const { activeMs } = options.cadence;
    if (!(typeof activeMs === 'number' && Number.isFinite(activeMs) && activeMs > 0)) {
      throw new Error(`[bot] scheduler task ${options.name} needs a positive activeMs`);
    }
    const task = new LoopTask(options, this.timers, this.random);
    this.tasks.set(options.name, task);
    return task;
  }

  startAll(): void {
    for (const task of this.tasks.values()) task.start();
  }

  stopAll(): void {
    for (const task of this.tasks.values()) task.stop();
  }
}
