// Display-only reanchor decision for a remote entity's interpolation state
// when a new server snapshot lands (ClientWorld.applyWire, src/net/online.ts).
// Pure: no clock reads, no ClientWorld state, online.ts is the sole caller.
// See "Snapshot decode" in src/net/CLAUDE.md for the wire/interpolation
// contract this composes with; net_interp_core.ts (src/render/) owns the
// PER-FRAME blend alpha that consumes the netInterval this module learns.
//
// The snap threshold below exists because the flat distance it replaces was
// tuned assuming REGULAR update spacing. Under ping jitter that assumption
// breaks down: a gap grows well past what a single "normal" update would
// cover, and a threshold sized for the normal case reads it as anomalous
// when it is not.
//
// The interval-learning band is otherwise UNCHANGED from before this module
// existed: a wider "maybe this gap is jitter, not idleness" arm was tried
// and reverted (tests/interest.test.ts "keeps the cadence estimate clean
// across idle pauses" caught it) because a single entity's own update
// history cannot tell a network-jitter stall apart from the entity simply
// going idle - an entity that WAS moving regularly can legitimately stop
// changing state, and the server sends no record either way. Distinguishing
// the two needs a connection-level signal (the whole snapshot was late, not
// just this one entity's record), which is a bigger change than this fix.

// yd/s. Charge (RUN_SPEED * CHARGE_SPEED_MULT = 7 * 3 = 21 yd/s in
// src/sim/sim.ts) is not actually the worst case: moveSpeedMult
// (src/sim/player_motion.ts) adds a mount bonus to the strongest speed buff,
// so a +80% mount under a 2.5x buff_speed (src/sim/content/
// paladin_core_abilities.ts) computes to 7 * (2.5 + 0.8) = 23.1 yd/s, the real
// margin below this threshold is 0.9 yd/s, not the 3 yd/s a Charge-only
// comparison implies. Still under 24, so only an actual server-side teleport
// (portal, graveyard release) can exceed the plausibility window below, but a
// future speed buff should check its worst case against 23.1, not 21.
export const MAX_PLAUSIBLE_ENTITY_SPEED = 24;

// Caps how far the plausibility window grows for a very long gap, so a
// multi-second stall does not waive the snap threshold to an unbounded
// distance.
export const SNAP_GAP_CAP_MS = 2000;

// Small margin so a borderline case at short gaps cannot regress vs the flat
// threshold this replaces.
export const SNAP_SLOP_YD = 2;

// The original flat threshold (40yd). Kept as a floor via Math.max in
// reanchorDecision, so short-gap behavior is unchanged and the widened
// window can only ever get MORE lenient, never less, than before this file
// existed.
export const BASE_SNAP_DIST_SQ = 40 * 40;

export interface ReanchorDecisionInput {
  /** now - prevUpdatedAt; undefined when the entity had no prior update. */
  gapMs: number | undefined;
  /** squared 2D distance between the last rendered position and the new one. */
  deltaSq: number;
  prevInterval: number | undefined;
  /** wasDead && !nowDead: a release/revive edge always snaps regardless of distance. */
  reviveEdge: boolean;
}

export interface ReanchorDecision {
  /** true: hard-snap both poses to the new position. false: glide (existing bounded blend). */
  snap: boolean;
  /** The netInterval to adopt, or undefined to leave it unchanged. */
  netInterval: number | undefined;
}

export function reanchorDecision({
  gapMs,
  deltaSq,
  prevInterval,
  reviveEdge,
}: ReanchorDecisionInput): ReanchorDecision {
  const gap = gapMs ?? 0;

  // A distance only a real teleport could explain still snaps; a distance a
  // plausible top speed could cover over the elapsed gap glides instead,
  // however far past the old flat 40yd threshold it lands.
  const plausibleDist =
    MAX_PLAUSIBLE_ENTITY_SPEED * (Math.min(gap, SNAP_GAP_CAP_MS) / 1000) + SNAP_SLOP_YD;
  const snapThresholdSq = Math.max(BASE_SNAP_DIST_SQ, plausibleDist * plausibleDist);
  const snap = reviveEdge || deltaSq > snapThresholdSq;

  let netInterval: number | undefined;
  if (gap > 5 && gap < 450) {
    netInterval = prevInterval === undefined ? gap : prevInterval * 0.7 + gap * 0.3;
  }

  return { snap, netInterval };
}
