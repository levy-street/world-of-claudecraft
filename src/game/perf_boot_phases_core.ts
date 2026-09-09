// The boot load phases the perf beacon ships, read off the load profile's
// spans (load_profiler.ts). The whole profile is published on
// window.__loadProfile for scripts/load_probe.mjs; the fleet only needs the
// phases that decide how long the curtain holds: the renderer construction,
// the entry zone and neighbor-ring prepares, and the initial prewarm, beside
// the entry root that bounds them. Whole milliseconds: a fleet row compares
// seconds, not sub-millisecond noise. Pure: spans in, durations out.

import type { LoadSpanEntry } from './load_profiler';

export const BOOT_PHASE_ROOT = 'entry';

export interface BootPhaseDurations {
  entryMs: number;
  rendererCtorMs: number | null;
  prepareZoneMs: number | null;
  prepareNeighborsMs: number | null;
  prewarmInitialMs: number | null;
}

// The FIRST span of a name by start time: the entry profile is reset at every
// world entry, so the earliest span is the boot one whatever a later arrival
// or rebuild may stamp under the same name.
function firstSpanMs(spans: readonly LoadSpanEntry[], name: string): number | null {
  let first: LoadSpanEntry | null = null;
  for (const span of spans) {
    if (span.name !== name) continue;
    if (!first || span.startTime < first.startTime) first = span;
  }
  return first ? Math.max(0, Math.round(first.duration)) : null;
}

/**
 * Null when no entry root was recorded (a harness that never entered a world,
 * or a browser without the measure API); a missing phase inside a recorded
 * entry stays null on its own field, so a reader can tell "not stamped" from
 * "zero".
 */
export function bootPhaseDurations(spans: readonly LoadSpanEntry[]): BootPhaseDurations | null {
  const entryMs = firstSpanMs(spans, BOOT_PHASE_ROOT);
  if (entryMs === null) return null;
  return {
    entryMs,
    rendererCtorMs: firstSpanMs(spans, 'renderer-ctor'),
    prepareZoneMs: firstSpanMs(spans, 'prepare-zone'),
    prepareNeighborsMs: firstSpanMs(spans, 'prepare-neighbors'),
    prewarmInitialMs: firstSpanMs(spans, 'prewarm-initial'),
  };
}
