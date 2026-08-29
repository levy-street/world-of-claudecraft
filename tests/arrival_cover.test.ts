// The arrival curtain flag plus the registry the reveal gates join
// (src/render/arrival_cover.ts): who reads the flag is tested where they read
// it (gpu_prep_admission), so these cases pin the flag's own contract, the
// aggregate held-key view, and the bounded wait.
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARRIVAL_REVEAL_POLL_MS,
  type ArrivalRevealGate,
  arrivalCoverActive,
  arrivalEstablishingShotActive,
  arrivalHeldImminentKeys,
  awaitArrivalReveals,
  ENTRY_WAIT_ESTABLISHING_EVENT_KEY,
  ENTRY_WAIT_EVENT_KEY,
  noteArrivalEvent,
  noteArrivalIfTeleported,
  registerRevealGateForArrival,
  resetArrivalCoverForTest,
  setArrivalCover,
  setArrivalEstablishingShot,
} from '../src/render/arrival_cover';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';

/** A gate whose held count the test drives. */
function fakeGate(held: number): ArrivalRevealGate & { held: number } {
  return {
    held,
    heldImminentKeys(): number {
      return this.held;
    },
  };
}

/** A timer fake: every scheduled poll runs on `flush`, so a wait resolves
 *  without real time passing. */
function fakeTimer() {
  const pending: (() => void)[] = [];
  const armedMs: number[] = [];
  return {
    armedMs,
    schedule: (poll: () => void, ms: number): void => {
      armedMs.push(ms);
      pending.push(poll);
    },
    flush: (): void => {
      const due = pending.splice(0, pending.length);
      for (const poll of due) poll();
    },
    pending: (): number => pending.length,
  };
}

afterEach(() => {
  resetArrivalCoverForTest();
  resetGpuPrepEventsForTest();
});

describe('noteArrivalEvent', () => {
  it('records one arrival event naming the cover state, missing views and held keys', () => {
    const gate = fakeGate(3);
    registerRevealGateForArrival(gate);
    setArrivalCover(true);
    noteArrivalEvent(17);
    setArrivalCover(false);
    gate.held = 0;
    noteArrivalEvent(2);
    const events = gpuPrepEventsSnapshot().events;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      kind: 'arrival',
      key: 'cover',
      units: 17,
      totalRoots: 3,
      readyRoots: 0,
      ageMs: 0,
    });
    expect(events[1]).toMatchObject({ kind: 'arrival', key: 'no-cover', units: 2, totalRoots: 0 });
    expect(gpuPrepEventsSnapshot().counts.arrival).toBe(2);
  });

  it('records the per-frame position only on the frame it jumps by a teleport', () => {
    noteArrivalIfTeleported(100, 100, 5);
    noteArrivalIfTeleported(101, 100.5, 5);
    expect(gpuPrepEventsSnapshot().counts.arrival).toBe(0);
    setArrivalCover(true);
    noteArrivalIfTeleported(900, -200, 12);
    const events = gpuPrepEventsSnapshot().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'arrival', key: 'cover', units: 12 });
    noteArrivalIfTeleported(900.4, -200, 3);
    expect(gpuPrepEventsSnapshot().counts.arrival).toBe(1);
  });
});

describe('arrival cover flag', () => {
  it('is down by default and follows the curtain', () => {
    expect(arrivalCoverActive()).toBe(false);
    setArrivalCover(true);
    expect(arrivalCoverActive()).toBe(true);
    setArrivalCover(false);
    expect(arrivalCoverActive()).toBe(false);
  });

  it('counts depth, so an overlapping owner cannot cut the other one short', () => {
    // The blocking arrival and the world-entry settle raise the same curtain
    // and can overlap (a teleport-sized reposition landing inside the entry
    // settle window). The cover must stand until the LAST of them drops it.
    setArrivalCover(true);
    setArrivalCover(true);
    expect(arrivalCoverActive()).toBe(true);
    setArrivalCover(false);
    expect(arrivalCoverActive()).toBe(true);
    setArrivalCover(false);
    expect(arrivalCoverActive()).toBe(false);
  });

  it('floors the depth at zero, so a redundant drop cannot bank a negative', () => {
    // The warmup's finally always runs, including on a path that never raised
    // the curtain: an unmatched drop must not make the NEXT raise a no-op.
    setArrivalCover(false);
    setArrivalCover(false);
    expect(arrivalCoverActive()).toBe(false);
    setArrivalCover(true);
    expect(arrivalCoverActive()).toBe(true);
    setArrivalCover(false);
    expect(arrivalCoverActive()).toBe(false);
  });

  it('sums the held imminent keys across every gate', () => {
    const props = fakeGate(3);
    const town = fakeGate(1);
    registerRevealGateForArrival(props);
    registerRevealGateForArrival(town);
    expect(arrivalHeldImminentKeys()).toBe(4);
    props.held = 0;
    town.held = 0;
    expect(arrivalHeldImminentKeys()).toBe(0);
  });
});

