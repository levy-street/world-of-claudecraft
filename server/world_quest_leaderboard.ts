// The world-quest scoreboards: the game-loop observer that records one
// finished attempt, the per-board cached ladder, and the public read route.
//
//   GET /api/world-quests/leaderboard?board=<id>&page=N&pageSize=M
//
// Write side (recordWorldQuestScore): the sim emits `worldQuestScore` once per
// finished attempt; the observer resolves the board, derives the one sortable
// key (src/sim/world_quest_scoreboards.ts, shared with every host), and queues
// the best-row upsert on a per-process FIFO tail (the progress_events.ts
// shape: ONE write in flight at a time, so a burst can never crowd logins and
// autosaves out of the shared pool; a depth bound sheds past it). A lost row
// costs a ladder entry the next attempt re-earns, never gameplay. An accepted
// write busts that board's cache so the player sees their new standing on the
// next open; a no-op write (a worse attempt) leaves the cache alone.
//
// Read side: one createCachedRead per board (single-flight, stale-serve) over
// the full ranked ladder, paged in memory by the shared paginator, so a
// viewer-identical read never hits Postgres more than once per TTL per board.
// Moderation busts every board at once (bustWorldQuestLeaderboardCaches, wired
// from server/main.ts bustBoardCaches) so a banned account delists at once.
// Anonymous and rate-limited like the other public boards
// (server/leaderboard.ts). An optional `viewer` (a character name, already
// public on the ladder) resolves that character's standing from the SAME
// cached ladder into the page's `self`, so the window can pin "your best"
// even when the row sits pages away; it never costs a query of its own.
import { LEADERBOARD_PAGE_SIZE } from '../src/sim/leaderboard_page';
import { paginateWorldQuestLeaderboard } from '../src/sim/world_quest_leaderboard_page';
import {
  WORLD_QUEST_SCOREBOARDS,
  type WorldQuestMedal,
  type WorldQuestScoreboard,
  worldQuestScoreboard,
  worldQuestScoreSortKey,
} from '../src/sim/world_quest_scoreboards';
import type { WorldQuestLeaderboardEntry, WorldQuestLeaderboardPage } from '../src/world_api';
import { type CachedRead, createCachedRead } from './cached_read';
import { ELIGIBLE_ACCOUNT_SQL, pool, runWithStatementTimeout } from './db';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';
import { REALM } from './realm';
import {
  upsertWorldQuestScore,
  type WorldQuestScoreRow,
  worldQuestScoreboardRows,
} from './world_quest_scores_db';

const UNKNOWN_BOARD_CODE = 'world_quests.unknown_board';

// Query decoding mirrors server/leaderboard.ts (first value of a repeated key,
// lenient Number coercion) without importing it: that module's load-time db
// reads would drag every partial db mock in the game-server tests along.
function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** How long one board's ladder is served from memory before a re-read. */
export const WORLD_QUEST_LEADERBOARD_TTL_MS = 30_000;

/** Per-refresh statement bound for the ranked read: far below the pool
 *  default (the GUILD_BANK_LOG_TIMEOUT_MS reasoning in server/db.ts), so a
 *  brownout fails six board refreshes fast into stale-serve instead of
 *  pinning pooled clients. */
export const WORLD_QUEST_LEADERBOARD_READ_TIMEOUT_MS = 2_000;

/** FIFO depth bound: past it new rows are shed (logged at most once a minute),
 *  so a database stall can never grow an unbounded promise backlog. */
export const MAX_PENDING_WORLD_QUEST_SCORES = 256;

const SHED_LOG_INTERVAL_MS = 60_000;

export interface WorldQuestScoreObservation {
  board: string;
  medal: WorldQuestMedal | null;
  metric: number;
}

export interface WorldQuestScoreWho {
  accountId: number;
  characterId: number;
}

type ScoreDb = {
  upsert: typeof upsertWorldQuestScore;
  rows: typeof worldQuestScoreboardRows;
};

let db: ScoreDb = { upsert: upsertWorldQuestScore, rows: worldQuestScoreboardRows };
const caches = new Map<string, CachedRead<WorldQuestScoreRow[]>>();
let tail: Promise<void> = Promise.resolve();
let pending = 0;
let shedRows = 0;
let lastShedLogAt = 0;

/** Test seam: swap the SQL boundary and drop every cached ladder. */
export function configureWorldQuestScoreDbForTests(next: ScoreDb | null): void {
  db = next ?? { upsert: upsertWorldQuestScore, rows: worldQuestScoreboardRows };
  caches.clear();
  tail = Promise.resolve();
  pending = 0;
  shedRows = 0;
  lastShedLogAt = 0;
}

/** Writes queued and not yet settled (observability + tests). */
export function worldQuestScoresPending(): number {
  return pending;
}

