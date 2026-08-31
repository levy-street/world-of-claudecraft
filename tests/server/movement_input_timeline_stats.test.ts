import { describe, expect, it } from 'vitest';
import { createDungeonEntryFacingFence } from '../../server/dungeon_entry_facing';
import { MovementInputTimelineTickStats } from '../../server/movement_input_timeline_stats';
import {
  createMovementInputSessionState,
  type MovementInputSessionState,
  type MovementInputTimeline,
} from '../../server/movement_input_timeline_v2';

function session(pid: number): MovementInputSessionState {
  return {
    pid,
    lastInputAt: 0,
    ...createMovementInputSessionState(2),
    dungeonEntryFacing: createDungeonEntryFacingFence(0, false),
  };
}

describe('movement input timeline tick stats', () => {
  it('folds per-session counter deltas into one tick and capture totals', () => {
    const stats = new MovementInputTimelineTickStats();
    const first = session(1);
    const second = session(2);
    const firstTimeline = first.movementTimeline as MovementInputTimeline;
    const secondTimeline = second.movementTimeline as MovementInputTimeline;
    firstTimeline.consumed = 2;
    firstTimeline.starved = 1;
    firstTimeline.extrapolated = 1;
    secondTimeline.consumed = 3;
    secondTimeline.discardedLate = 2;
    secondTimeline.droppedOldest = 1;
    secondTimeline.rejectedAnchoredWindow = 3;
    secondTimeline.rejectedSanityBound = 4;
    secondTimeline.resyncs = 1;

    stats.fold([first, second], true);

    expect({
      consumed: stats.lastConsumed,
      starved: stats.lastStarved,
      extrapolated: stats.lastExtrapolated,
      discardedLate: stats.lastDiscardedLate,
      droppedOldest: stats.lastDroppedOldest,
      rejectedAnchoredWindow: stats.lastRejectedAnchoredWindow,
      rejectedSanityBound: stats.lastRejectedSanityBound,
      resyncs: stats.lastResyncs,
    }).toEqual({
      consumed: 5,
      starved: 1,
      extrapolated: 1,
      discardedLate: 2,
      droppedOldest: 1,
      rejectedAnchoredWindow: 3,
      rejectedSanityBound: 4,
      resyncs: 1,
    });

    firstTimeline.consumed++;
    secondTimeline.starved += 2;
    stats.fold([first, second], true);
    expect(stats.captureTotals()).toEqual({
      movementConsumedTotal: 6,
      movementStarvedTotal: 3,
      movementExtrapolatedTotal: 1,
      movementDiscardedLateTotal: 2,
      movementDroppedOldestTotal: 1,
      movementRejectedAnchoredWindowTotal: 3,
      movementRejectedSanityBoundTotal: 4,
      movementResyncsTotal: 1,
    });
  });

  it('does not recount unchanged cumulative counters and resets capture totals only', () => {
    const stats = new MovementInputTimelineTickStats();
    const active = session(1);
    const timeline = active.movementTimeline as MovementInputTimeline;
    timeline.consumed = 4;
    timeline.starved = 5;
    timeline.extrapolated = 3;
    timeline.discardedLate = 2;
    timeline.droppedOldest = 1;
    timeline.rejectedAnchoredWindow = 3;
    timeline.rejectedSanityBound = 4;
    timeline.resyncs = 6;
    stats.fold([active], true);
    stats.fold([active], true);
    expect(stats.lastConsumed).toBe(0);
    expect(stats.captureTotals()).toEqual({
      movementConsumedTotal: 4,
      movementStarvedTotal: 5,
      movementExtrapolatedTotal: 3,
      movementDiscardedLateTotal: 2,
      movementDroppedOldestTotal: 1,
      movementRejectedAnchoredWindowTotal: 3,
      movementRejectedSanityBoundTotal: 4,
      movementResyncsTotal: 6,
    });

    stats.resetCapture();
    expect(stats.captureTotals()).toEqual({
      movementConsumedTotal: 0,
      movementStarvedTotal: 0,
      movementExtrapolatedTotal: 0,
      movementDiscardedLateTotal: 0,
      movementDroppedOldestTotal: 0,
      movementRejectedAnchoredWindowTotal: 0,
      movementRejectedSanityBoundTotal: 0,
      movementResyncsTotal: 0,
    });
    expect(stats.lastConsumed).toBe(0);
  });
});
