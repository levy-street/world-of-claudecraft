import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrivalHeldImminentKeys,
  resetArrivalCoverForTest,
  setArrivalCover,
  setArrivalEstablishingShot,
} from '../src/render/arrival_cover';
import {
  gpuPrepEventsSnapshot,
  resetGpuPrepEventsForTest,
  setGpuPrepClockForTest,
} from '../src/render/gpu_prep_events';
import {
  createPrewarmResumeStartGate,
  PREWARM_RESUME_START_BACKSTOP_MS,
} from '../src/render/prewarm_resume_start_gate_core';
import {
  createRevealGate,
  REVEAL_GATE_WATCHDOG_MS,
  REVEAL_SOFT_DEADLINE_MIN_MS,
  revealSoftDeadlineMs,
} from '../src/render/reveal_gate';

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(undefined);
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A schedule fake that records arms/cancels and lets a test fire a timeout.
 *  Timers are kept per armed duration, because a request can arm two (the
 *  soft deadline and the hard watchdog) and a test must fire exactly one. */
function fakeSchedule() {
  const timers: { ms: number; onTimeout: () => void; cancelled: boolean }[] = [];
  const state = {
    armedMs: [] as number[],
    cancels: 0,
    fire: () => undefined as void,
    fireAt: (ms: number): void => {
      const timer = timers.find((t) => t.ms === ms);
      if (!timer) throw new Error(`no timer armed at ${ms}`);
      timer.onTimeout();
    },
    cancelledAt: (ms: number): boolean => timers.find((t) => t.ms === ms)?.cancelled === true,
  };
  const schedule = (onTimeout: () => void, ms: number): (() => void) => {
    state.armedMs.push(ms);
    const timer = { ms, onTimeout, cancelled: false };
    timers.push(timer);
    state.fire = () => onTimeout();
    return () => {
      timer.cancelled = true;
      state.cancels++;
    };
  };
  return { state, schedule };
}

beforeEach(() => {
  resetGpuPrepEventsForTest();
});

