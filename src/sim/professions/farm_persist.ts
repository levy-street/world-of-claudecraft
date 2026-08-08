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

// The hidden-slot domains, stated once so the write side, the load-side clamp
// and the derivation below cannot disagree about them. survivalRoll is a
// uniform [0, 1) exactly like ctx.rng.next() produces; yieldSeed is a uint32.
const SURVIVAL_ROLL_MAX = 1 - Number.EPSILON;
const YIELD_SEED_MODULUS = 0x100000000;

/** FNV-1a over a short ASCII key, as a uint32. Not a hash for security and
 *  not a source of randomness: it is a deterministic EXPANSION used to replace
 *  a hidden slot a save lost, so that loss can never become a reroll
 *  primitive (see deriveHiddenSlots). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The replacement hidden slots for a row that lost one, derived from the
 *  plot's own identity (bed id plus its final plant time).
 *
 *  DERIVED, NEVER RE-ROLLED. A fresh ctx.rng draw here would break the
 *  determinism contract outright: it would put a draw on the LOAD path, where
 *  the contract says zero, and every reload of the same save would answer
 *  differently.
 *
 *  BE PRECISE ABOUT WHAT THIS DEFENDS, because the obvious stronger claim is
 *  false. What derivation buys is that ACCIDENTAL slot loss (a JSON null, a
 *  truncated write, a legacy row) resolves deterministically and cannot be
 *  farmed by REPLAY: reloading the same bytes forever returns the same
 *  outcome. It does NOT make a plot tamper-proof against a writer with direct
 *  blob access, and it was wrong to imply it did. The key includes
 *  plantedAtMs, so someone who can blank a slot can also nudge the anchor by a
 *  millisecond and draw again, as often as they like. That is not a hole this
 *  function can close: an attacker editing the JSONB has already fully
 *  compromised the character, and what actually bounds them is the surrounding
 *  anti-tamper set (the bed and crop allowlists, the duration ceiling, the
 *  domain clamps below), not the derivation.
 *
 *  Keyed off the FINAL plantedAtMs (post re-anchor), which is the anchor
 *  actually stored, so a save/load round trip of a derived row is a fixed
 *  point. The two slots use different key suffixes so they cannot correlate. */
export function deriveHiddenSlots(
  bedId: string,
  plantedAtMs: number,
): { survivalRoll: number; yieldSeed: number } {
  return {
    survivalRoll: fnv1a(`${bedId}:${plantedAtMs}:survival`) / YIELD_SEED_MODULUS,
    yieldSeed: fnv1a(`${bedId}:${plantedAtMs}:yield`),
  };
}

/** Clamp a saved survivalRoll into [0, 1), the domain ctx.rng.next() draws
 *  from. A hand-edited -5 or 2 would otherwise make a crop deterministically
 *  survive or fail regardless of skill. */
function clampSurvivalRoll(v: number): number {
  return Math.min(SURVIVAL_ROLL_MAX, Math.max(0, v));
}

/** Floor a saved yieldSeed to an integer and clamp it into [0, 2^32). The
 *  harvest expands it through a uint32 generator, so a fractional or
 *  out-of-range value would silently alias onto another seed's stream. */
function clampYieldSeed(v: number): number {
  return Math.min(YIELD_SEED_MODULUS - 1, Math.max(0, Math.floor(v)));
}

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
  // serializeNodeReadiness). Postgres JSONB does not preserve object key
  // order, so this buys nothing for the DB text; what it does buy is
  // deterministic serialized BYTES for the blob-bound suites and JS-level
  // round-trip diffs, instead of carrying per-player plant order. Readers
  // are keyed lookups; only the serialized text changes.
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
/** Count hidden slots (survivalRoll / yieldSeed) that normalizeFarmPlots could
 *  not take at face value on a SURVIVING row, so the row loads clean while the
 *  outcome it carried is no longer the one originally rolled. Two families,
 *  both of which the row counter is blind to:
 *
 *  1. UNUSABLE: present but non-finite (a JSON null, a string, NaN). Replaced
 *     by deriveHiddenSlots.
 *  2. OUT OF DOMAIN: present, finite, and outside the range the live draw can
 *     produce (a survivalRoll of 5 or -1, a fractional or 2^40 yieldSeed).
 *     Silently corrected by the clamps. This family is the one the clamps
 *     EXIST to defeat, which makes it the likeliest deliberate tamper of the
 *     two, so leaving it out of the operator signal would have hidden exactly
 *     the case worth seeing.
 *
 *  Operator signal only, consumed by the load-site console.warn.
 *
 *  An ABSENT slot is deliberately NOT counted, and that asymmetry is the
 *  point: it derives exactly like a corrupt one, but absence is also the shape
 *  of every row written before the growth phase existed, so counting it would
 *  turn an ordinary legacy load into a tamper warning on every boot. */
