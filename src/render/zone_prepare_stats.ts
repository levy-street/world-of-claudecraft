// The stage wall-times of a zone prepare (renderer.ts prepareZoneAt) and the
// streaming readout perfStats() exports, plus the one report step that turns
// the prepare's clock marks into every consumer at once: the boot profiler
// lanes, the build ledger's wall spans, and the stats the renderer keeps.
// Named here so the coordinator keeps the code that takes the marks and not
// the literals that describe them.
//
// On a background prepare skyMs OVERLAPS terrainMs (the lanes run
// concurrently), so the stages do not sum to totalMs. Each is its own lane's
// wall time, which is what the pacing work reads them for; the main-thread
// share of a prepare is the feature builders, which the build ledger records
// per builder (build_ledger_core `zone:features:<builder>`).

import type { BuildLedger } from './build_ledger_core';
import { renderLoadMeasure } from './load_marks';

export interface ZonePrepareStats {
  zoneId: string;
  totalMs: number;
  skyMs: number;
  terrainMs: number;
  waterMs: number;
  featuresMs: number;
}

/** Stage wall-times of the most recent prewarmZoneAt, for perf tooling. */
export interface ZonePrewarmStats {
  zoneId: string;
  buildMs: number;
  compileMs: number;
  passMs: number;
}

export interface ZoneStreamingStats {
  prepared: number;
  pending: number;
  last: ZonePrepareStats | null;
}

/** The clock readings prepareZoneAt takes between its stages. */
export interface ZonePrepareMarks {
  started: number;
  skyMs: number;
  terrainStarted: number;
  terrainDone: number;
  waterDone: number;
  featuresDone: number;
  prepareDone: number;
}

const roundTenth = (v: number): number => Math.round(v * 10) / 10;

export function zonePrepareStatsFrom(zoneId: string, marks: ZonePrepareMarks): ZonePrepareStats {
  return {
    zoneId,
    totalMs: roundTenth(marks.prepareDone - marks.started),
    skyMs: marks.skyMs,
    terrainMs: roundTenth(marks.terrainDone - marks.terrainStarted),
    waterMs: roundTenth(marks.waterDone - marks.terrainDone),
    featuresMs: roundTenth(marks.featuresDone - marks.waterDone),
  };
}

/**
 * One finished zone prepare: boot profiler lanes (aggregated by name across
 * zones, nested under the caller's phase by containment; the whole-zone span
 * carries the id), the ledger's `zone-wall:*` spans (awaited sliced work, so
 * wall time the ledger keeps per kind and out of the frame spend), and the
 * stats the renderer reports.
 */
export function reportZonePrepare(
  zoneId: string,
  ledger: Pick<BuildLedger, 'record'>,
  marks: ZonePrepareMarks,
): ZonePrepareStats {
  const stats = zonePrepareStatsFrom(zoneId, marks);
  renderLoadMeasure(`zone:${zoneId}`, marks.started, marks.prepareDone);
  renderLoadMeasure('zone-prepare/sky', marks.started, marks.started + marks.skyMs);
  renderLoadMeasure('zone-prepare/terrain', marks.terrainStarted, marks.terrainDone);
  renderLoadMeasure('zone-prepare/water', marks.terrainDone, marks.waterDone);
  renderLoadMeasure('zone-prepare/features', marks.waterDone, marks.featuresDone);
  ledger.record('zone-wall:sky', stats.skyMs, marks.started);
  ledger.record('zone-wall:terrain', stats.terrainMs, marks.terrainStarted);
  ledger.record('zone-wall:water', stats.waterMs, marks.terrainDone);
  return stats;
}