afterEach(() => {
  setGpuPrepClockForTest(null);
  resetGpuPrepEventsForTest();
  resetArrivalCoverForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reveal gate driver', () => {
  it('compiles every root behind the key and settles once all resolve', async () => {
    const rootA = { name: 'a' };
    const rootB = { name: 'b' };
    const pending = new Map<object, Deferred>();
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: (root) => {
          const d = deferred();
          pending.set(root, d);
          return d.promise;
        },
        schedule,
      },
      () => [rootA, rootB],
    );
    expect(gate.allow('cell')).toBe(false);
    expect([...pending.keys()]).toEqual([rootA, rootB]);
    pending.get(rootA)?.resolve();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(false);
    pending.get(rootB)?.resolve();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
  });

  it('cancels the watchdog once the compiles settle', async () => {
    const { state, schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => [{}]);
    gate.allow('cell');
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(state.cancels).toBe(1);
    // A late timeout firing after the cancel window must be inert.
    state.fire();
    expect(gate.allow('cell')).toBe(true);
  });

  it('settles on mixed resolved and rejected compiles (fail-soft)', async () => {
    const { schedule } = fakeSchedule();
    let first = true;
    const gate = createRevealGate(
      {
        compile: () => {
          if (first) {
            first = false;
            return Promise.resolve();
          }
          return Promise.reject(new Error('link failed'));
        },
        schedule,
      },
      () => [{}, {}],
    );
    expect(gate.allow('cell')).toBe(false);
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
  });

  it('absorbs a synchronous throw from a compile request and still settles', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: () => {
          throw new Error('sync throw');
        },
        schedule,
      },
      () => [{}],
    );
    expect(() => gate.allow('cell')).not.toThrow();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(errors).toHaveBeenCalled();
  });

  it('absorbs a throwing roots provider and still settles', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => {
      throw new Error('no roots');
    });
    expect(() => gate.allow('cell')).not.toThrow();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(errors).toHaveBeenCalled();
  });

  it('the watchdog settles a key whose compile never resolves, and warns', async () => {
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { state, schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => new Promise(() => undefined), schedule }, () => [
      {},
    ]);
    expect(gate.allow('cell')).toBe(false);
    expect(state.armedMs).toEqual([REVEAL_GATE_WATCHDOG_MS]);
    state.fire();
    expect(gate.allow('cell')).toBe(true);
    expect(warns).toHaveBeenCalledOnce();
  });

  it('starts reveal work and its watchdog clock only after the initial paint gate', async () => {
    const start = deferred();
    const compile = vi.fn(() => new Promise(() => undefined));
    const { state, schedule } = fakeSchedule();
    let clock = 26_000;
    setGpuPrepClockForTest(() => clock);
    const gate = createRevealGate(
      { compile, schedule, startAfterInitialPaint: () => start.promise as Promise<void> },
      () => [{}],
    );

    expect(gate.allow('cull:thornpeak')).toBe(false);
    expect(compile).not.toHaveBeenCalled();
    expect(state.armedMs).toEqual([]);

    clock = 35_000;
    start.resolve();
    await flushMicrotasks();
    expect(compile).toHaveBeenCalledOnce();
    expect(state.armedMs).toEqual([REVEAL_GATE_WATCHDOG_MS]);

    clock = 45_000;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.fireAt(REVEAL_GATE_WATCHDOG_MS);
    expect(gpuPrepEventsSnapshot().events[0].ageMs).toBe(REVEAL_GATE_WATCHDOG_MS);
  });

  it('still reveals when the initial-paint owner never releases its bounded barrier', async () => {
    const start = fakeSchedule();
    const reveal = fakeSchedule();
    const compile = vi.fn(() => new Promise(() => undefined));
    const startGate = createPrewarmResumeStartGate({
      timeoutMs: PREWARM_RESUME_START_BACKSTOP_MS,
      schedule: start.schedule,
    });
    const gate = createRevealGate(
      {
        compile,
        schedule: reveal.schedule,
        startAfterInitialPaint: () => startGate.wait,
      },
      () => [{}],
    );

    expect(gate.allow('cull:stuck-entry')).toBe(false);
    expect(compile).not.toHaveBeenCalled();
    start.state.fireAt(PREWARM_RESUME_START_BACKSTOP_MS);
    await flushMicrotasks();
    expect(compile).toHaveBeenCalledOnce();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reveal.state.fireAt(REVEAL_GATE_WATCHDOG_MS);
    expect(gate.allow('cull:stuck-entry')).toBe(true);
  });

  it('the watchdog reveal lands in the GPU-preparation ring, not only the console', () => {
    // A console.warn is not readable from a capture: the watchdog is the one
    // escape that hides a link which never settled, so it must leave a
    // machine-readable record with the key and how long the key waited.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let clock = 0;
    setGpuPrepClockForTest(() => clock);
    const { state, schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => new Promise(() => undefined), schedule }, () => [
      {},
    ]);
    gate.allow('cull:eastbrook');
    clock = REVEAL_GATE_WATCHDOG_MS;
    state.fire();

    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['reveal-watchdog']).toBe(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0].kind).toBe('reveal-watchdog');
    expect(snapshot.events[0].key).toBe('cull:eastbrook');
    // The age is the real wait, so a watchdog that ever fires early would be
    // visible as an age below its own bound.
    expect(snapshot.events[0].ageMs).toBe(REVEAL_GATE_WATCHDOG_MS);
  });

  it('records nothing when the compiles settle before the watchdog', async () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => [{}]);
    gate.allow('cell');
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });

  it('pins the watchdog bound to its literal', () => {
    // The schedule fakes above would stay green if the constant drifted to 0,
    // which turns the whole gate into a no-op in production.
    expect(REVEAL_GATE_WATCHDOG_MS).toBe(10_000);
  });

  it('the default scheduler holds until the real watchdog elapses', () => {
    vi.useFakeTimers();
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gate = createRevealGate({ compile: () => new Promise(() => undefined) }, () => [{}]);
    expect(gate.allow('cell')).toBe(false);
    vi.advanceTimersByTime(REVEAL_GATE_WATCHDOG_MS - 1);
    expect(gate.allow('cell')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(gate.allow('cell')).toBe(true);
    expect(warns).toHaveBeenCalledOnce();
  });

  it('a key with no roots settles immediately', async () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => []);
    expect(gate.allow('empty')).toBe(false);
    await flushMicrotasks();
    expect(gate.allow('empty')).toBe(true);
  });

  it('requests each key once and resolves roots per key', async () => {
    const asked: string[] = [];
    let compiles = 0;
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: () => {
          compiles++;
          return Promise.resolve();
        },
        schedule,
      },
      (key) => {
        asked.push(key);
        return [{}, {}];
      },
    );
    gate.allow('a');
    gate.allow('a');
    gate.allow('b');
    await flushMicrotasks();
    expect(asked).toEqual(['a', 'b']);
    expect(compiles).toBe(4);
    expect(gate.allow('a')).toBe(true);
    expect(gate.allow('b')).toBe(true);
  });
});

