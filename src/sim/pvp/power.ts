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

// WARFARE Vitality: the same Warfare Defense Rating also raises maximum health,
// so honor gear gives players far more health than players without it (owner
// rule, 2026-09-24). Six rating grants one percent, capped at +80 percent. A
// full Season 1 kit (182 from the pieces, +120 from the seven-piece set) lands
// at about +50 percent; only the Warfare Season 2 pieces carry the Defense
// rating to reach past that, up to the cap, so Season 2 is the PvP health tier
// (content/pvp_honor_season2.ts, owner rule 2026-09-25). Unlike Offense and Defense it is not scoped to hostile
// hits: it applies everywhere EXCEPT PvE instances (dungeons, raids, delves,
// rift floors), which is where raid-tier gear must stay the stronger choice.
// The context decision lives in pvp/vitality.ts; entity.ts applies the fraction
// to maxHp while `Entity.pvpVitalityActive` is not false.
export const PVP_VITALITY_RATING_PER_PCT = 6;
export const PVP_VITALITY_CAP = 0.8;

export function pvpVitalityFromRating(defenseRating: number): number {
  return Math.min(
    PVP_VITALITY_CAP,
    Math.max(0, defenseRating) / (PVP_VITALITY_RATING_PER_PCT * 100),
  );
}

export function pvpDamageMultiplier(source: Entity, target: Entity): number {
  const offense = Math.min(PVP_OFFENSE_CAP, Math.max(0, source.stats.pvpOffense));
  const defense = Math.min(PVP_DEFENSE_CAP, Math.max(0, target.stats.pvpDefense));
  return (1 + offense) * (1 - defense);
}