describe('awaitArrivalReveals', () => {
  it('waits ONE poll before its first check, then resolves with nothing held', async () => {
    // The wait starts the moment the teleport lands, BEFORE any cull has
    // consulted a gate at the new position. A synchronous first check
    // therefore read "nothing held" because nothing had been asked yet, and
    // lifted the curtain on the very frame the reveals were about to be
    // requested in. One poll of floor is what gives the culls a frame to ask.
    const timer = fakeTimer();
    const gate = fakeGate(0);
    registerRevealGateForArrival(gate);
    let settled = false;
    const wait = awaitArrivalReveals(3_000, { now: () => 0, schedule: timer.schedule }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(timer.pending()).toBe(1);
    expect(timer.armedMs).toEqual([ARRIVAL_REVEAL_POLL_MS]);

    timer.flush();
    await wait;
    expect(settled).toBe(true);
    expect(timer.pending()).toBe(0);
  });

  it('holds the wait for a key a cull only requests after the floor', async () => {
    // The defect in one case: nothing is held at the call, and the first cull
    // of the new position marks a key imminent one poll later. The wait must
    // still be running to see it.
    const gate = fakeGate(0);
    registerRevealGateForArrival(gate);
    const timer = fakeTimer();
    let settled = false;
    const wait = awaitArrivalReveals(3_000, { now: () => 0, schedule: timer.schedule }).then(() => {
      settled = true;
    });

    gate.held = 3;
    timer.flush();
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.held = 0;
    timer.flush();
    await wait;
    expect(settled).toBe(true);
  });

  it('records how long it waited, the bound and the keys still held, under the shot key when the establishing shot is up', async () => {
    let t = 0;
    const timer = fakeTimer();
    const gate = fakeGate(2);
    registerRevealGateForArrival(gate);
    setArrivalCover(true);
    setArrivalEstablishingShot(true);
    const wait = awaitArrivalReveals(6_000, { now: () => t, schedule: timer.schedule });
    t = 50;
    timer.flush();
    await Promise.resolve();
    gate.held = 1;
    t = 3_700;
    timer.flush();
    await Promise.resolve();
    gate.held = 0;
    t = 3_750;
    timer.flush();
    await wait;
    setArrivalEstablishingShot(false);
    setArrivalCover(false);
    const events = gpuPrepEventsSnapshot().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'arrival',
      key: ENTRY_WAIT_ESTABLISHING_EVENT_KEY,
      ageMs: 3_750,
      units: 6_000,
      totalRoots: 0,
    });
  });

  it('records a wait that ran out of its bound with the keys it lifted on, under the plain key', async () => {
    let t = 0;
    const timer = fakeTimer();
    registerRevealGateForArrival(fakeGate(5));
    const wait = awaitArrivalReveals(3_000, { now: () => t, schedule: timer.schedule });
    while (timer.pending() > 0) {
      t += 50;
      timer.flush();
      await Promise.resolve();
    }
    await wait;
    const events = gpuPrepEventsSnapshot().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'arrival',
      key: ENTRY_WAIT_EVENT_KEY,
      ageMs: 3_000,
      units: 3_000,
      totalRoots: 5,
    });
  });

  it('records nothing for a zero-budget wait', async () => {
    const timer = fakeTimer();
    registerRevealGateForArrival(fakeGate(4));
    await awaitArrivalReveals(0, { now: () => 0, schedule: timer.schedule });
    expect(gpuPrepEventsSnapshot().events).toHaveLength(0);
  });

  it('keeps the floor inside maxMs, so a zero-budget wait still costs nothing', async () => {
    // The online arrival asks for no wait at all. The floor may not turn that
    // into a poll interval of curtain.
    const timer = fakeTimer();
    registerRevealGateForArrival(fakeGate(4));
    await awaitArrivalReveals(0, { now: () => 0, schedule: timer.schedule });
    expect(timer.pending()).toBe(0);
    expect(timer.armedMs).toEqual([]);

    // ...and a budget SHORTER than one poll is armed at the budget, never at
    // the poll interval.
    const short = fakeTimer();
    void awaitArrivalReveals(ARRIVAL_REVEAL_POLL_MS / 2, {
      now: () => 0,
      schedule: short.schedule,
    });
    expect(short.armedMs).toEqual([ARRIVAL_REVEAL_POLL_MS / 2]);
  });

  it('polls until the last held key settles', async () => {
    const gate = fakeGate(2);
    registerRevealGateForArrival(gate);
    const timer = fakeTimer();
    let settled = false;
    const wait = awaitArrivalReveals(3_000, { now: () => 0, schedule: timer.schedule }).then(() => {
      settled = true;
    });

    timer.flush();
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.held = 0;
    timer.flush();
    await wait;
    expect(settled).toBe(true);
    expect(timer.armedMs).toEqual([ARRIVAL_REVEAL_POLL_MS, ARRIVAL_REVEAL_POLL_MS]);
  });

  it('gives up at maxMs so a stuck link cannot hold the screen open', async () => {
    registerRevealGateForArrival(fakeGate(1));
    const timer = fakeTimer();
    let now = 0;
    let settled = false;
    const wait = awaitArrivalReveals(3_000, { now: () => now, schedule: timer.schedule }).then(
      () => {
        settled = true;
      },
    );

    now = 2_999;
    timer.flush();
    await Promise.resolve();
    expect(settled).toBe(false);
    now = 3_000;
    timer.flush();
    await wait;
    expect(settled).toBe(true);
  });

  it('resolves at once on a non-positive budget', async () => {
    registerRevealGateForArrival(fakeGate(5));
    const timer = fakeTimer();
    await awaitArrivalReveals(0, { now: () => 0, schedule: timer.schedule });
    expect(timer.pending()).toBe(0);
  });
});

