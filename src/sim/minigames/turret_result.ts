// Fire and Fly's end of a run: a medal from the share of the tower's points still
// standing (bronze for any win, silver and gold at the scenario's bars, none for a
// loss), and the points that rank runs holding the same medal. Mini-game tuning, not
// classic-era formulas; a change after boards open mints a new board version.

import type { TurretPhase, TurretStats } from './turret_defense';
import type { TurretPlan } from './turret_defense_plan';

export type TurretMedal = 'gold' | 'silver' | 'bronze';

/** Each term's points; together they are the result's points. */
export interface TurretPointsBreakdown {
  kills: number;
  integrity: number;
  kegKills: number;
  bowled: number;
}

export interface TurretResult {
  won: boolean;
  medal: TurretMedal | null;
  points: number;
  breakdown: TurretPointsBreakdown;
}

/**
 * Points per kill, per tower point still standing, per keg kill and per monster
 * bowled over. Every kill counts the same: a won run killed every monster that did
 * not strike the tower, so the kill term only tells runs apart by their strikes, and
 * the tower term already weighs each strike by the striker's size and health.
 */
export const TURRET_POINTS = { kill: 20, integrity: 200, kegKill: 5, bowled: 1 } as const;

/**
 * The keg and bowling bonus together stay under one tower point: the fun parts rank
 * runs that defended equally well, and never lift one above a cleaner defense.
 */
export const TURRET_BONUS_CAP = TURRET_POINTS.integrity - 1;

/** The fewest tower points a medal bar asks for: its share of `integrity`, rounded up. */
export function turretMedalBarPoints(share: number, integrity: number): number {
  return Math.ceil(share * integrity - 1e-9);
}

export interface TurretFinal {
  phase: TurretPhase;
  integrity: number;
  stats: Pick<TurretStats, 'kills' | 'barrelKills' | 'bowled'>;
}

/** The medal and the points of a run as it stands; only a won run holds a medal. */
export function turretResult(
  plan: Pick<TurretPlan, 'integrity' | 'medals'>,
  final: TurretFinal,
): TurretResult {
  const kept = Math.max(0, Math.min(plan.integrity, final.integrity));
  const won = final.phase === 'won';
  const medal = !won
    ? null
    : kept >= turretMedalBarPoints(plan.medals.gold.minIntegrityShare, plan.integrity)
      ? 'gold'
      : kept >= turretMedalBarPoints(plan.medals.silver.minIntegrityShare, plan.integrity)
        ? 'silver'
        : 'bronze';
  const kegKills = Math.min(TURRET_BONUS_CAP, final.stats.barrelKills * TURRET_POINTS.kegKill);
  const breakdown: TurretPointsBreakdown = {
    kills: final.stats.kills * TURRET_POINTS.kill,
    integrity: kept * TURRET_POINTS.integrity,
    kegKills,
    bowled: Math.min(TURRET_BONUS_CAP - kegKills, final.stats.bowled * TURRET_POINTS.bowled),
  };
  const points = breakdown.kills + breakdown.integrity + breakdown.kegKills + breakdown.bowled;
  return { won, medal, points, breakdown };
}
