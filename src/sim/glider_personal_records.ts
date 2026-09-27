import {
  GLIDER_SCOREBOARD_COURSES,
  gliderScoreboardId,
  gliderScoreboardInfo,
} from './glider_scoreboards';
import { paginateWorldQuestLeaderboard } from './world_quest_leaderboard_page';

interface PersonalGliderRecord {
  metric: number;
  medal: 'gold' | 'silver' | 'bronze';
  day: string;
}
export type PersonalGliderRecords = Record<string, PersonalGliderRecord>;

function validRecord(value: unknown): value is PersonalGliderRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as PersonalGliderRecord;
  return (
    Number.isFinite(row.metric) &&
    row.metric > 0 &&
    row.metric < 1000 &&
    ['gold', 'silver', 'bronze'].includes(row.medal) &&
    typeof row.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.day)
  );
}

/** Six bounded slots; unknown boards and saved extra properties are discarded. */
export function sanitizeGliderRecords(value: unknown): PersonalGliderRecords {
  const records: PersonalGliderRecords = {};
  if (!value || typeof value !== 'object') return records;
  for (const course of GLIDER_SCOREBOARD_COURSES) {
    for (const period of ['daily', 'lifetime'] as const) {
      const board = gliderScoreboardId(course.courseId, period)!;
      const row = (value as Record<string, unknown>)[board];
      if (validRecord(row)) records[board] = { metric: row.metric, medal: row.medal, day: row.day };
    }
  }
  return records;
}

export function recordPersonalGliderTime(
  records: PersonalGliderRecords,
  courseId: string,
  day: string,
  metric: number,
  medal: PersonalGliderRecord['medal'],
): void {
  const row = { day, metric, medal };
  if (!validRecord(row)) return;
  for (const period of ['daily', 'lifetime'] as const) {
    const board = gliderScoreboardId(courseId, period);
    if (!board) continue;
    const previous = records[board];
    if (
      !previous ||
      (period === 'daily' && day > previous.day) ||
      ((period === 'lifetime' || day === previous.day) && metric < previous.metric)
    ) {
      records[board] = { ...row };
    }
  }
}

export function personalGliderLeaderboard(
  player: { name: string; gliderRecords: PersonalGliderRecords },
  board: string,
  day: string,
  page: number,
  pageSize: number,
) {
  const info = gliderScoreboardInfo(board);
  const record = player.gliderRecords[board];
  const self =
    info && record && (info.period === 'lifetime' || record.day === day)
      ? { rank: 1, name: player.name, medal: record.medal, metric: record.metric }
      : null;
  return {
    ...paginateWorldQuestLeaderboard(board, self ? [self] : [], page, pageSize, self),
    ...(info ? { personal: true } : {}),
  };
}
