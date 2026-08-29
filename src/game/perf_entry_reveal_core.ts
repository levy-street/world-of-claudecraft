// The perf beacon's view of the world-entry reveal wait: the reveal-gate
// counters the renderer keeps (gpu_prep_events) plus the outcome of every
// curtain wait recorded as an `arrival` event under the entry-wait keys
// (src/render/arrival_cover.ts). Rides in rawSummary (JSONB, no DDL), so a
// release can watch how long the establishing-shot curtain really holds and
// how many imminent keys it lifts on, on the fleet's hardware rather than one
// probe rig. Pure: no DOM, no renderer import beyond types.

import type { GpuPrepEvent, GpuPrepRevealCounters } from '../render/gpu_prep_events';

export const ENTRY_REVEAL_WAIT_LIMIT = 4;
const ENTRY_WAIT_KEY_PREFIX = 'entry-wait';

export interface EntryRevealWaitSummary {
  key: string;
  waitedMs: number;
  boundMs: number | null;
  heldAtLift: number | null;
}

export interface EntryRevealSummary {
  keysHeld: number;
  rootsHeld: number;
  rootsAtWatchdog: number;
  imminentHolds: number;
  waits: EntryRevealWaitSummary[];
}

export interface EntryRevealSource {
  events: {
    reveal: Readonly<GpuPrepRevealCounters>;
    events: readonly Readonly<GpuPrepEvent>[];
  };
}

export function entryRevealSummary(
  gpuPrep: EntryRevealSource | null | undefined,
): EntryRevealSummary | null {
  if (!gpuPrep?.events?.reveal) return null;
  const { reveal, events } = gpuPrep.events;
  const waits: EntryRevealWaitSummary[] = [];
  for (const event of events) {
    if (event.kind !== 'arrival' || !event.key.startsWith(ENTRY_WAIT_KEY_PREFIX)) continue;
    if (waits.length >= ENTRY_REVEAL_WAIT_LIMIT) break;
    waits.push({
      key: event.key,
      waitedMs: Math.round(event.ageMs),
      boundMs: typeof event.units === 'number' ? Math.round(event.units) : null,
      heldAtLift: typeof event.totalRoots === 'number' ? event.totalRoots : null,
    });
  }
  return {
    keysHeld: reveal.keysHeld,
    rootsHeld: reveal.rootsHeld,
    rootsAtWatchdog: reveal.rootsAtWatchdog,
    imminentHolds: reveal.imminentHolds,
    waits,
  };
}
