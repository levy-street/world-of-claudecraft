import type { TickProfile } from './tick_profiler';

export interface PerfCaptureResult {
  captureId: string;
  capturedAt: number;
  durationMs: number;
  loopCallbacks: number;
  simTicks: number;
  catchUpCallbacks: number;
  maxTicksPerCallback: number;
  online: number;
  simEntities: number;
  aggroVisitsTotal: number;
  aggroVisitsMaxPerTick: number;
  threatVisitsTotal: number;
  threatVisitsMaxPerTick: number;
  routePlansTotal: number;
  routePlansMaxPerTick: number;
  routeNodesTotal: number;
  routeNodesMaxPerTick: number;
  routeFailedTotal: number;
  routeFailedMaxPerTick: number;
  routeDeferredTotal: number;
  routeDeferredMaxPerTick: number;
  sightQueriesTotal: number;
  sightQueriesMaxPerTick: number;
  movementConsumedTotal: number;
  movementStarvedTotal: number;
  movementExtrapolatedTotal: number;
  movementDiscardedLateTotal: number;
  movementDroppedOldestTotal: number;
  movementRejectedAnchoredWindowTotal: number;
  movementRejectedSanityBoundTotal: number;
  movementResyncsTotal: number;
  profile: TickProfile;
}

export interface PerfCaptureStatus {
  captureId: string | null;
  capturing: boolean;
  endsAt: number | null;
  last: PerfCaptureResult | null;
}
