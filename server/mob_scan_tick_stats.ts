// Per-tick mob-scan observability state for the authoritative loop, folded out of
// GameServer so it is unit-testable without the whole tick body. Holds the latest
// sim tick's mob-scan visit counts (surfaced on the [perf] heartbeat) plus the four
// capture-window accumulators (running totals + per-tick peaks) frozen into a
// PerfCaptureResult. The inputs come from Sim.mobScanCounters; this module
// only records them and draws no rng, so it cannot perturb sim determinism.
//
// The route and sight tallies (src/sim/mob/scan_counters.ts: route searches,
// the cells they judged, searches that failed, mobs the tick's route budget
// deferred, and line-of-sight queries mob casts asked for) are folded the same
// way, one TickTally each: the latest tick, the capture window's sum, and its
// largest single tick. The window's sums and peaks go out on the perf capture
// (routeSightCaptureTotals); the latest-tick values are read off the stats
// object and are not on the [perf] heartbeat line.

/** The Sim.mobScanCounters fields this module folds (structural, so the sim's
 *  own counters object is passed whole). */
export interface MobScanTickInput {
  aggroScanPlayerVisits: number;
  threatEntryVisits: number;
  routePlans: number;
  routeNodes: number;
  routeFailed: number;
  routeDeferred: number;
  sightQueries: number;
}

/** The route and sight tallies folded per tick, in readout order. */
export const ROUTE_SIGHT_KEYS = [
  'routePlans',
  'routeNodes',
  'routeFailed',
  'routeDeferred',
  'sightQueries',
] as const;
export type RouteSightKey = (typeof ROUTE_SIGHT_KEYS)[number];

/** One tally's readout: the latest tick, and the capture window's sum and
 *  largest single tick. */
export interface TickTally {
  last: number;
  total: number;
  maxPerTick: number;
}

export interface MobScanTickStats {
  // Latest sim tick's counts (overwritten every tick, so they read as "most recent").
  lastAggroScanVisits: number;
  lastThreatEntryVisits: number;
  // Capture-window accumulators: summed across the window and peaked per tick.
  aggroVisitsTotal: number;
  aggroVisitsMaxPerTick: number;
  threatVisitsTotal: number;
  threatVisitsMaxPerTick: number;
  // The route and sight tallies, each with its own latest, sum and peak.
  routeSight: Record<RouteSightKey, TickTally>;
}

/** The route and sight sums and peaks of a capture window, flat, as they ride
 *  the PerfCaptureResult. */
export type RouteSightCaptureTotals = {
  [K in RouteSightKey as `${K}Total` | `${K}MaxPerTick`]: number;
};

export function createMobScanTickStats(): MobScanTickStats {
  return {
    lastAggroScanVisits: 0,
    lastThreatEntryVisits: 0,
    aggroVisitsTotal: 0,
    aggroVisitsMaxPerTick: 0,
    threatVisitsTotal: 0,
    threatVisitsMaxPerTick: 0,
    routeSight: {
      routePlans: { last: 0, total: 0, maxPerTick: 0 },
      routeNodes: { last: 0, total: 0, maxPerTick: 0 },
      routeFailed: { last: 0, total: 0, maxPerTick: 0 },
      routeDeferred: { last: 0, total: 0, maxPerTick: 0 },
      sightQueries: { last: 0, total: 0, maxPerTick: 0 },
    },
  };
}

// Zero only the capture-window accumulators, leaving the latest-tick values as-is.
// Mirrors what startPerfCapture does at the top of a fresh window: it resets the
// accumulators, never the latest-tick readout.
export function resetMobScanCaptureAccumulators(stats: MobScanTickStats): void {
  stats.aggroVisitsTotal = 0;
  stats.aggroVisitsMaxPerTick = 0;
  stats.threatVisitsTotal = 0;
  stats.threatVisitsMaxPerTick = 0;
  for (const key of ROUTE_SIGHT_KEYS) {
    const tally = stats.routeSight[key];
    tally.total = 0;
    tally.maxPerTick = 0;
  }
}

// Record one sim tick's mob-scan counts. Always overwrites the latest-tick values;
// when a capture is in flight, also adds to the running totals and raises the
// per-tick peaks (the peak is the largest single tick, not the sum).
export function applyMobScanTick(
  stats: MobScanTickStats,
  scan: Readonly<MobScanTickInput>,
  capturing: boolean,
): void {
  const aggroVisits = scan.aggroScanPlayerVisits;
  const threatVisits = scan.threatEntryVisits;
  stats.lastAggroScanVisits = aggroVisits;
  stats.lastThreatEntryVisits = threatVisits;
  for (const key of ROUTE_SIGHT_KEYS) stats.routeSight[key].last = scan[key];
  if (capturing) {
    stats.aggroVisitsTotal += aggroVisits;
    stats.aggroVisitsMaxPerTick = Math.max(stats.aggroVisitsMaxPerTick, aggroVisits);
    stats.threatVisitsTotal += threatVisits;
    stats.threatVisitsMaxPerTick = Math.max(stats.threatVisitsMaxPerTick, threatVisits);
    for (const key of ROUTE_SIGHT_KEYS) {
      const tally = stats.routeSight[key];
      tally.total += scan[key];
      tally.maxPerTick = Math.max(tally.maxPerTick, scan[key]);
    }
  }
}

/** The capture window's route and sight sums and peaks, for the PerfCaptureResult. */
export function routeSightCaptureTotals(stats: MobScanTickStats): RouteSightCaptureTotals {
  const t = stats.routeSight;
  return {
    routePlansTotal: t.routePlans.total,
    routePlansMaxPerTick: t.routePlans.maxPerTick,
    routeNodesTotal: t.routeNodes.total,
    routeNodesMaxPerTick: t.routeNodes.maxPerTick,
    routeFailedTotal: t.routeFailed.total,
    routeFailedMaxPerTick: t.routeFailed.maxPerTick,
    routeDeferredTotal: t.routeDeferred.total,
    routeDeferredMaxPerTick: t.routeDeferred.maxPerTick,
    sightQueriesTotal: t.sightQueries.total,
    sightQueriesMaxPerTick: t.sightQueries.maxPerTick,
  };
}
