// The PERF_TICK_LOG heartbeat's line FORMATTERS, moved whole out of
// GameServer.maybeLogTickPerf (server/game.ts, the monolith ratchet) so the
// token set is a pure function a Vitest pins directly: the parser in
// scripts/lib/mob_stall_parse.mjs reads these lines token by token, and
// tests/mob_stall_parse.test.ts carries verbatim samples of them, so a format
// change here is a deliberate one. game.ts keeps only the gating (the
// over-budget / heartbeat cadence) and the three console.log calls.
//
// The [perf] line: online, entity count, achieved Hz, this pass's loop time
// (OVER when it blew the 50 ms budget), the p95/max of the outer phases, the
// broadcast crowd counters (visits / serializes / serializeMs and the timer
// variants), the mob-scan visit counters (server/mob_scan_tick_stats.ts), and
// since Phase 18 the p99 character blob size (blobP99=, bytes, the count-
// windowed ring in server/character_blob_size.ts): the heartbeat is the cheap
// always-on view of the same signal woc_character_state_bytes_p99 scrapes.

import { ZONES } from '../src/sim/data';
import type { PhaseStats } from './tick_profiler';

// Per-zone attribution buckets for the mob.update phase (moved here from
// server/game.ts with the line that prints them). The mob loop tags each
// mob.update lap with its entity; the host splits that slice of the phase time
// by the mob's zone/group so a stall localizes to "which zone froze" instead of
// only the phase total. These are HOST-DERIVED (the sim never emits them), so
// they are registered in the profiler but deliberately kept OUT of
// SIM_LAP_PHASES (which pins the sim's own emissions). Overworld mobs bucket by
// zone id; instance/delve mobs (x beyond DUNGEON_X_THRESHOLD) share one
// 'instance' bucket; 'other' is a safety net.
export const MOB_ZONE_PHASE_PREFIX = 'sim.mob.z:';
export const MOB_ZONE_PHASE_INSTANCE = `${MOB_ZONE_PHASE_PREFIX}instance`;
export const MOB_ZONE_PHASE_OTHER = `${MOB_ZONE_PHASE_PREFIX}other`;
/** Pre-interned zone-id -> phase-name map so the per-mob probe allocates no strings. */
export const MOB_ZONE_PHASE_BY_ID = new Map<string, string>(
  ZONES.map((z) => [z.id, `${MOB_ZONE_PHASE_PREFIX}${z.id}`]),
);
export const SIM_MOB_ZONE_PHASES = [
  ...ZONES.map((z) => `${MOB_ZONE_PHASE_PREFIX}${z.id}`),
  MOB_ZONE_PHASE_INSTANCE,
  MOB_ZONE_PHASE_OTHER,
];

/** The outer loop phases the [perf] line prints, in print order. */
export const TICK_PERF_LINE_PHASES = [
  'total',
  'tick',
  'broadcast',
  'bcastSelf',
  'bcastGrid',
  'events',
  'social',
] as const;

export interface TickPerfLineInputs {
  online: number;
  ents: number;
  /** Achieved sim Hz, or null while the rate meter warms up (prints n/a). */
  tickHz: number | null;
  tickMs: number;
  overBudget: boolean;
  /** The profiler's per-phase stats, keyed by phase name. */
  phases: Record<string, PhaseStats>;
  visits: number;
  serializes: number;
  baseSerializes: number;
  serializeNs: bigint;
  legacySerializes: number;
  stableSerializes: number;
  aggroVisits: number;
  threatVisits: number;
  /** The p99 serialized character blob over recent saves, bytes (0 before any save). */
  blobP99Bytes: number;
}

/** Two-decimal rounding for wire and log numerics. Exported because
 *  server/game.ts carried a byte-identical private copy: the entity/self wire
 *  encoder and this line formatter round the same way on purpose (a log figure
 *  and the wire figure beside it must not disagree in their last digit), so the
 *  rule lives once, here, and game.ts imports it. */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The [perf] heartbeat / over-budget line. */
export function formatTickPerfLine(i: TickPerfLineInputs): string {
  const p = i.phases;
  const fmt = (n: string) => `${n}=${p[n].p95}/${p[n].max}`;
  return (
    `[perf] online=${i.online} ents=${i.ents} tickHz=${i.tickHz == null ? 'n/a' : round2(i.tickHz)} tickMs=${round2(i.tickMs)}${i.overBudget ? ' OVER' : ''}` +
    ` | p95/max ${TICK_PERF_LINE_PHASES.map(fmt).join(' ')}` +
    ` | visits=${i.visits} serializes=${i.serializes} baseSerializes=${i.baseSerializes} serializeMs=${round2(Number(i.serializeNs) / 1e6)} timerVariants=${i.legacySerializes}/${i.stableSerializes} aggroVisits=${i.aggroVisits} threatVisits=${i.threatVisits} blobP99=${i.blobP99Bytes}`
  );
}

/** The [perf.sim] line: the sim.tick() internal breakdown, mean-sorted so the
 *  phase that actually eats the average (not just a spike) leads; the top 14.
 *  Null when no sim phase has timing (detailed timing off, or a quiet tick). */
export function formatSimPhaseLine(
  phases: Record<string, PhaseStats>,
  simLapPhases: readonly string[],
): string | null {
  const simPhases = simLapPhases
    .filter((n) => phases[n] && phases[n].mean > 0)
    .sort((a, b) => phases[b].mean - phases[a].mean);
  if (simPhases.length === 0) return null;
  const fmtMean = (n: string) =>
    `${n.slice(4)}=${phases[n].mean}/${phases[n].p95}/${phases[n].max}`;
  return `[perf.sim] mean/p95/max ${simPhases.slice(0, 14).map(fmtMean).join(' ')}`;
}

/** The [perf.sim.mob] line: the per-zone split of mob.update over the
 *  SIM_MOB_ZONE_PHASES buckets above, mean-sorted so the zone eating the phase
 *  leads. Null unless some zone carries cost, so a normal tick stays quiet. */
export function formatMobZoneLine(phases: Record<string, PhaseStats>): string | null {
  const zonePhases = SIM_MOB_ZONE_PHASES.filter((n) => phases[n] && phases[n].mean > 0).sort(
    (a, b) => phases[b].mean - phases[a].mean,
  );
  if (zonePhases.length === 0) return null;
  const fmtZone = (n: string) =>
    `${n.slice(MOB_ZONE_PHASE_PREFIX.length)}=${phases[n].mean}/${phases[n].p95}/${phases[n].max}`;
  return `[perf.sim.mob] zone mean/p95/max ${zonePhases.map(fmtZone).join(' ')}`;
}
