import type {
  DeedsLeaderboardEntry,
  DeedsLeaderboardSelf,
  DevLeaderboardEntry,
  GuildLeaderboardEntry,
  LeaderboardEntry,
} from '../world_api';

// Host-agnostic pagination for the high-score boards. Lives in src/sim/
// (no DOM, no randomness) so BOTH the authoritative server and the offline Sim
// can share one slicing rule; the client only renders the page the server
// already decided. Same shape as the World Market's server-side pagination
// (src/sim/market.ts) and reachable from server/ (which may import sim/ but never ui/).

// 50 ranks per page: 10 pages cover the 500 deepest, 20 cover the 1000-cap.
export const LEADERBOARD_PAGE_SIZE = 50;
// The deepest rank the board exposes. Caching this many rows is what makes
// server-side paging a cheap in-memory slice instead of a per-page OFFSET query.
export const LEADERBOARD_MAX = 1000;

// One page of a ranked board. Generic over the entry type so the player board
// (LeaderboardEntry) and the guild board (GuildLeaderboardEntry) share the exact
// same envelope, slicing, clamping, and 1000-cap rule.
export interface RankedPage<T> {
  leaders: T[];
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}

export type LeaderboardPage = RankedPage<LeaderboardEntry>;
export type GuildLeaderboardPage = RankedPage<GuildLeaderboardEntry>;
export type DevLeaderboardPage = RankedPage<DevLeaderboardEntry>;
// The Renown board page also carries the viewer's own standing when the
// server resolved one (an authenticated, ranked caller); the paginator never
// sets it, the route builder does.
export type DeedsLeaderboardPage = RankedPage<DeedsLeaderboardEntry> & {
  self?: DeedsLeaderboardSelf;
};

// Slice `entries` (already sorted, rank ascending) into a single page. The
// requested page is clamped into range so a stale page index never yields an
// empty board. `total` is capped at LEADERBOARD_MAX so pageCount never promises
// pages past the exposed depth. Generic so every high-score board pages
// identically; the player and guild boards are thin typed wrappers below.
export function paginateRanked<T>(
  entries: readonly T[],
  requestedPage: number,
  requestedPageSize: number = LEADERBOARD_PAGE_SIZE,
): RankedPage<T> {
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

// The lifetime-XP player board. Thin typed wrapper over paginateRanked.
export function paginateLeaderboard(
  entries: readonly LeaderboardEntry[],
  requestedPage: number,
  requestedPageSize: number = LEADERBOARD_PAGE_SIZE,
): LeaderboardPage {
  return paginateRanked(entries, requestedPage, requestedPageSize);
}

// The guild board (guilds ranked by summed member lifetime XP). Thin typed
// wrapper over paginateRanked.
export function paginateGuildLeaderboard(
  entries: readonly GuildLeaderboardEntry[],
  requestedPage: number,
  requestedPageSize: number = LEADERBOARD_PAGE_SIZE,
): GuildLeaderboardPage {
  return paginateRanked(entries, requestedPage, requestedPageSize);
}

// The developer board (contributors ranked by landed commits). Thin typed
// wrapper over paginateRanked.
export function paginateDevLeaderboard(
  entries: readonly DevLeaderboardEntry[],
  requestedPage: number,
  requestedPageSize: number = LEADERBOARD_PAGE_SIZE,
): DevLeaderboardPage {
  return paginateRanked(entries, requestedPage, requestedPageSize);
}

// The Renown board (accounts ranked by lifetime deed Renown, character-faced).
// Thin typed wrapper over paginateRanked.
export function paginateDeedsLeaderboard(
  entries: readonly DeedsLeaderboardEntry[],
  requestedPage: number,
  requestedPageSize: number = LEADERBOARD_PAGE_SIZE,
): DeedsLeaderboardPage {
  return paginateRanked(entries, requestedPage, requestedPageSize);
}
