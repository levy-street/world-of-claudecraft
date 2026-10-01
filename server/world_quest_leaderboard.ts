// The world-quest scoreboards: the game-loop observer that records one
// finished attempt, the per-board cached ladder, and the public read route.
//
//   GET /api/world-quests/leaderboard?board=<id>&page=N&pageSize=M
//
// Write side (recordWorldQuestScore): the sim emits `worldQuestScore` once per
// finished attempt (and `worldQuestMastery` when a Fire and Fly mission moves a
// character's Gunner's Mastery, recorded by recordFireAndFlyMastery on the same
// FIFO); the observer resolves the board, derives the one sortable
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

import { resetDayKey } from '../src/reset_calendar';
import {
  fireAndFlyMasteryValid,
  fireAndFlyScoreValid,
} from '../src/sim/fire_and_fly_personal_records';
import {
  FIRE_AND_FLY_MASTERY_BOARD_ID,
  fireAndFlyScoreboardInfo,
} from '../src/sim/fire_and_fly_scoreboards';
import { gliderScoreboardInfo } from '../src/sim/glider_scoreboards';
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
import { fireAndFlyMasteryRows, upsertFireAndFlyMastery } from './fire_and_fly_mastery_db';
import { fireAndFlyScoreRows, upsertFireAndFlyScore } from './fire_and_fly_scores_db';
import { gliderScoreRows, upsertGliderScore } from './glider_scores_db';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';
import { REALM, REALM_RESET_TIME_ZONE } from './realm';
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
  resetDay?: string;
}

export interface FireAndFlyMasteryObservation {
  board: string;
  stars: number;
  points: number;
}

export interface WorldQuestScoreWho {
  accountId: number;
  characterId: number;
}

type ScoreDb = {
  upsert: typeof upsertWorldQuestScore;
  rows: typeof worldQuestScoreboardRows;
};

/** A board with its own table: the glider's courses, Fire and Fly's trials and missions
 *  (daily and lifetime rows), and the Gunner's Mastery. */
interface PeriodicBoard {
  period: 'daily' | 'lifetime';
  rows: typeof gliderScoreRows;
  /** Null when no run's score writes the board (the Mastery has its own event). */
  upsert: typeof upsertGliderScore | null;
  /** The sim's own bounds on a submitted run, checked before it is queued. */
  accepts(ev: WorldQuestScoreObservation): boolean;
}

function periodicBoard(boardId: string): PeriodicBoard | null {
  const glider = gliderScoreboardInfo(boardId);
  if (glider)
    return {
      period: glider.period,
      rows: gliderScoreRows,
      upsert: upsertGliderScore,
      accepts: (ev) => ev.metric > 0 && ev.metric < 1000,
    };
  const trial = fireAndFlyScoreboardInfo(boardId);
  if (trial)
    return {
      period: trial.period,
      rows: fireAndFlyScoreRows,
      upsert: upsertFireAndFlyScore,
      accepts: (ev) => fireAndFlyScoreValid(ev.medal, ev.metric),
    };
  if (boardId === FIRE_AND_FLY_MASTERY_BOARD_ID)
    return {
      period: 'lifetime',
      rows: fireAndFlyMasteryRows,
      upsert: null,
      accepts: () => false,
    };
  return null;
}

let db: ScoreDb = { upsert: upsertWorldQuestScore, rows: worldQuestScoreboardRows };
const caches = new Map<string, CachedRead<WorldQuestScoreRow[]>>();
const periodicCacheDays = new Map<string, string>();
let tail: Promise<void> = Promise.resolve();
let pending = 0;
let shedRows = 0;
let lastShedLogAt = 0;

