// The per-pid event index (server/event_pid_index.ts): the routing counterpart
// to event_frame's serialize-once. These pin the two properties routeEvents
// rests on: a session visits exactly the indices it can be delivered (order
// preserved, nothing visited twice), and its visit COUNT no longer scales with
// the batch, which is the whole point of the index.

import { describe, expect, it } from 'vitest';
import { buildEventPidIndex, forEachSelectedEventIndex } from '../server/event_pid_index';
import type { SimEvent } from '../src/sim/types';

/** A pid-scoped event (the zone-celebration shape: one copy per recipient). */
function scoped(pid: number): SimEvent {
  return { type: 'masterworkZone', pid } as unknown as SimEvent;
}

/** A pid-less event: chat, a world log line, a ground fx. */
function world(): SimEvent {
  return { type: 'chat', channel: 'say', fromPid: 1, from: 'A', text: 'hi' } as unknown as SimEvent;
}

function selected(events: readonly SimEvent[], anchorPid: number, selfPid: number): number[] {
  const index = buildEventPidIndex(events);
  const out: number[] = [];
  forEachSelectedEventIndex(index, anchorPid, selfPid, (i) => out.push(i));
  return out;
}

describe('buildEventPidIndex', () => {
  it('buckets by pid in ascending batch order and separates the pid-less set', () => {
    const events = [scoped(7), world(), scoped(9), scoped(7), world()];
    const index = buildEventPidIndex(events);
    expect(index.forPid(7)).toEqual([0, 3]);
    expect(index.forPid(9)).toEqual([2]);
    expect(index.broadcast).toEqual([1, 4]);
  });

  it('never aliases two present pids onto one list', () => {
    // The premise the merge walk's pid comparison rests on: distinct pids key
    // distinct Map entries, so the ONLY way to hold one list twice is to ask
    // for one pid twice (the degenerate self-spectate case below). Without
    // this, that guard's sufficiency is only asserted in a comment.
    const index = buildEventPidIndex([scoped(7), scoped(9)]);
    expect(index.forPid(7)).not.toBe(index.forPid(9));
    expect(index.forPid(7)).toBe(index.forPid(7));
  });

  it('returns an empty list for a pid the batch never addresses', () => {
    const index = buildEventPidIndex([scoped(7)]);
    expect(index.forPid(1234)).toEqual([]);
    // The same shared constant, so a miss allocates nothing per session. Two
    // pids that both miss therefore DO share one list; it is empty, so the
    // merge walk contributes no index from it either time.
    expect(index.forPid(1234)).toBe(index.forPid(5678));
  });

  it('an empty batch indexes to nothing', () => {
    const index = buildEventPidIndex([]);
    expect(index.broadcast).toEqual([]);
    expect(index.forPid(1)).toEqual([]);
  });
});

describe('forEachSelectedEventIndex', () => {
  it('merges the pid-scoped and broadcast lists in ORIGINAL batch order', () => {
    // Interleaved on purpose: a naive "own events, then broadcast" walk would
    // return [0, 3, 1, 4] and reorder the session's frame.
    const events = [scoped(7), world(), scoped(9), scoped(7), world()];
    expect(selected(events, 7, 7)).toEqual([0, 1, 3, 4]);
  });

  it('a non-spectating session visits its own events plus the broadcast set, and nothing else', () => {
    const events = [scoped(7), scoped(8), scoped(9), world(), scoped(8)];
    expect(selected(events, 8, 8)).toEqual([1, 3, 4]);
  });

  it('a spectator visits the anchor pid AND its own pid, merged in batch order', () => {
    // The spectate case: the frame carries the watched fighter's events plus
    // the spectator's own whispers and party chat.
    const events = [scoped(7), scoped(8), world(), scoped(7), scoped(8)];
    expect(selected(events, 7, 8)).toEqual([0, 1, 2, 3, 4]);
  });

  it('a session spectating its own pid visits each index exactly once', () => {
    // Degenerate but reachable (sessionByCharacterId resolving back to the
    // watcher): both lists are the same list, and visiting it twice would
    // duplicate every event in that session's frame.
    const events = [scoped(7), world(), scoped(7)];
    expect(selected(events, 7, 7)).toEqual([0, 1, 2]);
  });

  it('a session addressed by nothing still visits the whole broadcast set', () => {
    const events = [scoped(7), world(), scoped(9), world()];
    expect(selected(events, 42, 42)).toEqual([1, 3]);
  });

  it('a spectator whose anchor and own pid BOTH miss shares one empty list harmlessly', () => {
    // Distinct pids, so the walk takes the index.forPid(selfPid) arm, and both
    // lookups return the SAME shared EMPTY constant. Sharing it must not
    // double or drop anything: an empty list contributes no index either time.
    const events = [scoped(7), world(), scoped(9), world()];
    expect(selected(events, 42, 43)).toEqual([1, 3]);
  });

  it('visits nothing for an empty batch', () => {
    expect(selected([], 7, 7)).toEqual([]);
  });
});

describe('the per-session visit count no longer scales with the batch', () => {
  /** The measured shape: one pid-scoped celebration copy per in-zone recipient
   *  plus a small pid-less remainder, which is what the full walk charged every
   *  session in full. */
  function celebrationBatch(recipients: number, worldEvents: number): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < worldEvents; i++) events.push(world());
    for (let i = 0; i < recipients; i++) events.push(scoped(100 + i));
    return events;
  }

  function visitsForOneSession(events: readonly SimEvent[], pid: number): number {
    const index = buildEventPidIndex(events);
    let visits = 0;
    forEachSelectedEventIndex(index, pid, pid, () => {
      visits++;
    });
    return visits;
  }

  it('one recipient session pays its own events plus the broadcast set at every batch size', () => {
    // The full walk charged this session the whole batch: 203, then 1,003, then
    // 5,003. The index charges 1 + 3 at all three, so growing the recipient set
    // does not grow anybody's per-session cost.
    for (const recipients of [200, 1_000, 5_000]) {
      const events = celebrationBatch(recipients, 3);
      expect(events).toHaveLength(recipients + 3);
      expect(visitsForOneSession(events, 100)).toBe(1 + 3);
    }
  });

  it('a session outside the celebration pays only the broadcast set', () => {
    // The case the old walk wasted most on: 5,000 iterations for 3 deliveries.
    const events = celebrationBatch(5_000, 3);
    expect(visitsForOneSession(events, 999_999)).toBe(3);
  });

  it('the whole-realm selection total is linear in deliveries, not recipients x sessions', () => {
    // The recorded ceiling, at 1/50th scale so the old term is still countable:
    // 100 in-zone recipients among 100 sessions. The full walk ran
    // sessions x batch = 100 x 103 = 10,300 selection iterations; the index
    // runs 100 x (1 + 3) = 400. Both totals are asserted, so a regression that
    // reintroduced the full walk fails here rather than only getting slower.
    const sessions = 100;
    const recipients = 100;
    const worldEvents = 3;
    const events = celebrationBatch(recipients, worldEvents);
    const index = buildEventPidIndex(events);
    let visits = 0;
    for (let s = 0; s < sessions; s++) {
      const pid = 100 + s;
      forEachSelectedEventIndex(index, pid, pid, () => {
        visits++;
      });
    }
    expect(sessions * events.length).toBe(10_300);
    expect(visits).toBe(sessions * (1 + worldEvents));
    expect(visits).toBe(400);
  });
});
