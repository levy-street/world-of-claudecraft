// Ticks-based per-key cooldown windows (Professions 2.0): the shared
// timing primitive behind repeatable work-order quests (persisted per character)
// and the in-memory trend-nudge cadence. A pure leaf: no SimContext, no rng, no
// wall clock, no mutation beyond the passed map. Every window is expressed in
// TICKS on the sim's fixed 20 Hz clock (DT = 1/20); cadence.ts never reads a
// real clock, so the same seed yields the same windows on every host.
//
// This module is `src/sim`-pure (see src/sim/CLAUDE.md): no DOM/render/ui/game/net
// imports, host-agnostic so it runs offline, on the server, and in the headless
// RL env unchanged.

// A repeatable work order becomes available again 30 minutes after turn-in
// (36000 ticks at 20 Hz): a deliberate day-to-day cadence, not a balance number.
export const WORK_ORDER_CADENCE_TICKS = 36000;

// The work-order payout convention: each order's authored copperReward is
// floor(this fraction * the summed vendor sellValue of the requested
// materials). The rewards themselves stay authored literals on the quest
// records; this constant is the single statement of the convention, consumed
// by the wiki generator (scripts/wiki/build_content.mjs) and enforced by the
// recomputation guard in tests/professions_work_orders.test.ts, so a reward
// or sellValue edit that breaks the convention fails loudly instead of
// silently drifting the published number.
export const WORK_ORDER_PAYOUT_FRACTION = 0.5;

// A trend nudge repeats at most once every 15 minutes (18000 ticks at 20 Hz),
// long enough that a wandering unattuned crafter is reminded without nagging.
export const NUDGE_CADENCE_TICKS = 18000;

// Per-key availability map: key -> the tick AT OR AFTER which the key is
// available again. A key absent from the map is available now. Stored as a Map
// (not a plain object) on purpose: an empty Map canonicalizes to an inert `[]`
// in the parity sampler (tests/parity/trace.ts), so a character who has never
// armed a window pins byte-identically and no golden churns.
export type CadenceMap = Map<string, number>;

/** Whether `key` is still inside its cooldown window at tick `now` (a stored
 *  availableAt strictly greater than now). */
export function isCadenceBlocked(map: CadenceMap, key: string, now: number): boolean {
  const availableAt = map.get(key);
  return typeof availableAt === 'number' && now < availableAt;
}

/** Arm (or re-arm) `key`'s window: available again at now + windowTicks. A
 *  non-positive window arms an already-elapsed window (available immediately). */
export function armCadence(map: CadenceMap, key: string, now: number, windowTicks: number): void {
  map.set(key, now + Math.max(0, Math.floor(windowTicks)));
}

/** The sorted set of keys currently inside their window at `now`. Sorted so the
 *  wire signature (the cprof mirror's cadenceBlockedQuests) is stable and the
 *  cprof delta re-emits only when the blocked set actually changes. */
export function cadenceBlockedKeys(map: CadenceMap, now: number): string[] {
  const out: string[] = [];
  for (const [key, availableAt] of map) {
    if (now < availableAt) out.push(key);
  }
  return out.sort();
}

/** Whether a stored availableAt has already lapsed at tick `now` (the key is
 *  available again, so it carries no state worth keeping). The ONE elapsed
 *  predicate shared by the load-time drop (clampCadenceOnLoad) and the
 *  serialize-time prune (serializeCadence); both
 *  arms sit on it so a serialize-load-serialize round trip is a fixed point. */
export function isCadenceElapsed(availableAt: number, now: number): boolean {
  return availableAt <= now;
}

/** Load-time clamp: rebuild a persisted cooldown record into a live map, capping
 *  every stored availableAt at now + windowTicks so a tick-counter reset (a fresh
 *  offline Sim starts at tick 0, a server restart rewinds the counter) can never
 *  leave a key bricked far in the future. A value at or below the cap is kept as
 *  is; a key already at or past `now` is dropped, so the record shrinks back to
 *  empty (and re-omits from the save) once every window has lapsed. */
export function clampCadenceOnLoad(
  saved: Record<string, number> | undefined | null,
  now: number,
  windowTicks: number,
): CadenceMap {
  const map: CadenceMap = new Map();
  if (!saved) return map;
  const cap = now + Math.max(0, Math.floor(windowTicks));
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const clamped = Math.min(value, cap);
    if (!isCadenceElapsed(clamped, now)) map.set(key, clamped);
  }
  return map;
}

/** Serialize-time counterpart of clampCadenceOnLoad:
 *  the still-live entries of a cadence map as a plain persistable record, or
 *  null when nothing live remains so the save field omits (zero-default
 *  omission). Load-only pruning let a long-running session autosave past-due
 *  keys forever; pruning here with the same elapsed predicate closes that.
 *  Live entries pass through byte-identical, and the live map is NEVER
 *  mutated: the cprof cadenceBlockedQuests wire mirror keeps reading it
 *  directly via cadenceBlockedKeys. */
export function serializeCadence(map: CadenceMap, now: number): Record<string, number> | null {
  let record: Record<string, number> | null = null;
  for (const [key, availableAt] of map) {
    if (isCadenceElapsed(availableAt, now)) continue;
    if (record === null) record = {};
    record[key] = availableAt;
  }
  return record;
}
