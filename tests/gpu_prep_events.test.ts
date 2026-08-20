import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GPU_PREP_EVENT_RING_SIZE,
  gpuPrepEventsSnapshot,
  gpuPrepNow,
  noteRevealImminentHold,
  noteRevealKeyHeld,
  noteRevealRootPiecewise,
  noteRevealRootReach,
  noteRevealRootsAtWatchdog,
  noteSpiritSpawnRefused,
  recordGpuPrepEvent,
  resetGpuPrepEventsForTest,
  setGpuPrepClockForTest,
} from '../src/render/gpu_prep_events';

beforeEach(() => {
  resetGpuPrepEventsForTest();
  let t = 0;
  setGpuPrepClockForTest(() => (t += 10));
});

afterEach(() => {
  setGpuPrepClockForTest(null);
  resetGpuPrepEventsForTest();
});

describe('gpu preparation event ring', () => {
  it('starts empty and counts every kind at zero', () => {
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.total).toBe(0);
    expect(snapshot.dropped).toBe(0);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.counts).toEqual({
      'reveal-watchdog': 0,
      'reveal-soft-deadline': 0,
      'attach-watchdog': 0,
      'gate-timeout': 0,
      'submit-stop': 0,
      'live-program': 0,
      arrival: 0,
      'touch-unproven': 0,
    });
    expect(snapshot.reveal).toEqual({
      keysHeld: 0,
      rootsHeld: 0,
      rootsPiecewise: 0,
      rootsReach: 0,
      rootsAtWatchdog: 0,
      imminentHolds: 0,
    });
    expect(snapshot.gates).toEqual({ spiritSpawnsRefused: 0 });
  });

  it('records an event with its kind, key, age, and a clock stamp', () => {
    recordGpuPrepEvent({ kind: 'reveal-watchdog', key: 'cull:townsquare', ageMs: 10_000 });
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.total).toBe(1);
    expect(snapshot.counts['reveal-watchdog']).toBe(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toEqual({
      kind: 'reveal-watchdog',
      key: 'cull:townsquare',
      ageMs: 10_000,
      atMs: 10,
      readyRoots: 0,
      totalRoots: 0,
      units: 0,
    });
  });

  it('counts each kind separately and keeps the ring in arrival order', () => {
    recordGpuPrepEvent({ kind: 'gate-timeout', key: 'view:mob', ageMs: 1500 });
    recordGpuPrepEvent({ kind: 'attach-watchdog', key: 'eastbrook', ageMs: 10_000 });
    recordGpuPrepEvent({ kind: 'gate-timeout', key: 'view:npc', ageMs: 1500 });
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.total).toBe(3);
    expect(snapshot.counts).toEqual({
      'reveal-watchdog': 0,
      'reveal-soft-deadline': 0,
      'attach-watchdog': 1,
      'gate-timeout': 2,
      'submit-stop': 0,
      'live-program': 0,
      arrival: 0,
      'touch-unproven': 0,
    });
    expect(snapshot.events.map((event) => event.key)).toEqual([
      'view:mob',
      'eastbrook',
      'view:npc',
    ]);
  });

  it('bounds the ring and keeps the NEWEST events, oldest first', () => {
    // A stuck lane fires these steadily for as long as it stays stuck, so the
    // ring must not grow with it, and the entries worth keeping are the recent
    // ones. The lifetime counts still see every fire.
    const overflow = GPU_PREP_EVENT_RING_SIZE + 5;
    for (let i = 0; i < overflow; i++) {
      recordGpuPrepEvent({ kind: 'gate-timeout', key: `key-${i}`, ageMs: i });
    }
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.events).toHaveLength(GPU_PREP_EVENT_RING_SIZE);
    expect(snapshot.total).toBe(overflow);
    expect(snapshot.counts['gate-timeout']).toBe(overflow);
    expect(snapshot.dropped).toBe(overflow - GPU_PREP_EVENT_RING_SIZE);
    expect(snapshot.events[0].key).toBe(`key-${overflow - GPU_PREP_EVENT_RING_SIZE}`);
    expect(snapshot.events[GPU_PREP_EVENT_RING_SIZE - 1].key).toBe(`key-${overflow - 1}`);
    // Strictly increasing ages prove the wrap did not shuffle the order.
    const ages = snapshot.events.map((event) => event.ageMs);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
  });

  it('holds a whole arrival session, so the rarer kinds survive the soft deadlines', () => {
    // The measured shape the size answers: an arrival records ~89
    // reveal-soft-deadline events, and at 64 every rarer kind behind them was
    // dropped, which is exactly the population a capture needs to read.
    expect(GPU_PREP_EVENT_RING_SIZE).toBe(160);
    for (let i = 0; i < 89; i++) {
      recordGpuPrepEvent({ kind: 'reveal-soft-deadline', key: `soft-${i}`, ageMs: 1 });
    }
    for (let i = 0; i < 29; i++) {
      recordGpuPrepEvent({ kind: 'live-program', key: `program-${i}`, ageMs: 1_000 });
    }
    const programs = gpuPrepEventsSnapshot().events.filter(
      (event) => event.kind === 'live-program',
    );
    expect(programs).toHaveLength(29);
    expect(gpuPrepEventsSnapshot().dropped).toBe(0);
  });

  it('allocates no new slot once the ring is full', () => {
    for (let i = 0; i < GPU_PREP_EVENT_RING_SIZE; i++) {
      recordGpuPrepEvent({ kind: 'gate-timeout', key: `key-${i}`, ageMs: i });
    }
    const before = gpuPrepEventsSnapshot().events[0];
    recordGpuPrepEvent({ kind: 'reveal-watchdog', key: 'wrapped', ageMs: 1 });
    // The oldest slot object is REUSED for the wrapped write, so it is the same
    // object with new fields rather than a fresh allocation.
    const after = gpuPrepEventsSnapshot();
    expect(after.events[GPU_PREP_EVENT_RING_SIZE - 1]).toBe(before);
    expect(after.events[GPU_PREP_EVENT_RING_SIZE - 1].key).toBe('wrapped');
  });

  it('reuses the snapshot object and its array across calls', () => {
    recordGpuPrepEvent({ kind: 'attach-watchdog', key: 'a', ageMs: 1 });
    const first = gpuPrepEventsSnapshot();
    const firstEvents = first.events;
    recordGpuPrepEvent({ kind: 'attach-watchdog', key: 'b', ageMs: 2 });
    const second = gpuPrepEventsSnapshot();
    expect(second).toBe(first);
    expect(second.events).toBe(firstEvents);
    expect(second.events.map((event) => event.key)).toEqual(['a', 'b']);
  });

  it('reset clears the ring and every count', () => {
    recordGpuPrepEvent({ kind: 'reveal-watchdog', key: 'a', ageMs: 1 });
    recordGpuPrepEvent({ kind: 'gate-timeout', key: 'b', ageMs: 2 });
    resetGpuPrepEventsForTest();
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.total).toBe(0);
    expect(snapshot.dropped).toBe(0);
    expect(snapshot.events).toEqual([]);
    expect(Object.values(snapshot.counts)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('serves the injected clock, and the default one is restored on release', () => {
    expect(gpuPrepNow()).toBe(10);
    expect(gpuPrepNow()).toBe(20);
    setGpuPrepClockForTest(null);
    const a = gpuPrepNow();
    const b = gpuPrepNow();
    expect(typeof a).toBe('number');
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('gpu preparation reveal counters', () => {
  it('carries the ready/total root counts of the key an escape fired on', () => {
    // Without them a capture shows THAT a town revealed at its watchdog and
    // not how much of it had linked, which is exactly what decides whether the
    // reveal frame paid for one building or for forty.
    recordGpuPrepEvent({
      kind: 'reveal-soft-deadline',
      key: 'eastbrook-town-static',
      ageMs: 2400,
      readyRoots: 9,
      totalRoots: 41,
    });
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['reveal-soft-deadline']).toBe(1);
    expect(snapshot.events[0].readyRoots).toBe(9);
    expect(snapshot.events[0].totalRoots).toBe(41);
  });

  it('never leaks a previous event counts into a reused ring slot', () => {
    for (let i = 0; i < GPU_PREP_EVENT_RING_SIZE; i++) {
      recordGpuPrepEvent({ kind: 'gate-timeout', key: `key-${i}`, ageMs: i, totalRoots: 7 });
    }
    recordGpuPrepEvent({ kind: 'attach-watchdog', key: 'wrapped', ageMs: 1 });
    const wrapped = gpuPrepEventsSnapshot().events[GPU_PREP_EVENT_RING_SIZE - 1];
    expect(wrapped.key).toBe('wrapped');
    expect(wrapped.readyRoots).toBe(0);
    expect(wrapped.totalRoots).toBe(0);
    expect(wrapped.units).toBe(0);
  });

  it('carries the boot submit lane hard stop, keyed by the rule that fired', () => {
    // A truncated manifest is otherwise inferred from a short entry list: this
    // event says which rule stopped the compile-submit lane, how long the lane
    // had been submitting, and how many units it got out (the 17/08 production
    // login spent 11843.9 ms of a 12 s budget here).
    recordGpuPrepEvent({
      kind: 'submit-stop',
      key: 'lane-max',
      ageMs: 6_000,
      units: 812,
    });
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['submit-stop']).toBe(1);
    expect(snapshot.events[0]).toEqual({
      kind: 'submit-stop',
      key: 'lane-max',
      ageMs: 6_000,
      atMs: 10,
      readyRoots: 0,
      totalRoots: 0,
      units: 812,
    });
    // Junk unit counts cannot poison a lifetime readout a capture trusts.
    recordGpuPrepEvent({ kind: 'submit-stop', key: 'no-useful-link', ageMs: 12, units: -3 });
    expect(gpuPrepEventsSnapshot().events[1].units).toBe(0);
  });

  it('aggregates the reveal counters so a trace can attribute a first-draw stall', () => {
    noteRevealKeyHeld(41);
    noteRevealKeyHeld(1);
    noteRevealRootPiecewise();
    noteRevealRootPiecewise();
    noteRevealRootReach();
    noteRevealRootsAtWatchdog(3);
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.reveal).toEqual({
      keysHeld: 2,
      rootsHeld: 42,
      rootsPiecewise: 2,
      rootsReach: 1,
      rootsAtWatchdog: 3,
      imminentHolds: 0,
    });
    // Roots revealed when their key warmed are the remainder, so the four
    // populations partition the held roots without a fifth counter.
    const atWarm =
      snapshot.reveal.rootsHeld -
      snapshot.reveal.rootsPiecewise -
      snapshot.reveal.rootsReach -
      snapshot.reveal.rootsAtWatchdog;
    expect(atWarm).toBe(36);
  });

  it('the reveal counters are a module-owned object the snapshot reuses', () => {
    const first = gpuPrepEventsSnapshot().reveal;
    noteRevealKeyHeld(2);
    const second = gpuPrepEventsSnapshot().reveal;
    expect(second).toBe(first);
    expect(second.keysHeld).toBe(1);
  });

  it('normalizes a nonsense age like every other numeric field', () => {
    // The age is the one field a capture reads as a duration, so a NaN from a
    // caller's arithmetic must not land in the ring verbatim.
    recordGpuPrepEvent({ kind: 'gate-timeout', key: 'preview-open', ageMs: Number.NaN });
    recordGpuPrepEvent({ kind: 'reveal-watchdog', key: 'town', ageMs: -12 });
    // A sub-millisecond age is real and survives: the guard rejects, it does
    // not round.
    recordGpuPrepEvent({ kind: 'attach-watchdog', key: 'feature', ageMs: 0.25 });
    const events = gpuPrepEventsSnapshot().events;
    expect(events.map((event) => event.ageMs)).toEqual([0, 0, 0.25]);
  });

  it('ignores a nonsense root count instead of poisoning the totals', () => {
    noteRevealKeyHeld(Number.NaN);
    noteRevealRootsAtWatchdog(-4);
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.reveal.keysHeld).toBe(1);
    expect(snapshot.reveal.rootsHeld).toBe(0);
    expect(snapshot.reveal.rootsAtWatchdog).toBe(0);
  });

  it('counts the imminent holds and the reach reveals apart from the piecewise ones', () => {
    // An arrival among streamed decor marks its keys imminent, and the reach
    // floor is the only reveal that may still draw a root unlinked, so a
    // capture has to be able to tell those two populations apart.
    noteRevealImminentHold();
    noteRevealImminentHold();
    noteRevealRootReach();
    noteRevealRootPiecewise();
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.reveal.imminentHolds).toBe(2);
    expect(snapshot.reveal.rootsReach).toBe(1);
    expect(snapshot.reveal.rootsPiecewise).toBe(1);
    // None of them is an event: they are lifetime counters only.
    expect(snapshot.total).toBe(0);
  });

  it('reset clears the reveal counters too', () => {
    noteRevealKeyHeld(5);
    noteRevealRootPiecewise();
    noteRevealRootsAtWatchdog(2);
    noteRevealRootReach();
    noteRevealImminentHold();
    resetGpuPrepEventsForTest();
    expect(gpuPrepEventsSnapshot().reveal).toEqual({
      keysHeld: 0,
      rootsHeld: 0,
      rootsPiecewise: 0,
      rootsReach: 0,
      rootsAtWatchdog: 0,
      imminentHolds: 0,
    });
  });
});

describe('gpu preparation gate counters', () => {
  it('counts a refused spirit spawn without minting an event kind', () => {
    // The spirit compile gate REFUSES rather than holds: the cast simply has
    // no apparition, which nothing else in a capture could say. It is a
    // counter and not an event because it can fire once per cast in a fight,
    // and a population of them would flush the ring of everything rarer.
    noteSpiritSpawnRefused();
    noteSpiritSpawnRefused();
    noteSpiritSpawnRefused();
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.gates.spiritSpawnsRefused).toBe(3);
    expect(snapshot.total).toBe(0);
    expect(snapshot.events).toEqual([]);
    // ...and it is its OWN population: none of the reveal counters moved.
    expect(snapshot.reveal.keysHeld).toBe(0);
    expect(snapshot.reveal.rootsHeld).toBe(0);
  });

  it('reset clears the gate counters too', () => {
    noteSpiritSpawnRefused();
    resetGpuPrepEventsForTest();
    expect(gpuPrepEventsSnapshot().gates).toEqual({ spiritSpawnsRefused: 0 });
  });
});