export function countDroppedHiddenSlots(
  saved: Record<string, PersistedFarmPlot> | undefined,
  loaded: ReadonlyMap<string, PlotState>,
): number {
  if (!saved || typeof saved !== 'object') return 0;
  let dropped = 0;
  for (const [bedId, row] of Object.entries(saved)) {
    if (!row || typeof row !== 'object' || !loaded.has(bedId)) continue;
    if (slotWasReplaced(row.survivalRoll, clampSurvivalRoll)) dropped++;
    if (slotWasReplaced(row.yieldSeed, clampYieldSeed)) dropped++;
  }
  return dropped;
}

/** True when a saved slot did not survive the load AS WRITTEN: absent slots
 *  are excluded (see the doctrine above), non-finite ones were derived, and a
 *  finite one counts exactly when the clamp CHANGED it. Asking the clamp
 *  itself, rather than restating its bounds, is what keeps this counter honest
 *  if a domain ever moves. */
function slotWasReplaced(v: number | undefined, clamp: (n: number) => number): boolean {
  if (v === undefined) return false;
  if (!finite(v)) return true;
  return clamp(v) !== v;
}

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
    // ONE anchor rule for every host with a REAL clock, resolved deliberately
    // by the growth phase. The re-anchor floors at 1 rather than skipping on a
    // non-positive clock, which is what the `nowMs > 0` guard used to do. That
    // guard existed to stop the re-anchor writing an anchor this same function
    // would drop on the NEXT load (a fresh offline Sim reports lockoutNowMs 0
    // before it has ticked, and a plantedAtMs of 0 fails the positivity arm
    // above), but it bought that at the price of two DISAGREEING load paths: a
    // fresh-Sim load kept a future-dated anchor while a post-tick load of the
    // same bytes re-anchored it. Flooring at 1 keeps the round-trip property
    // the guard was protecting (1 is positive, so the row survives every
    // subsequent load, and an already-re-anchored row is not > 1 and so stays
    // put) while giving both paths the same semantics: a future plant time
    // always re-anchors and keeps its already-clamped duration.
    //
    // A NON-FINITE CLOCK SKIPS THE RE-ANCHOR ENTIRELY, and that arm is not
    // symmetry for its own sake. Folding NaN into the floor would re-anchor
    // EVERY row to 1 and persist it, which on any host reading a real epoch
    // clock puts readyAtMs back in 1970 and makes every crop in the world
    // instantly ready: a silent, saved, total loss of growth state. Preserving
    // the saved anchors is the strictly safer answer when the clock cannot be
    // trusted, and it is what the old guard did by accident in exactly these
    // cases. Defensive only, and unreachable today: all four server injections
    // pass Date.now, and the offline default counts from zero.
    const anchorNow = finite(opts.nowMs) ? Math.max(opts.nowMs, 1) : null;
    const plantedAtMs =
      anchorNow !== null && row.plantedAtMs > anchorNow ? anchorNow : row.plantedAtMs;
    // Hidden slots are HARD-GATED here, the one place hand-edited JSONB
    // enters. A present slot clamps into its domain; an absent or unusable one
    // DERIVES a deterministic replacement from the row's own identity
    // (deriveHiddenSlots above), never a fresh roll, so a blanked slot is not
    // a reroll primitive. The row is never dropped for a bad slot: that would
    // destroy a real crop over a field the player cannot see.
    //
    // Derived LAZILY: the overwhelming case is a row whose two slots are both
    // finite, where the derivation would be two FNV walks plus an allocation
    // per plot, computed and thrown away. Every load of every character with
    // plots pays that, so the one-shot memo keeps the common path free while
    // the two arms below still share ONE derivation when either needs it.
    let derived: { survivalRoll: number; yieldSeed: number } | null = null;
    const derive = () => {
      derived ??= deriveHiddenSlots(bedId, plantedAtMs);
      return derived;
    };
    out.set(bedId, {
      cropId: row.cropId,
      plantedAtMs,
      readyAtMs: plantedAtMs + duration,
      survivalRoll: finite(row.survivalRoll)
        ? clampSurvivalRoll(row.survivalRoll)
        : derive().survivalRoll,
      yieldSeed: finite(row.yieldSeed) ? clampYieldSeed(row.yieldSeed) : derive().yieldSeed,
      compost: row.compost === true,
      watch: row.watch === true,
      tonic: row.tonic === true,
      notified: row.notified === true,
    });
  }
  return out;
}
