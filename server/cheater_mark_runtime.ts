// The Cheater mark's server runtime: the live apply, the join restore, and the
// per-save write-back, extracted from server/game.ts (the monolith ratchet) into
// a sibling module behind narrow structural views. The coordinator stays a thin
// caller; a Vitest drives these directly with fake sessions and a fake sim.
//
// The mark is POWER-NEUTRAL by construction (src/sim/moderation/CLAUDE.md):
// nothing in this module may grow a gameplay effect.

import { CHEATER_MARK_AURA_ID } from '../src/sim/moderation';
import { accountCheaterMarkSeconds, burnAccountCheaterMark } from './moderation_db';

/** The slice of ClientSession this runtime reads and latches. */
export interface CheaterMarkSession {
  accountId: number;
  pid: number;
  // Latch: this session has worn a Cheater mark at some point. It gates the
  // per-save write-back, so an unmarked account (nearly all of them) never pays
  // a write, and it stays TRUE through the save that finally zeroes the row so
  // the last write is not skipped by the aura already having expired.
  cheaterMarked: boolean;
}

/** The one sim entry point a mark change goes through (server-side only). */
export interface CheaterMarkSim {
  setCheaterMark(seconds: number, pid: number): void;
}

/**
 * Push a Cheater mark change onto every live session of that account, so a
 * sanction lands in the session it was applied in rather than at the next
 * login. `seconds` is the remaining PLAYED-second budget; 0 lifts the tag.
 *
 * A no-op when the account is offline: the join restore below reads the row.
 */
export function applyCheaterMarkLive(
  clients: Iterable<CheaterMarkSession>,
  sim: CheaterMarkSim,
  accountId: number,
  seconds: number,
): void {
  for (const live of clients) {
    if (live.accountId !== accountId) continue;
    // Latched even on a LIFT (seconds = 0): the next save is the one that has
    // to zero the account row, and skipping it would leave the budget behind
    // for the next login to restore.
    live.cheaterMarked = true;
    sim.setCheaterMark(seconds, live.pid);
  }
}

/**
 * Restore the account's Cheater mark onto the joining character: the tag is
 * account-scoped, so every alt wears whatever budget the account still owes.
 * Rides its own read rather than the flair one because flair is cosmetic
 * self-expression and this is a sanction: they are written by different
 * operators for different reasons and neither should be able to break the
 * other's restore by failing. `isCurrent` guards the player leaving mid-fetch.
 */
export async function refreshCheaterMark(
  session: CheaterMarkSession,
  sim: CheaterMarkSim,
  isCurrent: () => boolean,
): Promise<void> {
  const seconds = await accountCheaterMarkSeconds(session.accountId);
  if (seconds <= 0) return;
  if (!isCurrent()) return;
  session.cheaterMarked = true;
  sim.setCheaterMark(seconds, session.pid);
}

/**
 * Write the live Cheater budget back to the account, from the session save.
 *
 * Skips entirely when the session was never marked, so an unmarked account (the
 * overwhelming majority) costs zero writes: `session.cheaterMarked` latches on
 * at apply/restore and is what makes the LAST write, the one that zeroes the
 * row, still happen after the aura has gone. The live aura is the ONLY sim
 * source of truth, because the aura is what ticks
 * (src/sim/moderation/CLAUDE.md): its absence means the sanction is served, and
 * burn(0) is what clears the account row.
 *
 * `auras` therefore carries THREE distinct meanings, and the two absent-looking
 * ones must never be collapsed:
 *  - `undefined`: there was no entity to read at save time, so nothing is known.
 *    NOT a served sanction. The write is skipped and the latch kept, and the
 *    next save that does see the entity performs it.
 *  - an existing list WITHOUT the aura: the sanction is served, burn(0).
 *  - an existing list WITH the aura: burn the floored remainder.
 */
export async function persistCheaterMark(
  session: CheaterMarkSession,
  auras: readonly { id: string; remaining: number }[] | undefined,
): Promise<void> {
  if (!session.cheaterMarked) return;
  // Absence of a list is absence of EVIDENCE, never evidence the mark expired:
  // the call site reads `entities.get(pid)?.auras`, so any save that runs once
  // the character has left the sim (a fire-and-forget save queued behind the
  // awaited leave save, a sweep whose session list was captured before the
  // session was dropped) hands us undefined. Zeroing on that would wipe a
  // budget the player still owes, off a read that never happened.
  if (auras === undefined) return;
  const live = auras.find((a) => a.id === CHEATER_MARK_AURA_ID);
  const remaining = Math.max(0, Math.floor(live?.remaining ?? 0));
  try {
    await burnAccountCheaterMark(session.accountId, remaining);
    // Released only AFTER the zeroing write is CONFIRMED. Clearing it before
    // the await meant a transient db failure on that final write silently
    // disabled the write-back for every later save, and the next login restored
    // a budget the player had already served. Retrying once per save is exactly
    // the cost the latch is designed to absorb.
    if (remaining <= 0) session.cheaterMarked = false;
  } catch (err) {
    console.error('cheater mark write-back failed:', err);
  }
}
