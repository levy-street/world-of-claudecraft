// This character's Fire and Fly records: the best daily and lifetime run per trial and
// the best lifetime run per mission, saved in the world quest block, ranked like the
// server's ladders (medal first, then points). Bounded to two rows per trial and one
// per mission; unknown boards drop. The offline host serves its ladders from them,
// and every host sums the missions' rows into the Gunner's Mastery.

import {
  FIRE_AND_FLY_MASTERY_BOARD_ID,
  FIRE_AND_FLY_SCOREBOARD_MISSIONS,
  FIRE_AND_FLY_SCOREBOARD_SCENARIOS,
  fireAndFlyScoreboardId,
  fireAndFlyScoreboardInfo,
  fireAndFlyScorePeriods,
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
  for (const entry of FIRE_AND_FLY_SCOREBOARD_SCENARIOS) {
    for (const period of fireAndFlyScorePeriods(entry.kind)) {
      const board = fireAndFlyScoreboardId(entry.scenarioId, period)!;
      const row = (value as Record<string, unknown>)[board];
      if (validRecord(row)) records[board] = { metric: row.metric, medal: row.medal, day: row.day };
    }
  }
  return records;
}

/** Keeps a trial's day's best (a newer day replaces it) and every scenario's all-time best. */
export function recordPersonalFireAndFlyScore(
  records: PersonalFireAndFlyRecords,
  scenarioId: string,
  day: string,
  medal: WorldQuestMedal,
  metric: number,
): void {
  const row = { day, metric, medal };
  if (!validRecord(row)) return;
  for (const period of ['daily', 'lifetime'] as const) {
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

/** The Gunner's Mastery of a character: their best mission rows summed. */
export interface FireAndFlyMastery {
  /** Best medal per mission, gold 3, silver 2, bronze 1, summed. */
  stars: number;
  /** The points of those best runs, summed: the tie-break. */
  points: number;
  /** Missions with a best run. */
  missions: number;
}

/** The most stars a Mastery row can hold: a gold on every mission. */
export const FIRE_AND_FLY_MASTERY_MAX_STARS =
  FIRE_AND_FLY_SCOREBOARD_MISSIONS.length * WORLD_QUEST_MEDAL_RANK.gold;

/** The most points a Mastery row can hold: the most each mission's best run can hold. */
export const FIRE_AND_FLY_MASTERY_MAX_POINTS =
  FIRE_AND_FLY_SCOREBOARD_MISSIONS.length * FIRE_AND_FLY_MAX_POINTS;

/** A Mastery row: whole stars and whole points within the missions' bounds. */
export function fireAndFlyMasteryValid(stars: unknown, points: unknown): boolean {
  return (
    typeof stars === 'number' &&
    Number.isSafeInteger(stars) &&
    stars >= 0 &&
    stars <= FIRE_AND_FLY_MASTERY_MAX_STARS &&
    typeof points === 'number' &&
    Number.isSafeInteger(points) &&
    points >= 0 &&
    points <= FIRE_AND_FLY_MASTERY_MAX_POINTS
  );
}

export function fireAndFlyMastery(records: PersonalFireAndFlyRecords): FireAndFlyMastery {
  const mastery = { stars: 0, points: 0, missions: 0 };
  for (const mission of FIRE_AND_FLY_SCOREBOARD_MISSIONS) {
    const board = fireAndFlyScoreboardId(mission.scenarioId, 'lifetime');
    const best = board && Object.hasOwn(records, board) ? records[board] : undefined;
    if (!best) continue;
    mastery.stars += WORLD_QUEST_MEDAL_RANK[best.medal];
    mastery.points += best.metric;
    mastery.missions++;
  }
  return mastery;
}

export function personalFireAndFlyLeaderboard(
  player: { name: string; fireAndFlyRecords: PersonalFireAndFlyRecords },
  board: string,
  day: string,
  page: number,
  pageSize: number,
) {
  if (board === FIRE_AND_FLY_MASTERY_BOARD_ID) {
    const mastery = fireAndFlyMastery(player.fireAndFlyRecords);
    const self =
      mastery.missions > 0
        ? {
            rank: 1,
            name: player.name,
            medal: null,
            metric: mastery.points,
            stars: mastery.stars,
          }
        : null;
    return {
      ...paginateWorldQuestLeaderboard(board, self ? [self] : [], page, pageSize, self),
      personal: true,
    };
  }
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
