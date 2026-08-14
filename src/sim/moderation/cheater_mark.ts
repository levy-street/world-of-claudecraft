// The Cheater mark: an ACCOUNT-scoped, operator-applied public tag that every
// character on the account wears until a budget of PLAYED seconds is burned
// down. Pure leaf module: no SimContext, no rng, no wall clock. The caller
// supplies elapsed seconds, so the same math runs in the browser Sim, on the
// authoritative server, and in the headless env.
//
// Why played time and not wall clock: a wall-clock sanction expires while the
// account is logged out, which is exactly the window a sanctioned player waits
// out. Burning the budget only while in world means the tag is worn in front of
// other players for the full duration, which is the entire point of it.
//
// Why the tag is NOT a deed: `WireEntity.title` carries a DEED ID that the
// client resolves through DEEDS, and the Book of Deeds is a cosmetic reward
// catalogue. A punishment has no place in it, and routing the tag through the
// deed path would also make it removable through the ordinary title picker
// (setActiveTitle accepts null from the player). The mark rides its own wire
// field instead, so no player-driven command can reach it.
//
// The mark is deliberately POWER-NEUTRAL. Its aura carries value 0 and a
// dedicated inert kind, so it changes no stat, no cooldown, and no combat
// outcome: the sanction is visibility, never a handicap. Nothing in this module
// may grow a mechanical effect.

import type { Aura } from '../types';

/**
 * Aura id for the countdown debuff. Stable because every host keys off it by
 * literal: the survive-a-wipe allowlists (../resurrection.ts), the natural-expiry
 * hook that drops the wire flag (../combat/auras.ts), and the operator apply/lift
 * path. The aura itself is NOT persisted (general auras never are); what the
 * server writes back on save is the remaining played-second budget.
 */
export const CHEATER_MARK_AURA_ID = 'cheater_mark';

/**
 * Ceiling on a single mark, in played seconds (100 played hours). Far above any
 * sanction an operator should hand out; it exists so a fat-fingered form value
 * or a hand-edited row cannot park a number that formats into an absurd timer
 * or overflows a later sum.
 */
export const CHEATER_MARK_MAX_SECONDS = 100 * 60 * 60;

/** Account-scoped mark state. Absent (never a zeroed record) when unmarked. */
export interface CheaterMark {
  /** Played seconds still owed before the tag lifts. Always > 0 when present. */
  secondsRemaining: number;
}

/**
 * Coerce an untrusted seconds value onto [0, CHEATER_MARK_MAX_SECONDS].
 * Non-finite, negative, and non-numeric inputs all collapse to 0, which callers
 * read as "no mark" rather than as an error.
 */
export function normalizeCheaterMarkSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(CHEATER_MARK_MAX_SECONDS, Math.max(0, Math.floor(value)));
}

/**
 * Build a mark from an untrusted stored/wire value, or `undefined` when the
 * budget is spent. Absent-when-empty on purpose: an unmarked account's save and
 * wire stay byte-identical to what they were before this system existed.
 */
export function normalizeCheaterMark(value: unknown): CheaterMark | undefined {
  const seconds = normalizeCheaterMarkSeconds(value);
  return seconds > 0 ? { secondsRemaining: seconds } : undefined;
}

/** Is the account currently wearing the tag? */
export function isCheaterMarkActive(mark: CheaterMark | undefined): boolean {
  return mark !== undefined && mark.secondsRemaining > 0;
}

/**
 * The mark after `playedSeconds` more seconds in world, or `undefined` once the
 * budget is spent. Returns a NEW record rather than mutating the input, so a
 * caller can compare before/after to detect the expiry edge.
 *
 * A negative or non-finite elapsed value burns nothing: a caller whose clock has
 * not advanced (or has gone backwards across a host restart) must never be able
 * to lengthen or shorten a sanction by accident.
 */
export function cheaterMarkAfterPlayed(
  mark: CheaterMark | undefined,
  playedSeconds: number,
): CheaterMark | undefined {
  if (!isCheaterMarkActive(mark)) return undefined;
  const burned = Number.isFinite(playedSeconds) ? Math.max(0, playedSeconds) : 0;
  const remaining = Math.max(0, (mark as CheaterMark).secondsRemaining - burned);
  return remaining > 0 ? { secondsRemaining: Math.floor(remaining) } : undefined;
}

/**
 * The countdown debuff for a live mark.
 *
 * `remaining` is the played-seconds budget because, while a character is in
 * world, one second of sim time IS one second of played time: the ordinary aura
 * tick is already the correct countdown, so the debuff needs no separate timer
 * to stay honest. Whatever is left when the session ends is what the server
 * persists back onto the account.
 *
 * TWO independent guards keep it on the wearer, because one flag is a single
 * edit away from being dropped:
 *  - `undispellable`, for the same reason the recovery sicknesses carry it (see
 *    applySickness in ../spirit.ts): a penalty a dispel, a cleanse, or a
 *    right-click could shed is not a penalty.
 *  - the PHYSICAL school, which isDispellableAura (../aura_classify.ts) refuses
 *    outright, whatever the flag says. This is what the repo's other inert
 *    markers ride ('flag_carried', 'internal_cd'), and it is the reason the
 *    mark is not on 'shadow': a shadow-school debuff protected by one boolean
 *    is one careless edit away from being a warlock's Voidfeast snack.
 * Only its own timer, an operator lift, or the served sanction clears it.
 */
export function cheaterMarkAura(mark: CheaterMark, entityId: number): Aura {
  const seconds = normalizeCheaterMarkSeconds(mark.secondsRemaining);
  return {
    id: CHEATER_MARK_AURA_ID,
    name: 'Marked as a Cheater',
    kind: 'cheater_mark',
    remaining: seconds,
    duration: seconds,
    // Power-neutral by construction: the kind is inert and the value is zero.
    value: 0,
    sourceId: entityId,
    school: 'physical',
    undispellable: true,
  };
}
