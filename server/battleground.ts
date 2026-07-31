// Thornhollow Fields battleground REST surface, born as a registry-only RouteDef module
// (the new-route rule in server/http/CLAUDE.md: a NEW endpoint never gets an
// inline main.ts ladder arm).
//
// This module hosts the anonymous public GET /api/battleground/leaderboard, the
// all-time Thornhollow Fields 5v5 ladder. Structure mirrors server/leaderboard.ts (the
// public-read exemplar): the SQL read stays in db.ts (topBgRatings) behind the
// main.ts TTL cache; this module carries only the host-agnostic inner read (the
// cache's INNER read, so the ladder depth is owned here), a thin Ctx handler,
// and the runtime injection seam. registry.ts spreads the static `routes` array
// at module load, before main.ts has booted the GameServer, so the handler
// cannot close over the cache directly (that would be a cycle: main -> registry
// -> battleground -> main); main.ts injects the cache-fronted getter once at
// load via configureBattlegroundRuntime, and a request never arrives before
// that runs.

import type { BgLeaderRow } from './db';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';

/** How many Thornhollow Fields ranks the public ladder returns (the arena ladder's depth). */
export const BG_LEADERBOARD_LIMIT = 20;

// ---------------------------------------------------------------------------
// Runtime injection (see the module header; the same seam shape as
// configureLeaderboardRuntime).
// ---------------------------------------------------------------------------

/** The main.ts-owned runtime the handler depends on but cannot import without a
 *  cycle: the cache-fronted ladder read (the TTL + single-flight getter). */
export interface BattlegroundRuntime {
  /** Cache-fronted Thornhollow Fields ladder read (main.ts getBgLeaderboard). */
  getBgLeaderboard(): Promise<BgLeaderRow[]>;
}

let runtime: BattlegroundRuntime | null = null;

/** Inject the main.ts runtime the handler needs. Called once at boot. */
export function configureBattlegroundRuntime(rt: BattlegroundRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetBattlegroundRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): BattlegroundRuntime {
  if (runtime === null) {
    throw new Error('battleground runtime is not configured; call configureBattlegroundRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Read function (host-agnostic; takes a narrow Db interface, no ctx/req/res).
// This is the main.ts cache's INNER read (main.ts wraps it in the TTL +
// single-flight getter), so BG_LEADERBOARD_LIMIT stays the one place the
// ladder depth is set.
// ---------------------------------------------------------------------------

/** DB read the Thornhollow Fields ladder needs. */
interface BgReadDb {
  topBgRatings(limit?: number): Promise<BgLeaderRow[]>;
}

/** GET /api/battleground/leaderboard body. */
export async function readBgLeaderboard(db: BgReadDb): Promise<{ leaders: BgLeaderRow[] }> {
  return { leaders: await db.topBgRatings(BG_LEADERBOARD_LIMIT) };
}

// ---------------------------------------------------------------------------
// Handler (a thin Ctx adapter, modeled on arenaLeaderboardHandler).
// ---------------------------------------------------------------------------

/** GET /api/battleground/leaderboard: the public all-time Thornhollow Fields ladder,
 *  served from the cache-fronted runtime so the ladder query runs at most once
 *  per TTL. Rate-limited in-handler with publicReadRateLimited (the same per-IP
 *  public-read budget the arena ladder and search routes use); the 429 keeps
 *  the { error: 'rate limited' } body shape those routes share. */
async function bgLeaderboardHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  json(ctx.res, 200, { leaders: await useRuntime().getBgLeaderboard() });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes; the registry
// dispatcher serves it under API_DISPATCH 'new' and the legacy rollback answers
// 404 for it by design (registry-only, no ladder twin).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/battleground/leaderboard',
    surface: 'api',
    handler: bgLeaderboardHandler,
  },
];
