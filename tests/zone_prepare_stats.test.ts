import { describe, expect, it } from 'vitest';
import { reportZonePrepare, zonePrepareStatsFrom } from '../src/render/zone_prepare_stats';

const marks = {
  started: 1000,
  skyMs: 250.5,
  terrainStarted: 1010.04,
  terrainDone: 1310.11,
  waterDone: 1350.18,
  featuresDone: 1420.2,
  prepareDone: 1500.06,
};

describe('zonePrepareStatsFrom', () => {
  it('derives each stage from its own clock marks, rounded to 0.1 ms', () => {
    expect(zonePrepareStatsFrom('fenbridge', marks)).toEqual({
      zoneId: 'fenbridge',
      totalMs: 500.1,
      skyMs: 250.5,
      terrainMs: 300.1,
      waterMs: 40.1,
      featuresMs: 70,
    });
  });
});

describe('reportZonePrepare', () => {
  it('records the three awaited stages as wall spans and returns the stats', () => {
    const records: [string, number, number][] = [];
    const ledger = {
      record: (kind: string, ms: number, atMs: number) => records.push([kind, ms, atMs]),
    };
    performance.clearMeasures();
    const stats = reportZonePrepare('fenbridge', ledger, marks);
    expect(stats).toEqual(zonePrepareStatsFrom('fenbridge', marks));
    expect(records).toEqual([
      ['zone-wall:sky', 250.5, 1000],
      ['zone-wall:terrain', 300.1, 1010.04],
      ['zone-wall:water', 40.1, 1310.11],
    ]);
    // Wall spans never carry the features builders: those are main-thread
    // `zone:features:*` records the renderer makes as each builder runs.
    expect(records.some(([kind]) => kind.includes('features'))).toBe(false);
    const measures = performance.getEntriesByType('measure').map((entry) => entry.name);
    expect(measures).toEqual([
      'woc:load:zone:fenbridge',
      'woc:load:zone-prepare/sky',
      'woc:load:zone-prepare/terrain',
      'woc:load:zone-prepare/water',
      'woc:load:zone-prepare/features',
    ]);
  });
});
