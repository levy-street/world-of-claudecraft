import { describe, expect, it } from 'vitest';

import {
  applyMobScanTick,
  createMobScanTickStats,
  resetMobScanCaptureAccumulators,
} from '../../server/mob_scan_tick_stats';

describe('mob scan tick stats fold', () => {
  it('starts fully zeroed', () => {
    expect(createMobScanTickStats()).toEqual({
      lastAggroScanVisits: 0,
      lastThreatEntryVisits: 0,
      aggroVisitsTotal: 0,
      aggroVisitsMaxPerTick: 0,
      threatVisitsTotal: 0,
      threatVisitsMaxPerTick: 0,
    });
  });

  it('sums totals and peaks the single-tick max while capturing', () => {
    const stats = createMobScanTickStats();
    resetMobScanCaptureAccumulators(stats);
    applyMobScanTick(stats, 3, 7, true);
    applyMobScanTick(stats, 5, 2, true);

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
    applyMobScanTick(stats, 3, 7, true);
    applyMobScanTick(stats, 5, 2, true);
    applyMobScanTick(stats, 4, 1, false);

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
    applyMobScanTick(stats, 3, 7, true);
    applyMobScanTick(stats, 5, 2, true);
    applyMobScanTick(stats, 4, 1, false);

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
