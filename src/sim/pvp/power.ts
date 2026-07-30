// WARFARE rating conversion and hostile player-vs-player damage scaling.
// Pure and host-agnostic: no state, rng, or clock reads.

import type { Entity } from '../types';

export const PVP_RATING_PER_PCT = 10;
export const PVP_OFFENSE_CAP = 0.2;
export const PVP_DEFENSE_CAP = 0.2;

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
