// "Officers online" presence for the signpost guild board
// (docs/prd/guild-pledge-board.md): the green dot beside a guild whose Guild
// Master or an officer is online right now, and the names the dot's tooltip
// lists.
//
// Two halves with different freshness, deliberately:
//  - WHO the officers are is a slow, viewer-identical read (topGuildOfficers,
//    guild_board_db.ts) served through one cached single-flight read on the
//    board's own TTL, so a promotion or demotion reaches the dot within one
//    window, exactly like every other board fact;
//  - WHETHER each is online is answered LIVE against this process's sessions
//    at serve time, per page (at most a page of guilds times a handful of
//    officers each: a few Set lookups per request, no DB, no allocation when
//    nobody is online), so the dot never shows a logged-out officer for a
//    cache window.
// Presence rides the realm-scoped board only: the cross-realm board cannot see
// other realms' sessions, so it carries no presence rather than a wrong one.
// The roster read is bust-wired into the moderation hook (main.ts
// bustBoardCaches) like the boards themselves; a moderated account holds no
// session, so even a stale roster row never lights a dot.

import type { GuildBoardOfficer, GuildLeaderboardEntry } from '../src/world_api/progression_xp';
import { type CachedRead, createCachedRead } from './cached_read';
import { type GuildOfficerRow, topGuildOfficers } from './guild_board_db';

/** Same cadence as the board caches (main.ts LEADERBOARD_TTL_MS): the roster
 *  moves as slowly as the ranking does. */
export const GUILD_BOARD_PRESENCE_TTL_MS = 30_000;

/** Officer rows grouped by guild, keyed by the guild's EXACT name: both the
 *  board row and the roster row carry g.name verbatim, guilds(realm, name)
 *  is the unique key, and two guilds whose names differ only by case are two
 *  guilds (the folded-name trigger guards new names only, so historical
 *  case-only pairs exist). A case-folded key would merge their officer lists
 *  and light both dots with the union, a wrong readout and a cross-guild
 *  name disclosure. */
export type GuildOfficerRoster = ReadonlyMap<string, readonly GuildOfficerRow[]>;

export function rosterByGuild(rows: readonly GuildOfficerRow[]): GuildOfficerRoster {
  const byGuild = new Map<string, GuildOfficerRow[]>();
  for (const row of rows) {
    const key = row.guildName;
    const bucket = byGuild.get(key);
    if (bucket) bucket.push(row);
    else byGuild.set(key, [row]);
  }
  return byGuild;
}

/** The officers of one guild who hold a session, in roster order (the Guild
 *  Master first, then officers by name: topGuildOfficers orders the rows and
 *  this keeps that contract rather than re-sorting). Names only: the public
 *  surface never carries character ids. */
export function onlineOfficersOf(
  officers: readonly GuildOfficerRow[] | undefined,
  isOnline: (characterId: number) => boolean,
): GuildBoardOfficer[] {
  if (!officers) return [];
  const online: GuildBoardOfficer[] = [];
  for (const officer of officers) {
    if (isOnline(officer.characterId)) online.push({ name: officer.name, rank: officer.rank });
  }
  return online;
}

/**
 * Attach the live presence to one served page of board rows. Pure: returns a
 * NEW array; a row with an online officer becomes a new object carrying
 * `onlineOfficers`, a row with none is passed through by reference (so an
 * idle realm allocates nothing beyond the page array), and the cached
 * entries are never mutated (they are frozen and shared across requests).
 */
export function attachOfficerPresence(
  leaders: readonly GuildLeaderboardEntry[],
  roster: GuildOfficerRoster,
  isOnline: (characterId: number) => boolean,
): GuildLeaderboardEntry[] {
  return leaders.map((entry) => {
    const online = onlineOfficersOf(roster.get(entry.name), isOnline);
    return online.length === 0 ? entry : { ...entry, onlineOfficers: online };
  });
}

export interface GuildBoardPresence {
  /** Decorate a served page with live officer presence. Never rejects: a
   *  cold roster read that fails serves the page without presence (logged),
   *  so the board itself is never held hostage to the roster query. */
  attach(
    leaders: readonly GuildLeaderboardEntry[],
    isOnline: (characterId: number) => boolean,
  ): Promise<GuildLeaderboardEntry[]>;
  /** Drop the cached roster (the moderation bust hook). */
  bust(): void;
}

export interface GuildBoardPresenceDeps {
  readOfficers: () => Promise<GuildOfficerRow[]>;
  ttlMs?: number;
  /** Injected clock for tests; production omits it (Date.now). */
  now?: () => number;
}

/** Build a presence layer over one officer-roster read (the production
 *  instance below reads Postgres; tests inject a fake). */
export function createGuildBoardPresence(deps: GuildBoardPresenceDeps): GuildBoardPresence {
  const roster: CachedRead<GuildOfficerRoster> = createCachedRead(
    async () => rosterByGuild(await deps.readOfficers()),
    { ttlMs: deps.ttlMs ?? GUILD_BOARD_PRESENCE_TTL_MS, now: deps.now },
  );
  return {
    async attach(leaders, isOnline) {
      if (leaders.length === 0) return [];
      let byGuild: GuildOfficerRoster;
      try {
        byGuild = await roster.read();
      } catch (err) {
        console.error('guild board presence read failed:', err);
        return [...leaders];
      }
      return attachOfficerPresence(leaders, byGuild, isOnline);
    },
    bust() {
      roster.bust();
    },
  };
}

/** The production instance every dispatch arm shares. */
export const guildBoardPresence: GuildBoardPresence = createGuildBoardPresence({
  readOfficers: topGuildOfficers,
});
