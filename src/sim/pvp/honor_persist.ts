// The persisted form of the honor ledger and its daily DR window, moved out of
// the Sim coordinator's serializeCharacter / addPlayer (the monolith ratchet:
// extract, then lower). Both directions keep the absent-when-default rule that
// keeps pre-honor saves byte-identical: a zero purse writes no honor keys, an
// unopened daily window writes nothing, and every optional window field is
// omitted rather than written empty (mirroring normalizeHonorDailyState).

import type { CharacterState } from '../character_state';
import type { PlayerMeta } from '../sim';
import { normalizeHonorCounter, normalizeHonorDailyState } from './honor';

/** The honor keys to spread into a CharacterState (absent when at rest). The
 *  return type is an inline literal on purpose: the character-blob growth
 *  guard (tests/professions_blob_growth.test.ts) reads a save-fragment helper's
 *  keys off its declared return shape. */
export function savedHonorState(meta: PlayerMeta): {
  honor?: number;
  lifetimeHonor?: number;
  honorArenaDaily?: CharacterState['honorArenaDaily'];
} {
  const daily = meta.honorArenaDaily;
  return {
    ...(meta.honor || meta.lifetimeHonor
      ? { honor: meta.honor, lifetimeHonor: meta.lifetimeHonor }
      : {}),
    ...(daily
      ? {
          honorArenaDaily: {
            date: daily.date,
            winsByOpponent: { ...daily.winsByOpponent },
            // Optional ranked-loss DR window, on the same absent-when-empty
            // rule as the battleground one below: a day with no paying loss
            // writes nothing, so pre-loss-award saves stay byte-equal.
            ...(daily.lossesByOpponent && Object.keys(daily.lossesByOpponent).length > 0
              ? { lossesByOpponent: { ...daily.lossesByOpponent } }
              : {}),
            fiestaCompletionsByOpponent: { ...daily.fiestaCompletionsByOpponent },
            // Optional Thornhollow Fields DR window: omitted when empty so
            // pre-Thornhollow Fields saves stay byte-equal.
            ...(daily.bgResultsByOpponent && Object.keys(daily.bgResultsByOpponent).length > 0
              ? { bgResultsByOpponent: { ...daily.bgResultsByOpponent } }
              : {}),
            // Same absent-until-claimed rule as the DR window above: a day that
            // has not paid the first-win bonus writes nothing (back-compat +
            // parity-stable saves).
            ...(daily.bgFirstWinClaimed ? { bgFirstWinClaimed: true } : {}),
            totalWins: daily.totalWins,
          },
        }
      : {}),
  };
}

/** Restore the honor ledger from a saved blob: counters normalized, lifetime
 *  never below the spendable balance (the pre-lifetime backfill), the daily
 *  window normalized or dropped. */
export function loadHonorState(meta: PlayerMeta, s: CharacterState): void {
  meta.honor = normalizeHonorCounter(s.honor);
  meta.lifetimeHonor = Math.max(meta.honor, normalizeHonorCounter(s.lifetimeHonor ?? meta.honor));
  meta.honorArenaDaily = normalizeHonorDailyState(s.honorArenaDaily);
}
