import type { LeaderboardEntry } from '../world_api';

// Host-agnostic pagination for the lifetime-XP leaderboard. Lives in src/sim/
// (no DOM, no randomness) so BOTH the authoritative server and the offline Sim
// can share one slicing rule; the client only renders the page the server
// already decided. Mirrors paginateMarketListings (src/ui/market_filters.ts) but
// is reachable from server/ (which may import sim/ but never ui/).

// 50 ranks per page: 10 pages cover the 500 deepest, 20 cover the 1000-cap.
export const LEADERBOARD_PAGE_SIZE = 50;
// The deepest rank the board exposes. Caching this many rows is what makes
// server-side paging a cheap in-memory slice instead of a per-page OFFSET query.
export const LEADERBOARD_MAX = 1000;

export interface LeaderboardPage {
  leaders: LeaderboardEntry[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}

// Slice `entries` (already sorted, rank ascending) into a single page. The
// requested page is clamped into range so a stale page index never yields an
// empty board. `total` is capped at LEADERBOARD_MAX so pageCount never promises
// pages past the exposed depth.
export function paginateLeaderboard(
  entries: readonly LeaderboardEntry[],
  requestedPage: number,
  requestedPageSize: number = LEADERBOARD_PAGE_SIZE,
): LeaderboardPage {
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.max(1, Math.min(LEADERBOARD_PAGE_SIZE * 2, Math.floor(requestedPageSize)))
    : LEADERBOARD_PAGE_SIZE;
  const total = Math.min(entries.length, LEADERBOARD_MAX);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const page = Math.max(0, Math.min(pageCount - 1, requested));
  const start = page * pageSize;
  const end = Math.min(total, start + pageSize);
  return {
    leaders: entries.slice(start, end),
    page,
    pageCount,
    total,
    pageSize,
  };
}
