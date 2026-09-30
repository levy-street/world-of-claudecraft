// Fire and Fly's ladders: a daily and a lifetime board per trial, ranked by medal
// then points, no quest-wide board. Board ids carry the trial's score version
// (content/fire_and_fly_scenarios.ts), so a retuned trial starts fresh ladders.

import { FIRE_AND_FLY_SCORE_VERSIONS, TURRET_SCENARIOS } from './content/fire_and_fly_scenarios';

export type FireAndFlyScorePeriod = 'daily' | 'lifetime';

export const FIRE_AND_FLY_SCORE_PERIODS: readonly FireAndFlyScorePeriod[] = ['daily', 'lifetime'];

/** The noticeboard beside Master Gunner Alder that opens these ladders. */
export const FIRE_AND_FLY_RANKINGS_BOARD_ID = 'gunners_trials_rankings';

export interface FireAndFlyScoreboardInfo {
  scenarioId: string;
  key: string;
  version: number;
  period: FireAndFlyScorePeriod;
}

/** The trials with a ladder, in the order the instructor offers them. */
export const FIRE_AND_FLY_SCOREBOARD_TRIALS: readonly {
  scenarioId: string;
  key: string;
  version: number;
}[] = TURRET_SCENARIOS.flatMap((scenario) => {
  const version = FIRE_AND_FLY_SCORE_VERSIONS[scenario.boardKey];
  return Number.isSafeInteger(version) && version > 0
    ? [{ scenarioId: scenario.id, key: scenario.boardKey, version }]
    : [];
});

const BY_BOARD = new Map<string, FireAndFlyScoreboardInfo>(
  FIRE_AND_FLY_SCOREBOARD_TRIALS.flatMap((trial) =>
    FIRE_AND_FLY_SCORE_PERIODS.map((period) => [
      `fire_and_fly_${trial.key}_v${trial.version}_${period}`,
      { ...trial, period },
    ]),
  ),
);

export function fireAndFlyScoreboardId(
  scenarioId: string,
  period: FireAndFlyScorePeriod,
): string | null {
  const trial = FIRE_AND_FLY_SCOREBOARD_TRIALS.find((entry) => entry.scenarioId === scenarioId);
  return trial ? `fire_and_fly_${trial.key}_v${trial.version}_${period}` : null;
}

export function fireAndFlyScoreboardInfo(boardId: string): FireAndFlyScoreboardInfo | null {
  return BY_BOARD.get(boardId) ?? null;
}