describe('reveal gate per-root readiness', () => {
  it('marks each root ready as its own compile settles, key warm only at the end', async () => {
    const rootA = { name: 'a' };
    const rootB = { name: 'b' };
    const pending = new Map<object, Deferred>();
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: (root) => {
          const d = deferred();
          pending.set(root, d);
          return d.promise;
        },
        schedule,
      },
      () => [rootA, rootB],
    );
    gate.allow('town');
    expect(gate.rootReady('town', rootA)).toBe(false);
    pending.get(rootA)?.resolve();
    await flushMicrotasks();
    // The linked root may draw now; the key still holds the other one.
    expect(gate.rootReady('town', rootA)).toBe(true);
    expect(gate.rootReady('town', rootB)).toBe(false);
    expect(gate.allow('town')).toBe(false);
    pending.get(rootB)?.resolve();
    await flushMicrotasks();
    expect(gate.allow('town')).toBe(true);
    expect(gate.rootReady('town', rootB)).toBe(true);
  });

  it('a rejected root still becomes ready, so one bad link cannot hold the key', async () => {
    const good = { name: 'good' };
    const bad = { name: 'bad' };
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: (root) => (root === bad ? Promise.reject(new Error('link')) : Promise.resolve()),
        schedule,
      },
      () => [good, bad],
    );
    gate.allow('town');
    await flushMicrotasks();
    expect(gate.rootReady('town', bad)).toBe(true);
    expect(gate.allow('town')).toBe(true);
  });

  it('a synchronously throwing compile settles its own root', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const thrower = { name: 'thrower' };
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: (root) => {
          if (root === thrower) throw new Error('sync throw');
          return Promise.resolve();
        },
        schedule,
      },
      () => [thrower, {}],
    );
    gate.allow('town');
    await flushMicrotasks();
    expect(gate.rootReady('town', thrower)).toBe(true);
    expect(gate.allow('town')).toBe(true);
  });

  it('counts the held key and its roots in the reveal aggregate', () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => new Promise(() => undefined), schedule }, () => [
      {},
      {},
      {},
    ]);
    gate.allow('town');
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.reveal.keysHeld).toBe(1);
    expect(snapshot.reveal.rootsHeld).toBe(3);
  });

  it('counts a piecewise reveal a consumer reports', () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => new Promise(() => undefined), schedule }, () => [
      {},
    ]);
    gate.allow('town');
    gate.noteRootRevealed('town');
    expect(gpuPrepEventsSnapshot().reveal.rootsPiecewise).toBe(1);
  });
});

