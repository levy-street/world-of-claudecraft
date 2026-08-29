// The public guild roster read behind the signpost guild board's drill-in
// (docs/prd/guild-pledge-board.md follow-up): a guild's Guild Master, then
// officers, then members, each rank tier ranked by lifetime XP. Anonymous
// and viewer-identical, so the read is cache-fronted here (TTL +
// single-flight per guild, a bounded cache: the realm's guild count bounds
// legitimate keys and misses are never cached, so name-probing cannot grow
// it). Self-contained on the shared pool: no main.ts runtime injection is
// needed (the deeds-runtime cycle only existed because that cache already
// lived in main.ts).

import type { GuildRosterInfo } from '../src/world_api/progression_xp';
import { DB_HEAVY_STATEMENT_TIMEOUT_MS, ELIGIBLE_ACCOUNT_SQL, runWithStatementTimeout } from './db';
import { singleFlight } from './deeds_board_warm';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';
import { REALM } from './realm';

/** Same cadence as the leaderboard windows: the roster moves slowly and the
 *  drill-in is player-initiated. */
export const GUILD_ROSTER_TTL_MS = 30_000;

/** Cache-entry cap, far above any realm's real guild count; when probing
 *  somehow reaches it the whole cache resets rather than growing. */
const ROSTER_CACHE_MAX = 512;

/** Row bound on the anonymous, cached read: far above the server's guild
 *  size in practice, and an explicit ceiling so a pathological roster can
 *  never balloon the cached payload. */
const ROSTER_MEMBER_LIMIT = 500;

/** The uncached read. The eligibility screen matches topGuilds (server/db.ts):
 *  a banned or suspended member drops off the roster without delisting the
 *  guild. Ranks order leader, officer, member; inside a rank tier lifetime XP
 *  decides, name breaks ties. */
export async function readGuildRoster(guildName: string): Promise<GuildRosterInfo | null> {
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    query(
      `SELECT g.name AS guild_name, c.name,
              gm.rank, c.class AS cls,
              COALESCE((c.state->>'level')::int, 0)          AS level,
              COALESCE((c.state->>'lifetimeXp')::bigint, 0)  AS lifetime_xp
         FROM guilds g
         JOIN guild_members gm ON gm.guild_id = g.id
         JOIN characters c ON c.id = gm.character_id
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = c.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
        WHERE g.realm = $1 AND lower(g.name) = lower($2) AND c.state IS NOT NULL
        ORDER BY CASE gm.rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
                 lifetime_xp DESC, c.name ASC
        LIMIT ${ROSTER_MEMBER_LIMIT}`,
      [REALM, guildName],
    ),
  );
  if (res.rows.length === 0) return null;
  return {
    guild: String(res.rows[0].guild_name),
    members: res.rows.map((r) => ({
      name: String(r.name),
      rank: r.rank === 'leader' || r.rank === 'officer' ? r.rank : 'member',
      class: String(r.cls ?? ''),
      level: Number(r.level),
      lifetimeXp: Number(r.lifetime_xp),
    })),
  };
}

interface CacheEntry {
  at: number;
  info: GuildRosterInfo;
}

const rosterCache = new Map<string, CacheEntry>();
const rosterInFlight = new Map<string, () => Promise<GuildRosterInfo | null>>();

/** Test seam: drop every cached roster and in-flight read. */
export function resetGuildRosterCacheForTests(): void {
  rosterCache.clear();
  rosterInFlight.clear();
}

/** The cache-fronted read the route serves. Only EXISTING guilds are cached
 *  (a null result is answered but never stored), so unknown-name probing
 *  cannot grow the map; the size cap is a reset backstop, not a policy. */
export async function guildRosterCached(guildName: string): Promise<GuildRosterInfo | null> {
  const key = guildName.toLowerCase();
  const cached = rosterCache.get(key);
  if (cached && Date.now() - cached.at < GUILD_ROSTER_TTL_MS) return cached.info;
  let flight = rosterInFlight.get(key);
  if (!flight) {
    flight = singleFlight(async () => {
      try {
        const info = await readGuildRoster(guildName);
        if (info) {
          if (rosterCache.size >= ROSTER_CACHE_MAX) rosterCache.clear();
          rosterCache.set(key, { at: Date.now(), info });
        }
        return info;
      } finally {
        rosterInFlight.delete(key);
      }
    });
    rosterInFlight.set(key, flight);
  }
  try {
    return await flight();
  } catch (err) {
    console.error('guild roster read failed:', err);
    return cached?.info ?? null;
  }
}

/**
 * GET /api/guilds/roster?name=<guild>: the public roster drill-in. Anonymous
 * public read on the shared per-IP budget; an unknown or empty name answers
 * the 404 envelope so the client renders its own localized empty state.
 */
async function rosterHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  const raw = ctx.query.name;
  const name = String(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')).trim();
  if (name === '' || name.length > 64) {
    json(ctx.res, 400, { error: 'invalid input', code: 'guilds.invalid_roster_name' });
    return;
  }
  const info = await guildRosterCached(name);
  if (info === null) {
    json(ctx.res, 404, { error: 'unknown guild', code: 'guilds.unknown' });
    return;
  }
  json(ctx.res, 200, info);
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/guilds/roster',
    surface: 'api',
    handler: rosterHandler,
  },
];
