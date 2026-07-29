// Arena season API surface: the public season readout the arena window renders.
//
// One anonymous read. The season NUMBER and its countdown are pure calendar
// arithmetic the client already computes for itself (src/sim/arena_season.ts is
// shared code), so this endpoint carries only what a client cannot know: which
// seasons this realm has settled and who won them. That split is deliberate. It
// keeps the countdown a zero-request local render and keeps the champion list a
// cache-fronted read that a full Coliseum cannot turn into query load.
//
// Registry-only RouteDef, per the new-route rule (server/http/CLAUDE.md): there
// is no legacy ladder twin, and the legacy rollback answers 404 for it by design.

import {
  ARENA_SEASON_BRACKETS,
  type ArenaSeasonBracket,
  arenaSeasonIndexAt,
} from '../src/sim/arena_season';
import { ARENA_SEASON_COUNT, arenaSeasonDef } from '../src/sim/content/arena_seasons';
import type { PlayerClass } from '../src/sim/types';
import { arenaSeasonChampions } from './arena_season_db';
import { createCachedRead } from './cached_read';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';
import { REALM } from './realm';

/** How many settled seasons the readout carries. The window shows the most
 *  recent one prominently; the rest are the short hall-of-fame tail under it. */
export const ARENA_SEASON_HISTORY_DEPTH = 4;

/** Champions move only at a season boundary, so a long TTL is free accuracy. */
export const ARENA_SEASON_CACHE_TTL_MS = 5 * 60_000;

/** One champion on the public readout. */
export interface ArenaSeasonChampionView {
  bracket: ArenaSeasonBracket;
  name: string;
  cls: PlayerClass;
  rating: number;
}

/** One settled season on the public readout. */
export interface ArenaSeasonHistoryEntry {
  season: number;
  /** The deed id the champions wear; the client localizes it through deed_i18n. */
  deedId: string;
  champions: ArenaSeasonChampionView[];
}

/** GET /api/arena/seasons. `season` is this realm's live season number (0 in
 *  Preseason); `authored` is how many seasons the content roster defines. */
export interface ArenaSeasonReadout {
  season: number;
  authored: number;
  settled: ArenaSeasonHistoryEntry[];
}

/** A bracket string off a database row, narrowed; anything else is dropped. */
function asBracket(value: string): ArenaSeasonBracket | null {
  return (ARENA_SEASON_BRACKETS as readonly string[]).includes(value)
    ? (value as ArenaSeasonBracket)
    : null;
}

/**
 * Fold the flat award rows into one entry per settled season. Pure and exported
 * so the grouping (and the drop of any row whose season left the content roster)
 * is unit-testable without a database.
 */
export function buildArenaSeasonHistory(
  rows: readonly {
    season: number;
    bracket: string;
    name?: string;
    cls?: PlayerClass;
    rating: number;
  }[],
): ArenaSeasonHistoryEntry[] {
  const bySeason = new Map<number, ArenaSeasonHistoryEntry>();
  for (const row of rows) {
    const def = arenaSeasonDef(row.season);
    const bracket = asBracket(row.bracket);
    if (!def || !bracket || !row.name || !row.cls) continue;
    let entry = bySeason.get(row.season);
    if (!entry) {
      entry = { season: row.season, deedId: def.deedId, champions: [] };
      bySeason.set(row.season, entry);
    }
    entry.champions.push({ bracket, name: row.name, cls: row.cls, rating: row.rating });
  }
  return [...bySeason.values()].sort((a, b) => b.season - a.season);
}

// Module-local cache: this is the module's own expensive read, so it owns the
// cache rather than borrowing a main.ts one through a runtime injection (the
// deeds-rarity shape). No bust site exists on purpose: nothing outside a season
// boundary changes the answer, and the boundary is half a year away.
const championsCache = createCachedRead(
  async () =>
    buildArenaSeasonHistory(await arenaSeasonChampions(REALM, ARENA_SEASON_HISTORY_DEPTH)),
  { ttlMs: ARENA_SEASON_CACHE_TTL_MS },
);

/** Drop the cached champions view so a unit test starts cold. Tests only: in
 *  production nothing outside a season boundary can change the answer, and the
 *  TTL covers that. */
export function resetArenaSeasonCacheForTests(): void {
  championsCache.bust();
}

async function seasonsHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  // A cold-cache database failure must not fail the whole readout: the live
  // season number is the part players see every time they open the window, and
  // it needs no database at all.
  const settled = await championsCache.read().catch((err) => {
    console.error('arena season champions read failed:', err);
    return [] as ArenaSeasonHistoryEntry[];
  });
  const body: ArenaSeasonReadout = {
    season: arenaSeasonIndexAt(Date.now()),
    authored: ARENA_SEASON_COUNT,
    settled,
  };
  json(ctx.res, 200, body);
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/arena/seasons',
    surface: 'api',
    handler: seasonsHandler,
  },
];
