// The Fire and Fly feedback ring: the newest engine events, each numbered with a
// per-seat sequence, so the HUD and the renderer consume new entries by `seq`
// from the session view (never twice) with no event plumbing of their own.
// Entries are deep-frozen when recorded, so a view shares them by reference.

import { deepFreeze } from '../deep_freeze';
import type { TurretEvent } from './turret_defense';

// Sized for the worst single tick of any scenario: the two shells a reload lets land together
// (or their frag bursts), a bomblet of every frag shell a run holds (resupplies included), the
// Shockwave's front and every barrel the keg cap lets stand blowing through the widest wave,
// each blast pushing its own event first, then a launch and a kill per body, a barrel lit by
// each, plus knocks, a hunt's departure cue, and the wave clear with its resupply, the next
// wave's start and its kegs, or the end (the derivation per plan is pinned in
// tests/turret_feedback.test.ts); a smaller ring drops a blast before any reader sees it,
// and with it the blast's damage numbers, sound and visual.
export const TURRET_FEEDBACK_LIMIT = 1437;

export interface TurretFeedback {
  /** 1 for a seat's first event, then +1 per event; restarts with every new seat. */
  readonly seq: number;
  /** The sim tick the event was recorded on. */
  readonly tick: number;
  readonly event: TurretEvent;
}

/** Appends `events` in order and keeps the newest TURRET_FEEDBACK_LIMIT; returns the next seq. */
export function recordTurretFeedback(
  ring: TurretFeedback[],
  nextSeq: number,
  tick: number,
  events: readonly TurretEvent[],
): number {
  let seq = nextSeq;
  for (const event of events) ring.push(deepFreeze({ seq: seq++, tick, event }));
  if (ring.length > TURRET_FEEDBACK_LIMIT) ring.splice(0, ring.length - TURRET_FEEDBACK_LIMIT);
  return seq;
}

const NOTHING_NEW: readonly TurretFeedback[] = Object.freeze([]);

/**
 * The entries newer than `lastSeq`, oldest first. A consumer keeps the seq of the
 * last entry it handled (0 before the first) and resets it when the seat changes;
 * a first returned seq above `lastSeq + 1` means older entries left the ring unseen.
 */
export function turretFeedbackSince(
  ring: readonly TurretFeedback[],
  lastSeq: number,
): readonly TurretFeedback[] {
  let first = ring.length;
  while (first > 0 && ring[first - 1].seq > lastSeq) first--;
  // Nothing new is the common read: it allocates nothing.
  return first === ring.length ? NOTHING_NEW : ring.slice(first);
}