describe('reveal gate soft deadline', () => {
  const softHost = (
    expected: number,
    compile: (root: object) => Promise<unknown> = () => new Promise(() => undefined),
  ) => {
    const { state, schedule } = fakeSchedule();
    return { state, host: { compile, schedule, expectedMs: () => expected } };
  };

  it('derives the deadline from the learned per-root cost, clamped to its bounds', () => {
    // Below the floor a slow frame alone would fire it; above the watchdog it
    // would say nothing the watchdog does not already say. The floor is pinned
    // to its literal, so the clamp cases below cannot be self-comparisons that
    // stay green whatever it is moved to.
    expect(REVEAL_SOFT_DEADLINE_MIN_MS).toBe(1_000);
    expect(revealSoftDeadlineMs(50, 40)).toBe(2000);
    expect(revealSoftDeadlineMs(1, 1)).toBe(REVEAL_SOFT_DEADLINE_MIN_MS);
    expect(revealSoftDeadlineMs(1000, 40)).toBe(REVEAL_GATE_WATCHDOG_MS);
    // A budget with no samples yet, or a nonsense count, still yields the floor.
    expect(revealSoftDeadlineMs(0, 10)).toBe(REVEAL_SOFT_DEADLINE_MIN_MS);
    expect(revealSoftDeadlineMs(Number.NaN, 10)).toBe(REVEAL_SOFT_DEADLINE_MIN_MS);
    expect(revealSoftDeadlineMs(50, 0)).toBe(REVEAL_SOFT_DEADLINE_MIN_MS);
  });

  it('arms the soft deadline beside the hard watchdog, never instead of it', () => {
    const { state, host } = softHost(2000);
    const gate = createRevealGate(host, () => [{}, {}]);
    gate.allow('town');
    expect(state.armedMs).toEqual([REVEAL_GATE_WATCHDOG_MS, 2000]);
  });

  it('hands the host the key, the root count and the roots themselves for its cost lookup', () => {
    // The host prices a key by what its roots SUBMIT (one unit per material
    // group), so it needs the roots, not just how many there are.
    const roots = [{ name: 'a' }, { name: 'b' }];
    const { schedule } = fakeSchedule();
    const expectedMs = vi.fn(() => 2000);
    const gate = createRevealGate(
      { compile: () => new Promise(() => undefined), schedule, expectedMs },
      () => roots,
    );
    gate.allow('town');
    expect(expectedMs).toHaveBeenCalledWith('town', 2, roots);
  });

  it('records the soft deadline with the key and its ready/total counts, and reveals nothing', async () => {
    let clock = 0;
    setGpuPrepClockForTest(() => clock);
    const roots = [{}, {}, {}];
    const settle = new Map<object, Deferred>();
    const { state, host } = softHost(2000, (root: object) => {
      const d = deferred();
      settle.set(root, d);
      return d.promise;
    });
    const gate = createRevealGate(host, () => roots);
    gate.allow('eastbrook-town-static');
    settle.get(roots[0])?.resolve();
    await flushMicrotasks();
    clock = 2000;
    state.fireAt(2000);

    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['reveal-soft-deadline']).toBe(1);
    expect(snapshot.events[0].kind).toBe('reveal-soft-deadline');
    expect(snapshot.events[0].key).toBe('eastbrook-town-static');
    expect(snapshot.events[0].ageMs).toBe(2000);
    expect(snapshot.events[0].readyRoots).toBe(1);
    expect(snapshot.events[0].totalRoots).toBe(3);
    // The soft deadline is a REPORT, not an escape: the two roots still
    // compiling keep waiting for their link, up to the hard watchdog.
    expect(gate.allow('eastbrook-town-static')).toBe(false);
    expect(gate.rootReady('eastbrook-town-static', roots[1])).toBe(false);
  });

  it('records the soft deadline once per key', () => {
    const { state, host } = softHost(2000);
    const gate = createRevealGate(host, () => [{}]);
    gate.allow('town');
    state.fireAt(2000);
    gate.allow('town');
    gate.allow('town');
    expect(gpuPrepEventsSnapshot().counts['reveal-soft-deadline']).toBe(1);
  });

  it('cancels the soft deadline when the compiles settle first', async () => {
    const { state, schedule } = fakeSchedule();
    const gate = createRevealGate(
      { compile: () => Promise.resolve(), schedule, expectedMs: () => 2000 },
      () => [{}],
    );
    gate.allow('town');
    await flushMicrotasks();
    expect(gate.allow('town')).toBe(true);
    expect(state.cancelledAt(2000)).toBe(true);
    expect(gpuPrepEventsSnapshot().counts['reveal-soft-deadline']).toBe(0);
  });

  it('arms nothing when the deadline lands on the watchdog itself', () => {
    const { state, host } = softHost(REVEAL_GATE_WATCHDOG_MS);
    const gate = createRevealGate(host, () => [{}]);
    gate.allow('town');
    expect(state.armedMs).toEqual([REVEAL_GATE_WATCHDOG_MS]);
  });

  it('absorbs a throwing expectedMs and still gates normally', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: () => Promise.resolve(),
        schedule,
        expectedMs: () => {
          throw new Error('budget exploded');
        },
      },
      () => [{}],
    );
    expect(() => gate.allow('town')).not.toThrow();
    await flushMicrotasks();
    expect(gate.allow('town')).toBe(true);
  });

  it('the hard watchdog carries how much of the key linked in time', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let clock = 0;
    setGpuPrepClockForTest(() => clock);
    const roots = [{}, {}, {}, {}];
    const { state, schedule } = fakeSchedule();
    const compiled = new Map<object, Deferred>();
    const gate = createRevealGate(
      {
        compile: (root) => {
          const d = deferred();
          compiled.set(root, d);
          return d.promise;
        },
        schedule,
      },
      () => roots,
    );
    gate.allow('fenbridge-town-static');
    compiled.get(roots[0])?.resolve();
    return flushMicrotasks().then(() => {
      clock = REVEAL_GATE_WATCHDOG_MS;
      state.fireAt(REVEAL_GATE_WATCHDOG_MS);
      const snapshot = gpuPrepEventsSnapshot();
      expect(snapshot.events[0].kind).toBe('reveal-watchdog');
      expect(snapshot.events[0].readyRoots).toBe(1);
      expect(snapshot.events[0].totalRoots).toBe(4);
      // The three roots that had NOT linked are the ones the reveal frame
      // pays for; that count is what a capture attributes the stall to.
      expect(snapshot.reveal.rootsAtWatchdog).toBe(3);
      expect(gate.allow('fenbridge-town-static')).toBe(true);
    });
  });
});

