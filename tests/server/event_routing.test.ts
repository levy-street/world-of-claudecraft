// Unit tests for the per-tick event routing index: the pid bucketing and the
// order-preserving candidate merge that routeEvents rebuilds each batch. The
// wire-level guarantee (each session still receives exactly the events the old
// full scan produced, in batch order) is pinned end-to-end by
// tests/server/broadcast_golden.test.ts rawEventsSha; these tests pin the
// primitives' edge cases directly.
import { describe, expect, it } from 'vitest';
import { indexEventsForRouting, mergeCandidates } from '../../server/event_routing';
import type { SimEvent } from '../../src/sim/types';

const ev = (over: Record<string, unknown>): SimEvent => over as unknown as SimEvent;

describe('indexEventsForRouting', () => {
  it('buckets pid events per pid and world events separately, preserving batch order', () => {
    const events = [
      ev({ type: 'damage', pid: 1, n: 0 }),
      ev({ type: 'zoneBoss', n: 1 }),
      ev({ type: 'damage', pid: 2, n: 2 }),
      ev({ type: 'heal', pid: 1, n: 3 }),
      ev({ type: 'chat', pid: 0, n: 4 }),
    ];
    const { byPid, world } = indexEventsForRouting(events);
    expect([...byPid.keys()].sort()).toEqual([0, 1, 2]);
    expect(byPid.get(1)?.map((w) => w.idx)).toEqual([0, 3]);
    // pid 0 is a valid pid, not a missing one
    expect(byPid.get(0)?.map((w) => w.idx)).toEqual([4]);
    expect(world.map((w) => w.idx)).toEqual([1]);
  });
});

describe('mergeCandidates', () => {
  const mk = (idxs: number[]) => idxs.map((idx) => ({ ev: ev({ idx }), idx }));
  const collect = (
    a?: ReturnType<typeof mk>,
    b?: ReturnType<typeof mk>,
    c?: ReturnType<typeof mk>,
  ): number[] => {
    const out: number[] = [];
    mergeCandidates(a, b, c, (e) => out.push((e as unknown as { idx: number }).idx));
    return out;
  };

  it('merges three disjoint lists into batch order', () => {
    expect(collect(mk([0, 5, 9]), mk([2, 3]), mk([1, 8]))).toEqual([0, 1, 2, 3, 5, 8, 9]);
  });

  it('collapses shared list identity (own === anchor) without double-visiting', () => {
    const own = mk([1, 4]);
    expect(collect(own, own, mk([0, 2]))).toEqual([0, 1, 2, 4]);
  });

  it('handles undefined lists and empty input', () => {
    expect(collect(undefined, undefined, undefined)).toEqual([]);
    expect(collect(undefined, mk([3]), undefined)).toEqual([3]);
  });

  it('visits every event exactly once with interleaved equal-adjacent runs', () => {
    expect(collect(mk([0, 1, 2]), mk([3, 4, 5]), mk([6, 7]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
