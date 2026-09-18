// Paging for the world-quest scoreboards, shared by the server route (which
// slices its cached ladder) and the offline Sim (which has no ladder and
// resolves the empty page), so every host pages the boards identically.
import type { WorldQuestLeaderboardEntry, WorldQuestLeaderboardPage } from '../world_api';
import { LEADERBOARD_PAGE_SIZE, paginateRanked } from './leaderboard_page';
import type { WorldQuestScoreboardId } from './world_quest_scoreboards';

export function paginateWorldQuestLeaderboard(
  board: WorldQuestScoreboardId,
  entries: readonly WorldQuestLeaderboardEntry[],
  page: number,
  pageSize: number = LEADERBOARD_PAGE_SIZE,
  self: WorldQuestLeaderboardEntry | null = null,
): WorldQuestLeaderboardPage {
  return { board, ...paginateRanked(entries, page, pageSize), self };
}

export function emptyWorldQuestLeaderboardPage(
  board: WorldQuestScoreboardId,
  page = 0,
  pageSize: number = LEADERBOARD_PAGE_SIZE,
): WorldQuestLeaderboardPage {
  return paginateWorldQuestLeaderboard(board, [], page, pageSize);
}
