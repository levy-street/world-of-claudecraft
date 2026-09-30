// The offline host's Fire and Fly records: this character's best daily and lifetime
// run per trial, saved in the world quest block, ranked like the server's ladders
// (medal first, then points). Bounded to two rows per trial; unknown boards drop.

import {
  FIRE_AND_FLY_SCORE_PERIODS,
  FIRE_AND_FLY_SCOREBOARD_TRIALS,
  fireAndFlyScoreboardId,
  fireAndFlyScoreboardInfo,
} from './fire_and_fly_scoreboards';
import { TURRET_BONUS_CAP, TURRET_POINTS } from './minigames/turret_result';
import { paginateWorldQuestLeaderboard } from './world_quest_leaderboard_page';
import { WORLD_QUEST_MEDAL_RANK, type WorldQuestMedal } from './world_quest_scoreboards';

interface PersonalFireAndFlyRecord {
  metric: number;
  medal: WorldQuestMedal;
  day: string;
}
export type PersonalFireAndFlyRecords = Record<string, PersonalFireAndFlyRecord>;

/**
 * The most points a run can hold on a plan the resolver accepts: every kill of the
 * most spawns a plan may carry, the whole of the largest tower, and the bonus cap.
 * Mirrors TURRET_PLAN_LIMITS (minigames/turret_defense_plan.ts), kept as literals so
 * the ladder modules stay clear of the content tables that plan module reads.
 */
export const FIRE_AND_FLY_MAX_POINTS =
  64 * 256 * TURRET_POINTS.kill + 100_000 * TURRET_POINTS.integrity + TURRET_BONUS_CAP;

/** A scored run: a medal (only a win scores) and whole points within the bound. */
export function fireAndFlyScoreValid(medal: unknown, points: unknown): boolean {
  return (
    typeof medal === 'string' &&
    Object.hasOwn(WORLD_QUEST_MEDAL_RANK, medal) &&
    typeof points === 'number' &&
    Number.isSafeInteger(points) &&
    points >= 0 &&
    points <= FIRE_AND_FLY_MAX_POINTS
  );
}

/** True when `a` ranks above `b`: the better medal, then more points. */
export function fireAndFlyScoreBetter(
  a: { medal: WorldQuestMedal; metric: number },
  b: { medal: WorldQuestMedal; metric: number },
): boolean {
  const rankA = WORLD_QUEST_MEDAL_RANK[a.medal];
  const rankB = WORLD_QUEST_MEDAL_RANK[b.medal];
  return rankA !== rankB ? rankA > rankB : a.metric > b.metric;
}

function validRecord(value: unknown): value is PersonalFireAndFlyRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as PersonalFireAndFlyRecord;
  return (
    fireAndFlyScoreValid(row.medal, row.metric) &&
    typeof row.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.day)
  );
}

export function sanitizeFireAndFlyRecords(value: unknown): PersonalFireAndFlyRecords {
  const records: PersonalFireAndFlyRecords = {};
  if (!value || typeof value !== 'object') return records;
  for (const trial of FIRE_AND_FLY_SCOREBOARD_TRIALS) {
    for (const period of FIRE_AND_FLY_SCORE_PERIODS) {
      const board = fireAndFlyScoreboardId(trial.scenarioId, period)!;
      const row = (value as Record<string, unknown>)[board];
      if (validRecord(row)) records[board] = { metric: row.metric, medal: row.medal, day: row.day };
    }
  }
  return records;
}

/** Keeps the day's best (a newer day replaces it) and the all-time best of the trial. */
export function recordPersonalFireAndFlyScore(
  records: PersonalFireAndFlyRecords,
  scenarioId: string,
  day: string,
  medal: WorldQuestMedal,
  metric: number,
): void {
  const row = { day, metric, medal };
  if (!validRecord(row)) return;
  for (const period of FIRE_AND_FLY_SCORE_PERIODS) {
    const board = fireAndFlyScoreboardId(scenarioId, period);
    if (!board) continue;
    const previous = records[board];
    if (
      !previous ||
      (period === 'daily' && day > previous.day) ||
      ((period === 'lifetime' || day === previous.day) && fireAndFlyScoreBetter(row, previous))
    ) {
      records[board] = { ...row };
    }
  }
}

export function personalFireAndFlyLeaderboard(
  player: { name: string; fireAndFlyRecords: PersonalFireAndFlyRecords },
  board: string,
  day: string,
  page: number,
  pageSize: number,
) {
  const info = fireAndFlyScoreboardInfo(board);
  const record = player.fireAndFlyRecords[board];
  const self =
    info && record && (info.period === 'lifetime' || record.day === day)
      ? { rank: 1, name: player.name, medal: record.medal, metric: record.metric }
      : null;
  return {
    ...paginateWorldQuestLeaderboard(board, self ? [self] : [], page, pageSize, self),
    ...(info ? { personal: true } : {}),
  };
}
