import { describe, expect, it } from 'vitest';

import {
  applyMobScanTick,
  createMobScanTickStats,
  type MobScanTickInput,
  ROUTE_SIGHT_KEYS,
  resetMobScanCaptureAccumulators,
  routeSightCaptureTotals,
} from '../../server/mob_scan_tick_stats';
import { createMobScanCounters } from '../../src/sim/mob/scan_counters';

/** One tick's counters: the two visit tallies, and any route or sight tallies. */
function scan(
  aggro: number,
  threat: number,
  more: Partial<MobScanTickInput> = {},
): MobScanTickInput {
  return {
    aggroScanPlayerVisits: aggro,
    threatEntryVisits: threat,
    routePlans: 0,
    routeNodes: 0,
    routeFailed: 0,
    routeDeferred: 0,
    sightQueries: 0,
    ...more,
  };
}

describe('mob scan tick stats fold', () => {
  it('starts fully zeroed', () => {
    const zero = { last: 0, total: 0, maxPerTick: 0 };
    expect(createMobScanTickStats()).toEqual({
      lastAggroScanVisits: 0,
      lastThreatEntryVisits: 0,
      aggroVisitsTotal: 0,
      aggroVisitsMaxPerTick: 0,
      threatVisitsTotal: 0,
      threatVisitsMaxPerTick: 0,
      routeSight: {
        routePlans: zero,
        routeNodes: zero,
        routeFailed: zero,
        routeDeferred: zero,
        sightQueries: zero,
      },
    });
  });

  it('sums totals and peaks the single-tick max while capturing', () => {
    const stats = createMobScanTickStats();
    resetMobScanCaptureAccumulators(stats);
    applyMobScanTick(stats, scan(3, 7), true);
    applyMobScanTick(stats, scan(5, 2), true);

    // Totals are the running sums across both ticks.
    expect(stats.aggroVisitsTotal).toBe(8);
    expect(stats.threatVisitsTotal).toBe(9);
    // Peaks are the largest single tick, NOT the total: aggro peaks on the second
    // tick (5), threat peaks on the first (7), proving Math.max keeps the earlier
    // larger value even after a later smaller one.
    expect(stats.aggroVisitsMaxPerTick).toBe(5);
    expect(stats.threatVisitsMaxPerTick).toBe(7);
    // Latest-tick values reflect the most recent apply.
    expect(stats.lastAggroScanVisits).toBe(5);
    expect(stats.lastThreatEntryVisits).toBe(2);
  });

  it('updates latest values but freezes the accumulators when not capturing', () => {
    const stats = createMobScanTickStats();
    applyMobScanTick(stats, scan(3, 7), true);
    applyMobScanTick(stats, scan(5, 2), true);
    applyMobScanTick(stats, scan(4, 1), false);

    // Latest values track every tick, capturing or not.
    expect(stats.lastAggroScanVisits).toBe(4);
    expect(stats.lastThreatEntryVisits).toBe(1);
    // The four accumulators stay exactly where the captured ticks left them.
    expect(stats.aggroVisitsTotal).toBe(8);
    expect(stats.threatVisitsTotal).toBe(9);
    expect(stats.aggroVisitsMaxPerTick).toBe(5);
    expect(stats.threatVisitsMaxPerTick).toBe(7);
  });

  it('reset zeroes only the accumulators, leaving the latest values as-is', () => {
    const stats = createMobScanTickStats();
    applyMobScanTick(stats, scan(3, 7), true);
    applyMobScanTick(stats, scan(5, 2), true);
    applyMobScanTick(stats, scan(4, 1), false);

    resetMobScanCaptureAccumulators(stats);

    // The four accumulators are back to zero (matches startPerfCapture's behavior).
    expect(stats.aggroVisitsTotal).toBe(0);
    expect(stats.aggroVisitsMaxPerTick).toBe(0);
    expect(stats.threatVisitsTotal).toBe(0);
    expect(stats.threatVisitsMaxPerTick).toBe(0);
    // The latest-tick readout is left untouched by a reset.
    expect(stats.lastAggroScanVisits).toBe(4);
    expect(stats.lastThreatEntryVisits).toBe(1);
  });
});