describe('reveal gate imminent holds', () => {
  /** A gate whose compiles never settle, so a hold can only end on a settle
   *  the test drives. */
  function stuckGate(roots: readonly object[]) {
    const { state, schedule } = fakeSchedule();
    const compiled: { root: object; imminent: boolean }[] = [];
    const gate = createRevealGate(
      {
        compile: (root, imminent) => {
          compiled.push({ root, imminent });
          return new Promise<void>(() => undefined);
        },
        schedule,
      },
      () => roots,
    );
    return { gate, state, compiled };
  }

  it('counts a hold and submits every root as imminent when the consult says so', () => {
    const roots = [{}, {}];
    const { gate, compiled } = stuckGate(roots);
    expect(gate.allow('eastbrook-town-static', true)).toBe(false);
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.reveal.imminentHolds).toBe(1);
    // The hold is a normal key hold too: the compiles were submitted.
    expect(snapshot.reveal.keysHeld).toBe(1);
    expect(snapshot.reveal.rootsHeld).toBe(2);
    expect(compiled).toEqual(roots.map((root) => ({ root, imminent: true })));
    // Nothing is recorded in the ring: imminence is a counter, not an escape.
    expect(snapshot.total).toBe(0);
  });

  it('submits an ordinary consult without the flag and counts no imminent hold', () => {
    const roots = [{}];
    const { gate, compiled } = stuckGate(roots);
    expect(gate.allow('cull:12')).toBe(false);
    expect(compiled).toEqual([{ root: roots[0], imminent: false }]);
    expect(gpuPrepEventsSnapshot().reveal.imminentHolds).toBe(0);
  });

  it('holds an imminent key until its compiles settle, with no bound anywhere', () => {
    const { gate, state } = stuckGate([{}]);
    gate.allow('town', true);
    // The ONLY timer the request arms is the hard watchdog (the host offers no
    // expected cost here, so no soft deadline either).
    expect(state.armedMs).toEqual([REVEAL_GATE_WATCHDOG_MS]);
    for (let frame = 0; frame < 500; frame++) {
      expect(gate.allow('town', true)).toBe(false);
    }
    expect(gpuPrepEventsSnapshot().total).toBe(0);
    expect(gate.state('town')).toBe('compiling');
  });

  it('reports a reach reveal apart from a piecewise one', () => {
    const { gate } = stuckGate([{}]);
    gate.allow('town', true);
    gate.noteRootRevealed('town');
    gate.noteRootRevealedAtReach('town');
    gate.noteRootRevealedAtReach('town');
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.reveal.rootsPiecewise).toBe(1);
    expect(snapshot.reveal.rootsReach).toBe(2);
  });

  it('joins the arrival-cover registry on creation, so a curtain can wait on it', async () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => new Promise(() => undefined), schedule }, () => [
      {},
    ]);
    expect(gate.allow('town', true)).toBe(false);
    expect(arrivalHeldImminentKeys()).toBe(1);
    // Only the settle clears it: the cover has nothing that shortens a hold.
    gate.settle('town');
    expect(arrivalHeldImminentKeys()).toBe(0);
    await flushMicrotasks();
  });

  it('a key that settles inside the curtain leaves nothing held', async () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => [{}]);
    gate.allow('town', true);
    await flushMicrotasks();
    expect(gate.allow('town', true)).toBe(true);
    expect(arrivalHeldImminentKeys()).toBe(0);
    expect(gpuPrepEventsSnapshot().reveal.imminentHolds).toBe(1);
  });
});

