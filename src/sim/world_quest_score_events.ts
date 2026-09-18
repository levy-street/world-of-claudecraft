// The one emit path for a finished scoreboard attempt. Every medal world
// quest calls this at the moment its result is final, so the server observer
// (server/world_quest_leaderboard.ts) has a single event shape to record and
// the boards can never disagree about which quest feeds which ladder.
import type { SimContext } from './sim_context';
import { type WorldQuestMedal, worldQuestScoreboardForQuest } from './world_quest_scoreboards';

/** No-op for a quest without a board, so callers need no lookup of their own. */
export function emitWorldQuestScore(
  ctx: Pick<SimContext, 'emit'>,
  pid: number,
  questId: string,
  medal: WorldQuestMedal | null,
  metric: number,
): boolean {
  const board = worldQuestScoreboardForQuest(questId);
  if (!board) return false;
  ctx.emit({ type: 'worldQuestScore', pid, board: board.id, medal, metric });
  return true;
}
