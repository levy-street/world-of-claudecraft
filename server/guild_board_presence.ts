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
 * entries are never mutated: they are SHARED across every request for a
 * whole cache window (main.ts installs them raw, not frozen), so a row
 * decorated in place would poison the board for every viewer.
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
  /** Decorate a served page with live officer presence. Never rejects and
   *  never holds the board: a cold roster read that fails, or one still in
   *  flight past the deadline, serves the page without presence (logged), so
   *  the board itself is never held hostage to the roster query. */
  attach(
    leaders: readonly GuildLeaderboardEntry[],
    isOnline: (characterId: number) => boolean,
  ): Promise<GuildLeaderboardEntry[]>;
  /** Refresh the roster OFF the request path (the main.ts warm loop, on the
   *  board caches' cadence) while the board is being viewed, so a viewer
   *  never pays the read inline once the board is warm. Never rejects: a
   *  failure is logged and the next request degrades to a presence-free
   *  page like any other. */
  warm(): Promise<void>;
  /** Drop the cached roster (the moderation bust hook). */
  bust(): void;
}

/** How long a request waits on a roster read still in flight before serving
 *  the page bare. Presence is best-effort decoration, so it may never add a
 *  DB round trip's latency to a public board read: a cold read past this
 *  bound keeps running (single-flight) and installs for the next caller. */
export const GUILD_BOARD_PRESENCE_DEADLINE_MS = 250;

/** After a cold roster read FAILS, how long requests skip the roster before
 *  trying again. Single-flight bounds concurrency to one read, not the rate:
 *  without this window every request on a down database would start (and
 *  log) a fresh attempt the moment the last one settled. */
export const GUILD_BOARD_PRESENCE_RETRY_MS = 5_000;

/** The warm loop keeps the roster fresh only while a board was served
 *  within this window (the Renown board's demand gate, deeds_board_warm.ts):
 *  an idle realm pays nothing; the first viewer after an idle stretch pays
 *  at most the deadline above and gets presence from the next page on. */
export const GUILD_BOARD_PRESENCE_DEMAND_TTL_MS = 10 * 60_000;

export interface GuildBoardPresenceDeps {
  readOfficers: () => Promise<GuildOfficerRow[]>;
  ttlMs?: number;
  deadlineMs?: number;
  retryMs?: number;
  demandTtlMs?: number;
  /** Injected clock for tests; production omits it (Date.now). */
  now?: () => number;
}

/** Build a presence layer over one officer-roster read (the production
 *  instance below reads Postgres; tests inject a fake). */
export function createGuildBoardPresence(deps: GuildBoardPresenceDeps): GuildBoardPresence {
  const now = deps.now ?? Date.now;
  const deadlineMs = deps.deadlineMs ?? GUILD_BOARD_PRESENCE_DEADLINE_MS;
  const retryMs = deps.retryMs ?? GUILD_BOARD_PRESENCE_RETRY_MS;
  const demandTtlMs = deps.demandTtlMs ?? GUILD_BOARD_PRESENCE_DEMAND_TTL_MS;
  const roster: CachedRead<GuildOfficerRoster> = createCachedRead(
    async () => rosterByGuild(await deps.readOfficers()),
    { ttlMs: deps.ttlMs ?? GUILD_BOARD_PRESENCE_TTL_MS, now: deps.now },
  );
  // The clock reading before which requests skip the roster (set by a failed
  // cold read, cleared by a success or a bust); 0 means "try".
  let retryAt = 0;
  // When a page was last served (the warm loop's demand gate); null = never
  // (never 0: an injected test clock legitimately starts there).
  let lastDemandAt: number | null = null;

  // The roster, or null when the read failed. A failure after at least one
  // success never lands here: createCachedRead stale-serves it.
  const readRoster = (): Promise<GuildOfficerRoster | null> =>
    roster.read().then(
      (value) => {
        retryAt = 0;
        return value;
      },
      (err: unknown) => {
        retryAt = now() + retryMs;
        console.error('guild board presence read failed:', err);
        return null;
      },
    );

  // The read, or null once the deadline passes first; the read itself keeps
  // running and installs its result for the next caller.
  const withinDeadline = (
    read: Promise<GuildOfficerRoster | null>,
  ): Promise<GuildOfficerRoster | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
      timer.unref?.();
    });
    return Promise.race([read, deadline]).finally(() => clearTimeout(timer));
  };

  return {
    async attach(leaders, isOnline) {
      if (leaders.length === 0) return [];
      lastDemandAt = now();
      if (now() < retryAt) return [...leaders];
      const byGuild = await withinDeadline(readRoster());
      if (byGuild === null) return [...leaders];
      return attachOfficerPresence(leaders, byGuild, isOnline);
    },
    async warm() {
      // Demand-gated: no page served within the window means no refresh.
      if (lastDemandAt === null || now() - lastDemandAt >= demandTtlMs) return;
      // A FORCED refresh, never read(): the warm loop runs on the same cadence
      // as the TTL, so read() would find the roster still fresh on every other
      // tick and leave it to expire mid-interval for a viewer to pay inline.
      try {
        await roster.refresh();
        retryAt = 0;
      } catch (err) {
        retryAt = now() + retryMs;
        console.error('guild board presence read failed:', err);
      }
    },
    bust() {
      roster.bust();
      retryAt = 0;
    },
  };
}

/** The production instance every dispatch arm shares. */
export const guildBoardPresence: GuildBoardPresence = createGuildBoardPresence({
  readOfficers: topGuildOfficers,
});
