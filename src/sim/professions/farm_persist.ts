// Persisting per-player farm plot state across save/load (patches-and-plots
// phase).
//
// `PlayerMeta.farmPlots` maps bed id to the full PlotState record
// (src/sim/professions/farm_projection.ts); this module is the only bridge
// between that live Map and the `CharacterState.farmPlots` JSONB row shape.
// Growth deadlines are ABSOLUTE milliseconds in the saving host's own
// lockoutNowMs base (epoch ms on the server, the raidLockouts idiom), never
// remaining-time deltas: a crop keeps growing while its owner is logged out,
// so freezing the timer at the logout frame (the node_persist.ts scheme)
// would be the wrong contract here. A save is only ever loaded by the SAME
// kind of host that wrote it (serializeCharacter has no caller outside
// server/, and the offline hosts keep plots session-local), which is the
// assumption behind the nowMs > 0 guard below; a phase that ever moves a
// blob across clock bases must revisit both.
//
// ANTI-TAMPER DOCTRINE (node_persist.ts, copied deliberately): serialize
// neither clamps nor filters. Rows write verbatim, because the live writers
// only ever mint valid rows, and BOTH anti-tamper arms (the bed/crop
// allowlists and the duration clamp) live on the LOAD side
// (normalizeFarmPlots below), where hand-edited JSONB enters. A write-side
// copy would only mask a writer bug.
//
// Pure leaf: no SimContext, no content-table import, no rng, explicit
// arguments only (the node_persist.ts / fishing_zones.ts contract), so a
// Vitest drives it without a live Sim. The allowlists arrive as arguments;
// callers pass FARM_BED_IDS / FARM_CROP_IDS from
// src/sim/content/farm_patches.ts.

import type { PlotState } from './farm_projection';

// The persisted row shape. The three required fields are what a plot cannot
// exist without; every flag is written ONLY when true and every hidden slot
// ONLY when present, so an unplanted bed and a pre-farming save reach the
// same bytes (zero-default omission all the way down).
export interface PersistedFarmPlot {
  cropId: string;
  plantedAtMs: number;
  readyAtMs: number;
  survivalRoll?: number;
  yieldSeed?: number;
  compost?: boolean;
  watch?: boolean;
  tonic?: boolean;
  notified?: boolean;
}

// A TAMPER CEILING on persisted growth duration, not a gameplay number: the
// real crop durations arrive with the growth phase and sit far under it. It
// exists so a hand-edited row can never park a bed under a millennium-long
// timer that no in-game action can clear.
export const FARM_MAX_GROW_MS = 7 * 24 * 60 * 60 * 1000;

const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Snapshot the live plot map as persisted rows. Returns undefined when no bed
 *  is planted (zero-default omission), so a character who has never farmed
 *  serializes byte-identically to a save made before the field existed.
 *  Neither clamps nor filters: see the load-side anti-tamper doctrine above.
 *  A non-finite hidden slot is the one omission, and it is JSON hygiene rather
 *  than filtering: NaN and Infinity are not representable in JSON and would
 *  round-trip as null, which is worse than absent. */