describe('the route and sight tallies fold like the visit tallies', () => {
  // Five different numbers a tick, so a key folded into its neighbour's tally
  // cannot pass.
  const first = {
    routePlans: 2,
    routeNodes: 1100,
    routeFailed: 1,
    routeDeferred: 3,
    sightQueries: 9,
  };
  const second = {
    routePlans: 1,
    routeNodes: 400,
    routeFailed: 0,
    routeDeferred: 7,
    sightQueries: 24,
  };
  const third = {
    routePlans: 5,
    routeNodes: 900,
    routeFailed: 4,
    routeDeferred: 1,
    sightQueries: 2,
  };

  it('names every route and sight tally the sim counts', () => {
    // The sim's counters object is passed whole: every field of it but the two
    // visit tallies must be folded here, so a counter added to the sim and
    // forgotten on the server fails this.
    const simKeys = Object.keys(createMobScanCounters())
      .filter((k) => k !== 'aggroScanPlayerVisits' && k !== 'threatEntryVisits')
      .sort();
    expect([...ROUTE_SIGHT_KEYS].sort()).toEqual(simKeys);
  });

  it('keeps the latest tick, the window sum and the largest single tick of each', () => {
    const stats = createMobScanTickStats();
    applyMobScanTick(stats, scan(0, 0, first), true);
    applyMobScanTick(stats, scan(0, 0, second), true);
    expect(stats.routeSight).toEqual({
      routePlans: { last: 1, total: 3, maxPerTick: 2 },
      routeNodes: { last: 400, total: 1500, maxPerTick: 1100 },
      routeFailed: { last: 0, total: 1, maxPerTick: 1 },
      routeDeferred: { last: 7, total: 10, maxPerTick: 7 },
      sightQueries: { last: 24, total: 33, maxPerTick: 24 },
    });
  });

  it('outside a capture only the latest tick moves', () => {
    const stats = createMobScanTickStats();
    applyMobScanTick(stats, scan(0, 0, first), true);
    applyMobScanTick(stats, scan(0, 0, third), false);
    expect(stats.routeSight.routePlans).toEqual({ last: 5, total: 2, maxPerTick: 2 });
    expect(stats.routeSight.routeNodes).toEqual({ last: 900, total: 1100, maxPerTick: 1100 });
    expect(stats.routeSight.routeFailed).toEqual({ last: 4, total: 1, maxPerTick: 1 });
    expect(stats.routeSight.routeDeferred).toEqual({ last: 1, total: 3, maxPerTick: 3 });
    expect(stats.routeSight.sightQueries).toEqual({ last: 2, total: 9, maxPerTick: 9 });
  });

  it('a new capture window starts from zero and keeps the latest tick', () => {
    const stats = createMobScanTickStats();
    applyMobScanTick(stats, scan(0, 0, first), true);
    resetMobScanCaptureAccumulators(stats);
    for (const key of ROUTE_SIGHT_KEYS) {
      expect(stats.routeSight[key]).toEqual({ last: first[key], total: 0, maxPerTick: 0 });
    }
  });

  it('hands the perf capture each sum and peak under its own name', () => {
    const stats = createMobScanTickStats();
    applyMobScanTick(stats, scan(0, 0, first), true);
    applyMobScanTick(stats, scan(0, 0, second), true);
    expect(routeSightCaptureTotals(stats)).toEqual({
      routePlansTotal: 3,
      routePlansMaxPerTick: 2,
      routeNodesTotal: 1500,
      routeNodesMaxPerTick: 1100,
      routeFailedTotal: 1,
      routeFailedMaxPerTick: 1,
      routeDeferredTotal: 10,
      routeDeferredMaxPerTick: 7,
      sightQueriesTotal: 33,
      sightQueriesMaxPerTick: 24,
    });
  });
});
