// Per-tick mob-scan observability state for the authoritative loop, folded out of
// GameServer so it is unit-testable without the whole tick body. Holds the latest
// sim tick's mob-scan visit counts (surfaced on the [perf] heartbeat) plus the four
// capture-window accumulators (running totals + per-tick peaks) frozen into a
// PerfCaptureResult. The two visit inputs come from Sim.mobScanCounters; this module
// only records them and draws no rng, so it cannot perturb sim determinism.

export interface MobScanTickStats {
  // Latest sim tick's counts (overwritten every tick, so they read as "most recent").
  lastAggroScanVisits: number;
  lastThreatEntryVisits: number;
  // Capture-window accumulators: summed across the window and peaked per tick.
  aggroVisitsTotal: number;
  aggroVisitsMaxPerTick: number;
  threatVisitsTotal: number;
  threatVisitsMaxPerTick: number;
}

export function createMobScanTickStats(): MobScanTickStats {
  return {
    lastAggroScanVisits: 0,
    lastThreatEntryVisits: 0,
    aggroVisitsTotal: 0,
    aggroVisitsMaxPerTick: 0,
    threatVisitsTotal: 0,
    threatVisitsMaxPerTick: 0,
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
}

// Record one sim tick's mob-scan counts. Always overwrites the latest-tick values;
// when a capture is in flight, also adds to both running totals and raises both
// per-tick peaks (the peak is the largest single tick, not the sum).
export function applyMobScanTick(
  stats: MobScanTickStats,
  aggroVisits: number,
  threatVisits: number,
  capturing: boolean,
): void {
  stats.lastAggroScanVisits = aggroVisits;
  stats.lastThreatEntryVisits = threatVisits;
  if (capturing) {
    stats.aggroVisitsTotal += aggroVisits;
    stats.aggroVisitsMaxPerTick = Math.max(stats.aggroVisitsMaxPerTick, aggroVisits);
    stats.threatVisitsTotal += threatVisits;
    stats.threatVisitsMaxPerTick = Math.max(stats.threatVisitsMaxPerTick, threatVisits);
  }
}
