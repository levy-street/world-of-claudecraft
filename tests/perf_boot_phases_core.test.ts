import { describe, expect, it } from 'vitest';
import type { LoadSpanEntry } from '../src/game/load_profiler';
import { BOOT_PHASE_ROOT, bootPhaseDurations } from '../src/game/perf_boot_phases_core';

const span = (name: string, startTime: number, duration: number): LoadSpanEntry => ({
  name,
  startTime,
  duration,
});

describe('bootPhaseDurations', () => {
  it('is null without an entry root (a harness that never entered a world)', () => {
    expect(bootPhaseDurations([])).toBeNull();
    expect(bootPhaseDurations([span('renderer-ctor', 10, 40)])).toBeNull();
    expect(BOOT_PHASE_ROOT).toBe('entry');
  });

  it('picks the four curtain phases beside the entry root, in whole milliseconds', () => {
    expect(
      bootPhaseDurations([
        span('entry', 0, 6120.49),
        span('sim-build', 0, 30),
        span('renderer-ctor', 10, 812.6),
        // The renderer's own sub-measures are NOT the phase.
        span('renderer-ctor/terrain', 12, 400),
        span('prepare-zone', 900, 1500.2),
        span('prepare-neighbors', 2400, 300.5),
        span('prewarm-initial', 2700, 3000),
        span('curtain-fade', 5800, 320),
      ]),
    ).toEqual({
      entryMs: 6120,
      rendererCtorMs: 813,
      prepareZoneMs: 1500,
      prepareNeighborsMs: 301,
      prewarmInitialMs: 3000,
    });
  });

  it('leaves a phase that was never stamped null, distinct from zero', () => {
    expect(bootPhaseDurations([span('entry', 0, 100), span('prepare-zone', 5, 0)])).toEqual({
      entryMs: 100,
      rendererCtorMs: null,
      prepareZoneMs: 0,
      prepareNeighborsMs: null,
      prewarmInitialMs: null,
    });
  });

  it('keeps the FIRST span of a name by start time, whatever order the timeline lists them in', () => {
    expect(
      bootPhaseDurations([
        span('renderer-ctor', 5000, 90),
        span('entry', 0, 8000),
        span('renderer-ctor', 10, 700),
      ])?.rendererCtorMs,
    ).toBe(700);
  });

  it('clamps a negative duration to zero', () => {
    expect(bootPhaseDurations([span('entry', 0, -4)])?.entryMs).toBe(0);
  });
});
