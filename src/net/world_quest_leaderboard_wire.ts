// The online read of one world-quest scoreboard page. A public GET (no bearer:
// the ladder is bragging rights, and the server rate-limits it like the other
// public boards); any failure resolves the empty page so the window paints
// its empty state rather than an error for a board that simply has no rows.
// `viewer` asks the server for that character's own standing (`self`), parsed
// defensively: a malformed row reads as "no standing", never a crash.
import { apiUrl } from '../client_origin';
import { LEADERBOARD_PAGE_SIZE } from '../sim/leaderboard_page';
import { emptyWorldQuestLeaderboardPage } from '../sim/world_quest_leaderboard_page';
import type { WorldQuestMedal, WorldQuestScoreboardId } from '../sim/world_quest_scoreboards';
import type { WorldQuestLeaderboardEntry, WorldQuestLeaderboardPage } from '../world_api';

const MEDALS: ReadonlySet<string> = new Set<WorldQuestMedal>(['bronze', 'silver', 'gold']);

/** One ladder row off the wire, or null when any field is missing or mistyped. */
export function parseWorldQuestLeaderboardEntry(raw: unknown): WorldQuestLeaderboardEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const { rank, name, medal, metric } = raw as Record<string, unknown>;
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 1) return null;
  if (typeof name !== 'string' || name === '') return null;
  if (typeof metric !== 'number' || !Number.isFinite(metric)) return null;
  if (medal !== null && (typeof medal !== 'string' || !MEDALS.has(medal))) return null;
  return { rank, name, medal: medal as WorldQuestMedal | null, metric };
}

export async function fetchWorldQuestLeaderboard(
  base: string,
  board: WorldQuestScoreboardId,
  page = 0,
  pageSize = LEADERBOARD_PAGE_SIZE,
  viewer?: string,
): Promise<WorldQuestLeaderboardPage> {
  const empty = emptyWorldQuestLeaderboardPage(board, 0, pageSize);
  try {
    const who = viewer ? `&viewer=${encodeURIComponent(viewer)}` : '';
    const query = `board=${encodeURIComponent(board)}&page=${page}&pageSize=${pageSize}${who}`;
    const res = await fetch(apiUrl(`/api/world-quests/leaderboard?${query}`, base));
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      board,
      leaders: Array.isArray(data.leaders) ? data.leaders : [],
      page: data.page ?? page,
      pageCount: data.pageCount ?? 1,
      total: data.total ?? data.leaders?.length ?? 0,
      pageSize: data.pageSize ?? pageSize,
      self: parseWorldQuestLeaderboardEntry(data.self),
    };
  } catch {
    return empty;
  }
}