/** Rows shed by the depth bound since boot (observability + tests). */
export function worldQuestScoresShedCount(): number {
  return shedRows;
}

/** Resolves once every queued write has settled (the shutdown drain). */
export function worldQuestScoresIdle(): Promise<void> {
  return tail;
}

/** Drop every cached ladder (moderation: a delisted account leaves at once). */
export function bustWorldQuestLeaderboardCaches(): void {
  for (const cache of caches.values()) cache.bust();
}

function cacheFor(board: WorldQuestScoreboard): CachedRead<WorldQuestScoreRow[]> {
  let cache = caches.get(board.id);
  if (!cache) {
    cache = createCachedRead(
      () =>
        runWithStatementTimeout(WORLD_QUEST_LEADERBOARD_READ_TIMEOUT_MS, (query) =>
          db.rows({ query }, REALM, board.id, ELIGIBLE_ACCOUNT_SQL),
        ),
      { ttlMs: WORLD_QUEST_LEADERBOARD_TTL_MS },
    );
    caches.set(board.id, cache);
  }
  return cache;
}

function shed(): void {
  shedRows += 1;
  const now = Date.now();
  if (now - lastShedLogAt >= SHED_LOG_INTERVAL_MS) {
    lastShedLogAt = now;
    console.error(`world quest score FIFO full; shed ${shedRows} rows so far`);
  }
}

/** The server event-loop hook: a pid-scoped worldQuestScore event records for its
 *  connected scorer; every other event, and an unknown pid, is a no-op. */
export function recordWorldQuestScoreEvent(
  clients: { get(pid: number): WorldQuestScoreWho | undefined },
  ev: { type: string; pid?: number },
): void {
  if (ev.type !== 'worldQuestScore' || ev.pid === undefined) return;
  const scorer = clients.get(ev.pid);
  if (scorer) recordWorldQuestScore(scorer, ev as unknown as WorldQuestScoreObservation);
}

/** Record one finished attempt (fire-and-forget; never throws, never awaits). */
export function recordWorldQuestScore(
  who: WorldQuestScoreWho,
  ev: WorldQuestScoreObservation,
): void {
  const board = worldQuestScoreboard(ev.board);
  if (!board || !Number.isFinite(ev.metric)) return;
  if (pending >= MAX_PENDING_WORLD_QUEST_SCORES) {
    shed();
    return;
  }
  pending += 1;
  const metric = Math.max(0, ev.metric);
  const row = {
    realm: REALM,
    board: board.id,
    characterId: who.characterId,
    accountId: who.accountId,
    medal: ev.medal,
    metric,
    sortKey: worldQuestScoreSortKey(board, ev.medal, metric),
  };
  tail = tail
    .then(async () => {
      if (await db.upsert(pool, row)) caches.get(board.id)?.bust();
    })
    .catch((err) => {
      console.error('world quest score write failed:', err);
    })
    .finally(() => {
      pending -= 1;
    });
}

/** Longest `viewer` the route looks up; a longer string names no character. */
export const WORLD_QUEST_VIEWER_MAX_LENGTH = 64;

/** Rank the cached ladder and slice one page; `viewer` names the character
 *  whose own standing rides along as `self` (case-insensitive exact match). */
export async function worldQuestLeaderboardPage(
  board: WorldQuestScoreboard,
  page: number,
  pageSize: number,
  viewer?: string,
): Promise<WorldQuestLeaderboardPage> {
  const rows = await cacheFor(board).read();
  const ranked: WorldQuestLeaderboardEntry[] = rows.map((row, i) => ({
    rank: i + 1,
    name: row.name,
    medal: row.medal,
    metric: row.metric,
  }));
  const wanted = (viewer ?? '').trim().toLowerCase();
  const self =
    wanted && wanted.length <= WORLD_QUEST_VIEWER_MAX_LENGTH
      ? (ranked.find((entry) => entry.name.toLowerCase() === wanted) ?? null)
      : null;
  return paginateWorldQuestLeaderboard(board.id, ranked, page, pageSize, self);
}

async function worldQuestLeaderboardHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  const board = worldQuestScoreboard(queryValue(ctx.query.board) ?? '');
  if (!board) {
    json(ctx.res, 400, {
      error: 'unknown board',
      code: UNKNOWN_BOARD_CODE,
      boards: WORLD_QUEST_SCOREBOARDS.map((b) => b.id),
    });
    return;
  }
  const page = Number(queryValue(ctx.query.page)) || 0;
  const pageSize = Number(queryValue(ctx.query.pageSize)) || LEADERBOARD_PAGE_SIZE;
  const viewer = queryValue(ctx.query.viewer);
  json(ctx.res, 200, await worldQuestLeaderboardPage(board, page, pageSize, viewer));
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/world-quests/leaderboard',
    surface: 'api',
    handler: worldQuestLeaderboardHandler,
  },
];
