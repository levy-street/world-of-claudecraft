// Fire and Fly's ladders: a daily and a lifetime board per trial, a lifetime board
// per mission, each ranked by medal then points, and one Gunner's Mastery board over
// the missions; no quest-wide board. Board ids carry the scenario's score version
// (content/fire_and_fly_scenarios.ts), so a retuned scenario starts fresh ladders.

import { TURRET_MISSIONS } from './content/fire_and_fly_missions';
import {
  FIRE_AND_FLY_MASTERY_VERSION,
  FIRE_AND_FLY_SCORE_VERSIONS,
  TURRET_SCENARIOS,
} from './content/fire_and_fly_scenarios';
import type { TurretScenarioDef } from './types';

export type FireAndFlyScorePeriod = 'daily' | 'lifetime';

export const FIRE_AND_FLY_SCORE_PERIODS: readonly FireAndFlyScorePeriod[] = ['daily', 'lifetime'];

/** The noticeboard beside Master Gunner Alder that opens these ladders. */
export const FIRE_AND_FLY_RANKINGS_BOARD_ID = 'gunners_trials_rankings';

/** A trial is the recruitment (daily and lifetime ladders); a mission ranks for all time only. */
export type FireAndFlyScenarioKind = 'trial' | 'mission';

export interface FireAndFlyScoreboardScenario {
  scenarioId: string;
  key: string;
  version: number;
  kind: FireAndFlyScenarioKind;
}

export interface FireAndFlyScoreboardInfo extends FireAndFlyScoreboardScenario {
  period: FireAndFlyScorePeriod;
}

function laddered(
  scenarios: readonly TurretScenarioDef[],
  kind: FireAndFlyScenarioKind,
): FireAndFlyScoreboardScenario[] {
  return scenarios.flatMap((scenario) => {
    const version = FIRE_AND_FLY_SCORE_VERSIONS[scenario.boardKey];
    return Number.isSafeInteger(version) && version > 0
      ? [{ scenarioId: scenario.id, key: scenario.boardKey, version, kind }]
      : [];
  });
}

/** The trials with a ladder, in the order the instructor offers them. */
export const FIRE_AND_FLY_SCOREBOARD_TRIALS: readonly FireAndFlyScoreboardScenario[] = laddered(
  TURRET_SCENARIOS,
  'trial',
);

/** The missions with a ladder, in the order the instructor offers them. */
export const FIRE_AND_FLY_SCOREBOARD_MISSIONS: readonly FireAndFlyScoreboardScenario[] = laddered(
  TURRET_MISSIONS,
  'mission',
);

/** Every laddered scenario: the trials, then the missions. */
export const FIRE_AND_FLY_SCOREBOARD_SCENARIOS: readonly FireAndFlyScoreboardScenario[] = [
  ...FIRE_AND_FLY_SCOREBOARD_TRIALS,
  ...FIRE_AND_FLY_SCOREBOARD_MISSIONS,
];

/** The periods a scenario ranks over: a mission has no daily board. */
export function fireAndFlyScorePeriods(
  kind: FireAndFlyScenarioKind,
): readonly FireAndFlyScorePeriod[] {
  return kind === 'trial' ? FIRE_AND_FLY_SCORE_PERIODS : ['lifetime'];
}

const boardId = (entry: FireAndFlyScoreboardScenario, period: FireAndFlyScorePeriod): string =>
  `fire_and_fly_${entry.key}_v${entry.version}_${period}`;

const BY_BOARD = new Map<string, FireAndFlyScoreboardInfo>(
  FIRE_AND_FLY_SCOREBOARD_SCENARIOS.flatMap((entry) =>
    fireAndFlyScorePeriods(entry.kind).map((period) => [
      boardId(entry, period),
      { ...entry, period },
    ]),
  ),
);

export function fireAndFlyScoreboardId(
  scenarioId: string,
  period: FireAndFlyScorePeriod,
): string | null {
  const entry = FIRE_AND_FLY_SCOREBOARD_SCENARIOS.find((s) => s.scenarioId === scenarioId);
  return entry && fireAndFlyScorePeriods(entry.kind).includes(period)
    ? boardId(entry, period)
    : null;
}

export function fireAndFlyScoreboardInfo(board: string): FireAndFlyScoreboardInfo | null {
  return BY_BOARD.get(board) ?? null;
}

/**
 * The Gunner's Mastery board: one lifetime row per character, the sum of their best
 * medal over the missions (gold 3, silver 2, bronze 1), ties broken by the sum of
 * those best runs' points.
 */
export const FIRE_AND_FLY_MASTERY_BOARD_ID = `fire_and_fly_mastery_v${FIRE_AND_FLY_MASTERY_VERSION}_lifetime`;