/** Test seam: swap the SQL boundary and drop every cached ladder. */
export function configureWorldQuestScoreDbForTests(next: ScoreDb | null): void {
  db = next ?? { upsert: upsertWorldQuestScore, rows: worldQuestScoreboardRows };
  caches.clear();
  periodicCacheDays.clear();
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
  const periodic = periodicBoard(board.id);
  const day = periodic?.period === 'daily' ? resetDayKey(Date.now(), REALM_RESET_TIME_ZONE) : '';
  if (periodic && periodicCacheDays.get(board.id) !== day) {
    caches.delete(board.id);
    periodicCacheDays.set(board.id, day);
  }
  let cache = caches.get(board.id);
  if (!cache) {
    let retryAt = 0;
    cache = createCachedRead(
      async () => {
        if (periodic && Date.now() < retryAt)
          throw new Error('Periodic rankings temporarily unavailable');
        try {
          return await runWithStatementTimeout(WORLD_QUEST_LEADERBOARD_READ_TIMEOUT_MS, (query) =>
            periodic
              ? periodic.rows({ query }, REALM, board.id, day, ELIGIBLE_ACCOUNT_SQL)
              : db.rows({ query }, REALM, board.id, ELIGIBLE_ACCOUNT_SQL),
          );
        } catch (error) {
          if (periodic) retryAt = Date.now() + 5_000;
          throw error;
        }
      },
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

/** Queue one write on the FIFO tail, or shed it past the depth bound. */
function enqueue(write: () => Promise<unknown>): void {
  if (pending >= MAX_PENDING_WORLD_QUEST_SCORES) {
    shed();
    return;
  }
  pending += 1;
  tail = tail
    .then(async () => {
      await write();
    })
    .catch((err) => {
      console.error('world quest score write failed:', err);
    })
    .finally(() => {
      pending -= 1;
    });
}

/** The server event-loop hook: a pid-scoped worldQuestScore or worldQuestMastery event
 *  records for its connected scorer; every other event, and an unknown pid, is a no-op. */
export function recordWorldQuestScoreEvent(
  clients: { get(pid: number): WorldQuestScoreWho | undefined },
  ev: { type: string; pid?: number },
): void {
  if (ev.type !== 'worldQuestScore' && ev.type !== 'worldQuestMastery') return;
  const scorer = ev.pid === undefined ? undefined : clients.get(ev.pid);
  if (!scorer) return;
  if (ev.type === 'worldQuestMastery')
    recordFireAndFlyMastery(scorer, ev as unknown as FireAndFlyMasteryObservation);
  else recordWorldQuestScore(scorer, ev as unknown as WorldQuestScoreObservation);
}

/** Record a character's new Gunner's Mastery row (fire-and-forget; the table keeps it
 *  only when it rises). The ladder refreshes at the shared TTL, like the runs' boards. */
export function recordFireAndFlyMastery(
  who: WorldQuestScoreWho,
  ev: FireAndFlyMasteryObservation,
): void {
  if (ev.board !== FIRE_AND_FLY_MASTERY_BOARD_ID || !fireAndFlyMasteryValid(ev.stars, ev.points))
    return;
  const row = {
    realm: REALM,
    board: ev.board,
    characterId: who.characterId,
    accountId: who.accountId,
    stars: ev.stars,
    points: ev.points,
  };
  enqueue(() =>
    runWithStatementTimeout(WORLD_QUEST_LEADERBOARD_READ_TIMEOUT_MS, (query) =>
      upsertFireAndFlyMastery({ query }, row),
    ),
  );
}

/** Record one finished attempt (fire-and-forget; never throws, never awaits). */
export function recordWorldQuestScore(
  who: WorldQuestScoreWho,
  ev: WorldQuestScoreObservation,
): void {
  const board = worldQuestScoreboard(ev.board);
  if (!board || !Number.isFinite(ev.metric)) return;
  const periodic = periodicBoard(board.id);
  const upsert = periodic?.upsert;
  if (
    periodic &&
    (!upsert ||
      periodic.period !== 'lifetime' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ev.resetDay ?? '') ||
      !periodic.accepts(ev))
  )
    return;
  const metric = Math.max(0, ev.metric);
  const resetDay = ev.resetDay ?? '';
  const row = {
    realm: REALM,
    board: board.id,
    characterId: who.characterId,
    accountId: who.accountId,
    medal: ev.medal,
    metric,
    sortKey: worldQuestScoreSortKey(board, ev.medal, metric),
  };
  enqueue(async () => {
    if (upsert) {
      // Refresh at the shared TTL, never once per improving finish.
      await runWithStatementTimeout(WORLD_QUEST_LEADERBOARD_READ_TIMEOUT_MS, (query) =>
        upsert({ query }, { ...row, resetDay }),
      );
    } else if (await db.upsert(pool, row)) caches.get(board.id)?.bust();
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
  const daily = periodicBoard(board.id)?.period === 'daily';
  const day = daily ? resetDayKey(Date.now(), REALM_RESET_TIME_ZONE) : '';
  const rows = await cacheFor(board).read();
  if (daily && day !== resetDayKey(Date.now(), REALM_RESET_TIME_ZONE))
    return worldQuestLeaderboardPage(board, page, pageSize, viewer);
  const ranked: WorldQuestLeaderboardEntry[] = rows.map((row, i) => ({
    rank: i + 1,
    name: row.name,
    medal: row.medal,
    metric: row.metric,
    ...(row.stars === undefined ? {} : { stars: row.stars }),
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
