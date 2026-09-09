// The farm-plot load report leaf (src/sim/professions/farm_load_report.ts):
// the dev-channel dropped-row/re-derived-slot counting extracted from
// Sim.addPlayer. Pure pins for the counting half plus the tamper-scalar
// guard; the warn wrapper is exercised through a spy.

import { describe, expect, it, vi } from 'vitest';
import {
  droppedFarmPlotCounts,
  warnDroppedFarmPlotRows,
} from '../src/sim/professions/farm_load_report';
import type { PersistedFarmPlot } from '../src/sim/professions/farm_persist';
import type { PlotState } from '../src/sim/professions/farm_projection';

const NOW = 1_700_000_000_000;

function plot(overrides: Partial<PlotState> = {}): PlotState {
  return {
    cropId: 'vale_wheat',
    plantedAtMs: NOW,
    readyAtMs: NOW + 1000,
    survivalRoll: 0.5,
    yieldSeed: 7,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
    ...overrides,
  };
}

function savedRow(overrides: Partial<PersistedFarmPlot> = {}): PersistedFarmPlot {
  return {
    cropId: 'vale_wheat',
    plantedAtMs: NOW,
    readyAtMs: NOW + 1000,
    survivalRoll: 0.5,
    yieldSeed: 7,
    ...overrides,
  } as PersistedFarmPlot;
}

describe('droppedFarmPlotCounts', () => {
  it('counts rows the load dropped and hidden slots it re-derived', () => {
    const saved = {
      bed_a: savedRow(),
      bed_b: savedRow(),
      bed_c: savedRow({ survivalRoll: Number.NaN }),
    };
    // The load kept bed_a intact, kept bed_c with a re-derived survival slot,
    // and dropped bed_b entirely.
    const live = new Map<string, PlotState>([
      ['bed_a', plot()],
      ['bed_c', plot()],
    ]);
    expect(droppedFarmPlotCounts(saved, live)).toEqual({ rows: 1, slots: 1 });
  });

  it('reads a tampered scalar as zero rows, never index keys', () => {
    // Object.keys('junk') returns index keys, which would fabricate a row
    // count inside the very tamper signal the report exists for.
    expect(
      droppedFarmPlotCounts('junk' as unknown as Record<string, PersistedFarmPlot>, new Map()),
    ).toEqual({ rows: 0, slots: 0 });
    expect(droppedFarmPlotCounts(undefined, new Map())).toEqual({ rows: 0, slots: 0 });
  });
});

describe('warnDroppedFarmPlotRows', () => {
  it('warns once when something dropped and stays silent on a clean load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      warnDroppedFarmPlotRows({ bed_a: savedRow() }, new Map([['bed_a', plot()]]), 'Clean');
      expect(warn).not.toHaveBeenCalled();
      warnDroppedFarmPlotRows({ bed_a: savedRow() }, new Map(), 'Muddy');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('Muddy');
      expect(String(warn.mock.calls[0][0])).toContain('dropped 1 farmPlots row(s)');
    } finally {
      warn.mockRestore();
    }
  });
});
