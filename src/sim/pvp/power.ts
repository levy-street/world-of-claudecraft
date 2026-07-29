// WARFARE rating conversion and hostile player-vs-player damage scaling.
// Pure and host-agnostic: no state, rng, or clock reads.

import type { Entity } from '../types';

export const PVP_RATING_PER_PCT = 10;
// A complete 11-slot WARFARE kit carries 182 of each rating and its seven-piece
// set adds 120, so the two caps below are where a fully geared character lands
// (302 rating clamps to 0.30). The maximum gear swing against an ungeared
// opponent is therefore 1.3 / 0.7 = 1.86x, in duels and ranked arena as well as
// battlegrounds, since isHostileTo is true in all three. Accepted deliberately:
// see docs/design/warfare.md. PvpCaps below already takes the two independently,
// so splitting them later (say 0.25 offense against 0.30 defense) is a constant
// edit with no structural change.
export const PVP_OFFENSE_CAP = 0.3;
export const PVP_DEFENSE_CAP = 0.3;

export interface PvpCaps {
  offense: number;
  defense: number;
}

const DEFAULT_PVP_CAPS: PvpCaps = {
  offense: PVP_OFFENSE_CAP,
  defense: PVP_DEFENSE_CAP,
};

function pvpFractionFromRating(rating: number, cap: number): number {
  return Math.min(cap, Math.max(0, rating) / (PVP_RATING_PER_PCT * 100));
}

export function pvpFractionsFromRatings(
  offenseRating: number,
  defenseRating: number,
  caps: PvpCaps = DEFAULT_PVP_CAPS,
): { offense: number; defense: number } {
  return {
    offense: pvpFractionFromRating(offenseRating, caps.offense),
    defense: pvpFractionFromRating(defenseRating, caps.defense),
  };
}

export function pvpDamageMultiplier(source: Entity, target: Entity): number {
  const offense = Math.min(PVP_OFFENSE_CAP, Math.max(0, source.stats.pvpOffense));
  const defense = Math.min(PVP_DEFENSE_CAP, Math.max(0, target.stats.pvpDefense));
  return (1 + offense) * (1 - defense);
}
