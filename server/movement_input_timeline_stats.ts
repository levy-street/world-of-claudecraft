import type {
  MovementInputSessionState,
  MovementInputTimeline,
} from './movement_input_timeline_v2';

interface TimelineCounters {
  consumed: number;
  starved: number;
  extrapolated: number;
  discardedLate: number;
  droppedOldest: number;
  rejectedAnchoredWindow: number;
  rejectedSanityBound: number;
  resyncs: number;
}

export interface MovementTimelineCaptureTotals {
  movementConsumedTotal: number;
  movementStarvedTotal: number;
  movementExtrapolatedTotal: number;
  movementDiscardedLateTotal: number;
  movementDroppedOldestTotal: number;
  movementRejectedAnchoredWindowTotal: number;
  movementRejectedSanityBoundTotal: number;
  movementResyncsTotal: number;
}

function delta(current: number, previous: number): number {
  return current >= previous ? current - previous : current;
}

export class MovementInputTimelineTickStats {
  lastConsumed = 0;
  lastStarved = 0;
  lastExtrapolated = 0;
  lastDiscardedLate = 0;
  lastDroppedOldest = 0;
  lastRejectedAnchoredWindow = 0;
  lastRejectedSanityBound = 0;
  lastResyncs = 0;

  private movementConsumedTotal = 0;
  private movementStarvedTotal = 0;
  private movementExtrapolatedTotal = 0;
  private movementDiscardedLateTotal = 0;
  private movementDroppedOldestTotal = 0;
  private movementRejectedAnchoredWindowTotal = 0;
  private movementRejectedSanityBoundTotal = 0;
  private movementResyncsTotal = 0;
  private readonly previousByTimeline = new WeakMap<MovementInputTimeline, TimelineCounters>();

  fold(sessions: Iterable<MovementInputSessionState>, capturing: boolean): void {
    let consumed = 0;
    let starved = 0;
    let extrapolated = 0;
    let discardedLate = 0;
    let droppedOldest = 0;
    let rejectedAnchoredWindow = 0;
    let rejectedSanityBound = 0;
    let resyncs = 0;
    for (const session of sessions) {
      const timeline = session.movementTimeline;
      if (session.movementWireVersion !== 2 || !timeline) continue;
      let previous = this.previousByTimeline.get(timeline);
      if (!previous) {
        previous = {
          consumed: 0,
          starved: 0,
          extrapolated: 0,
          discardedLate: 0,
          droppedOldest: 0,
          rejectedAnchoredWindow: 0,
          rejectedSanityBound: 0,
          resyncs: 0,
        };
        this.previousByTimeline.set(timeline, previous);
      }
      consumed += delta(timeline.consumed, previous.consumed);
      starved += delta(timeline.starved, previous.starved);
      extrapolated += delta(timeline.extrapolated, previous.extrapolated);
      discardedLate += delta(timeline.discardedLate, previous.discardedLate);
      droppedOldest += delta(timeline.droppedOldest, previous.droppedOldest);
      rejectedAnchoredWindow += delta(
        timeline.rejectedAnchoredWindow,
        previous.rejectedAnchoredWindow,
      );
      rejectedSanityBound += delta(timeline.rejectedSanityBound, previous.rejectedSanityBound);
      resyncs += delta(timeline.resyncs, previous.resyncs);
      previous.consumed = timeline.consumed;
      previous.starved = timeline.starved;
      previous.extrapolated = timeline.extrapolated;
      previous.discardedLate = timeline.discardedLate;
      previous.droppedOldest = timeline.droppedOldest;
      previous.rejectedAnchoredWindow = timeline.rejectedAnchoredWindow;
      previous.rejectedSanityBound = timeline.rejectedSanityBound;
      previous.resyncs = timeline.resyncs;
    }
    this.lastConsumed = consumed;
    this.lastStarved = starved;
    this.lastExtrapolated = extrapolated;
    this.lastDiscardedLate = discardedLate;
    this.lastDroppedOldest = droppedOldest;
    this.lastRejectedAnchoredWindow = rejectedAnchoredWindow;
    this.lastRejectedSanityBound = rejectedSanityBound;
    this.lastResyncs = resyncs;
    if (!capturing) return;
    this.movementConsumedTotal += consumed;
    this.movementStarvedTotal += starved;
    this.movementExtrapolatedTotal += extrapolated;
    this.movementDiscardedLateTotal += discardedLate;
    this.movementDroppedOldestTotal += droppedOldest;
    this.movementRejectedAnchoredWindowTotal += rejectedAnchoredWindow;
    this.movementRejectedSanityBoundTotal += rejectedSanityBound;
    this.movementResyncsTotal += resyncs;
  }

  resetCapture(): void {
    this.movementConsumedTotal = 0;
    this.movementStarvedTotal = 0;
    this.movementExtrapolatedTotal = 0;
    this.movementDiscardedLateTotal = 0;
    this.movementDroppedOldestTotal = 0;
    this.movementRejectedAnchoredWindowTotal = 0;
    this.movementRejectedSanityBoundTotal = 0;
    this.movementResyncsTotal = 0;
  }

  captureTotals(): MovementTimelineCaptureTotals {
    return {
      movementConsumedTotal: this.movementConsumedTotal,
      movementStarvedTotal: this.movementStarvedTotal,
      movementExtrapolatedTotal: this.movementExtrapolatedTotal,
      movementDiscardedLateTotal: this.movementDiscardedLateTotal,
      movementDroppedOldestTotal: this.movementDroppedOldestTotal,
      movementRejectedAnchoredWindowTotal: this.movementRejectedAnchoredWindowTotal,
      movementRejectedSanityBoundTotal: this.movementRejectedSanityBoundTotal,
      movementResyncsTotal: this.movementResyncsTotal,
    };
  }

  heartbeatTokens(): string {
    return `moveConsumed=${this.lastConsumed} moveStarved=${this.lastStarved} moveExtrapolated=${this.lastExtrapolated} moveLate=${this.lastDiscardedLate} moveDropOldest=${this.lastDroppedOldest} moveRejectWindow=${this.lastRejectedAnchoredWindow} moveRejectSanity=${this.lastRejectedSanityBound} moveResyncs=${this.lastResyncs}`;
  }
}