export function serializeFarmPlots(
  plots: ReadonlyMap<string, PlotState>,
): Record<string, PersistedFarmPlot> | undefined {
  if (plots.size === 0) return undefined;
  const out: Record<string, PersistedFarmPlot> = {};
  // KEY-SORTED like the packet's other persisted maps (questedHobbies,
  // serializeNodeReadiness), so persisted blob diffs stay readable instead of
  // carrying per-player plant order. Readers are keyed lookups; only the
  // serialized text changes.
  for (const bedId of [...plots.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const p = plots.get(bedId) as PlotState;
    out[bedId] = {
      cropId: p.cropId,
      plantedAtMs: p.plantedAtMs,
      readyAtMs: p.readyAtMs,
      ...(finite(p.survivalRoll) ? { survivalRoll: p.survivalRoll } : {}),
      ...(finite(p.yieldSeed) ? { yieldSeed: p.yieldSeed } : {}),
      ...(p.compost ? { compost: true } : {}),
      ...(p.watch ? { watch: true } : {}),
      ...(p.tonic ? { tonic: true } : {}),
      ...(p.notified ? { notified: true } : {}),
    };
  }
  return out;
}

/** Rebuild saved rows into a fresh live plot map. This is where hand-edited
 *  JSONB enters, so it owns every anti-tamper arm: a bed id or crop id outside
 *  the allowlists drops (a retired bed self-heals out of the save on the next
 *  round trip), non-finite and non-positive timestamps drop, a deadline at or
 *  before its plant time drops (it would read as permanently ready), and a
 *  duration over FARM_MAX_GROW_MS clamps to the ceiling.
 *
 *  A plantedAtMs in the FUTURE relative to the loading host's clock re-anchors
 *  to nowMs and keeps its (already clamped) duration, so growth restarts
 *  rather than idling until a fabricated date. That arm also carries the
 *  offline host, whose clock starts at zero: an epoch-ms save loaded into a
 *  fresh Sim re-anchors instead of reading as long since ready.
 *
 *  Always returns a FRESH map, so an absent field loads to the no-plots
 *  default and no caller can alias the saved object. */
export function normalizeFarmPlots(
  saved: Record<string, PersistedFarmPlot> | undefined,
  opts: { validBedIds: ReadonlySet<string>; validCropIds: ReadonlySet<string>; nowMs: number },
): Map<string, PlotState> {
  const out = new Map<string, PlotState>();
  if (!saved) return out;
  // KEY-SORTED insertion, mirroring the serializer: the live Map's iteration
  // order must be sim-owned, never a saved-JSON key-order artifact. The growth
  // phase iterates this Map per tick, so an unsorted insert would make the rng
  // stream position depend on how the DB round-tripped the blob.
  for (const [bedId, row] of Object.entries(saved).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (!row || !opts.validBedIds.has(bedId) || !opts.validCropIds.has(row.cropId)) continue;
    if (!finite(row.plantedAtMs) || !finite(row.readyAtMs)) continue;
    if (row.plantedAtMs <= 0 || row.readyAtMs <= 0) continue;
    const duration = Math.min(row.readyAtMs - row.plantedAtMs, FARM_MAX_GROW_MS);
    if (duration <= 0) continue;
    // Clamp order is load-bearing: the duration is bounded FIRST, then the
    // anchor moves, so a row that is both over-long and future-dated cannot
    // launder its excess duration past the ceiling.
    //
    // The `nowMs > 0` guard keeps the re-anchor from writing an anchor this
    // same function would drop on the NEXT load: a fresh offline Sim reports
    // lockoutNowMs 0 before it has ticked, and clamping to 0 would make every
    // row survive exactly one round trip. A non-positive (or non-finite)
    // clock skips the re-anchor and the row keeps its saved anchor, which
    // still reads as growing; nothing can have been planted on that host yet.
    const plantedAtMs =
      opts.nowMs > 0 && row.plantedAtMs > opts.nowMs ? opts.nowMs : row.plantedAtMs;
    out.set(bedId, {
      cropId: row.cropId,
      plantedAtMs,
      readyAtMs: plantedAtMs + duration,
      // A corrupt hidden slot drops the SLOT, never the row: the growth phase
      // re-rolls an absent slot at harvest, so dropping the plot instead would
      // destroy a real crop over a field the player cannot see.
      ...(finite(row.survivalRoll) ? { survivalRoll: row.survivalRoll } : {}),
      ...(finite(row.yieldSeed) ? { yieldSeed: row.yieldSeed } : {}),
      compost: row.compost === true,
      watch: row.watch === true,
      tonic: row.tonic === true,
      notified: row.notified === true,
    });
  }
  return out;
}