describe('arrival establishing shot', () => {
  it('is inert while the cover is down, whatever its owner last wrote', () => {
    expect(arrivalEstablishingShotActive()).toBe(false);
    setArrivalEstablishingShot(true);
    expect(arrivalEstablishingShotActive()).toBe(false);
    setArrivalCover(true);
    expect(arrivalEstablishingShotActive()).toBe(true);
    setArrivalCover(false);
    expect(arrivalEstablishingShotActive()).toBe(false);
  });

  it('clears with its owner, so a later plain cover is not an establishing shot', () => {
    setArrivalCover(true);
    setArrivalEstablishingShot(true);
    setArrivalEstablishingShot(false);
    expect(arrivalEstablishingShotActive()).toBe(false);
    setArrivalCover(false);
  });

  it('a teleport cover nested inside the entry cover keeps the shot readable until the entry drops', () => {
    setArrivalCover(true);
    setArrivalEstablishingShot(true);
    setArrivalCover(true);
    expect(arrivalEstablishingShotActive()).toBe(true);
    setArrivalCover(false);
    expect(arrivalEstablishingShotActive()).toBe(true);
    setArrivalEstablishingShot(false);
    setArrivalCover(false);
    expect(arrivalEstablishingShotActive()).toBe(false);
  });

  it('resets with the cover for tests', () => {
    setArrivalCover(true);
    setArrivalEstablishingShot(true);
    resetArrivalCoverForTest();
    setArrivalCover(true);
    expect(arrivalEstablishingShotActive()).toBe(false);
  });
});