describe('reveal gate under the entry establishing shot', () => {
  function recordingGate(roots: readonly object[]) {
    const { schedule } = fakeSchedule();
    const compiled: { root: object; imminent: boolean }[] = [];
    const gate = createRevealGate(
      {
        compile: (root, imminent) => {
          compiled.push({ root, imminent });
          return new Promise<void>(() => undefined);
        },
        schedule,
      },
      () => roots,
    );
    return { gate, compiled };
  }

  it('turns an ordinary consult imminent while the cover is up on the establishing shot', () => {
    const roots = [{}];
    const { gate, compiled } = recordingGate(roots);
    setArrivalCover(true);
    setArrivalEstablishingShot(true);
    expect(gate.allow('cull:12')).toBe(false);
    expect(compiled).toEqual([{ root: roots[0], imminent: true }]);
    expect(gpuPrepEventsSnapshot().reveal.imminentHolds).toBe(1);
    // ... and the entry wait sees it as a held imminent key.
    expect(arrivalHeldImminentKeys()).toBe(1);
  });

  it('a plain arrival cover (a teleport) is NOT an establishing shot: consults stay ordinary', () => {
    const roots = [{}];
    const { gate, compiled } = recordingGate(roots);
    setArrivalCover(true);
    expect(gate.allow('cull:12')).toBe(false);
    expect(compiled).toEqual([{ root: roots[0], imminent: false }]);
    expect(gpuPrepEventsSnapshot().reveal.imminentHolds).toBe(0);
  });

  it('leaves a consult ordinary once the cover is down, even with the flag still set', () => {
    const roots = [{}];
    const { gate, compiled } = recordingGate(roots);
    setArrivalEstablishingShot(true);
    expect(gate.allow('cull:12')).toBe(false);
    expect(compiled).toEqual([{ root: roots[0], imminent: false }]);
    expect(gpuPrepEventsSnapshot().reveal.imminentHolds).toBe(0);
  });

  it('never reveals early: an imminent establishing consult still holds', () => {
    const { gate } = recordingGate([{}]);
    setArrivalCover(true);
    setArrivalEstablishingShot(true);
    expect(gate.allow('eastbrook-town-static')).toBe(false);
    expect(gate.allow('eastbrook-town-static')).toBe(false);
    expect(gate.state('eastbrook-town-static')).toBe('compiling');
  });
});
