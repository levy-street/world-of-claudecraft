// The world-quest scoreboards: which medal world quests keep a public ladder,
// what one row measures, and the single sortable key both the authoritative
// server (server/world_quest_leaderboard.ts) and every host read the same way.
//
// Host-agnostic on purpose: no ctx, no DOM, no randomness. The sim emits one
// `worldQuestScore` event per finished attempt (a forge cooled, a flight won,
// an endless cannon line finally breached); the server keeps each character's
// BEST row per board and serves it back through IWorldQuests. Nothing here
// grants power: the ladder is bragging rights only.

import { GLIDER_SCOREBOARD_COURSES, gliderScoreboardId } from './glider_scoreboards';

export type WorldQuestMedal = 'bronze' | 'silver' | 'gold';

export const WORLD_QUEST_MEDAL_RANK: Record<WorldQuestMedal, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
};

/** What the row's number means, and which way is better. */
export type WorldQuestScoreMetric = 'waves' | 'seconds' | 'points';

export interface WorldQuestScoreboard {
  id: string;
  questId: string;
  metric: WorldQuestScoreMetric;
  /** 'metric' ranks the number first (the endless cannon: waves held), 'medal'
   *  ranks the medal first and breaks ties on the number. */
  primary: 'metric' | 'medal';
}

export const WORLD_QUEST_SCOREBOARDS: readonly WorldQuestScoreboard[] = [
  { id: 'north_watch_cannon', questId: 'wq_evergarden_cannon', metric: 'waves', primary: 'metric' },
  { id: 'last_keep_cannon', questId: 'wq_last_keep_cannon', metric: 'waves', primary: 'metric' },
  { id: 'calligraphy', questId: 'wq_eastbrook_calligraphy', metric: 'points', primary: 'medal' },
  { id: 'slalom', questId: 'wq_galecrest_slalom', metric: 'points', primary: 'medal' },
  { id: 'forge', questId: 'wq_evergarden_forging', metric: 'seconds', primary: 'medal' },
  ...GLIDER_SCOREBOARD_COURSES.flatMap(({ courseId }) =>
    (['daily', 'lifetime'] as const).map(
      (period): WorldQuestScoreboard => ({
        id: gliderScoreboardId(courseId, period)!,
        questId: 'wq_galecrest_slalom',
        metric: 'seconds',
        primary: 'metric',
      }),
    ),
  ),
];

export type WorldQuestScoreboardId = (typeof WORLD_QUEST_SCOREBOARDS)[number]['id'];

const BY_ID = new Map(WORLD_QUEST_SCOREBOARDS.map((board) => [board.id, board]));
const BY_QUEST = new Map(
  WORLD_QUEST_SCOREBOARDS.filter((board) => !board.id.startsWith('glider_')).map((board) => [
    board.questId,
    board,
  ]),
);

export function worldQuestScoreboard(id: string): WorldQuestScoreboard | undefined {
  return BY_ID.get(id);
}

export function worldQuestScoreboardForQuest(questId: string): WorldQuestScoreboard | undefined {
  return BY_QUEST.get(questId);
}

/** The metric never sorts past this magnitude; keeps the key monotone per medal tier. */
const METRIC_SPAN = 1_000_000;

/** One number, higher is better, that orders rows the way the board reads:
 *  medal tiers dominate on medal-first boards (a bronze with a huge score never
 *  outranks a silver), the number dominates on metric-first boards, and a
 *  'seconds' metric flips so a faster time scores higher. */
export function worldQuestScoreSortKey(
  board: WorldQuestScoreboard,
  medal: WorldQuestMedal | null,
  metric: number,
): number {
  const rank = medal ? WORLD_QUEST_MEDAL_RANK[medal] : 0;
  const bounded = Math.max(0, Math.min(METRIC_SPAN - 1, Number.isFinite(metric) ? metric : 0));
  const direction = board.metric === 'seconds' ? METRIC_SPAN - 1 - bounded : bounded;
  return board.primary === 'metric' ? direction * 4 + rank : rank * METRIC_SPAN + direction;
}
