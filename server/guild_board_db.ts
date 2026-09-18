// The signpost guild board's SQL reads (docs/prd/guild-pledge-board.md),
// extracted from db.ts behind the same pool + timeout seams guild_roster.ts
// uses:
//  - topGuilds: the ranked board (guilds by the SUM of every member's
//    lifetimeXp) with each guild's recruiting settings and category opt-ins;
//  - topGuildOfficers: the realm's officer-plus roster, which the board's
//    presence layer (guild_board_presence.ts) intersects with LIVE sessions at
//    serve time to light the "officers online" dot.
// Both are viewer-identical aggregates, so they are read through the server-side
// caches (main.ts guildLeaderboardCache, the presence module's cached read),
// never per request under load.

import { LEADERBOARD_MAX } from '../src/sim/leaderboard_page';
import { DB_HEAVY_STATEMENT_TIMEOUT_MS, ELIGIBLE_ACCOUNT_SQL, runWithStatementTimeout } from './db';
import { REALM } from './realm';

export interface GuildLeaderRow {
  name: string;
  realm: string;
  memberCount: number;
  totalLifetimeXp: number;
  topLevel: number;
  // Guild pledge board recruiting status (docs/prd/guild-pledge-board.md),
  // shown per row on the high-score board so aspirants know who is looking.
  pledgesEnabled: boolean;
  pledgeMinLevel: number;
  pledgeNote: string;
  // Guild board categories (src/sim/guild_board_category.ts): the guild's
  // new-player-friendly opt-in, the Proving Shore signpost's default view.
  newPlayerFriendly: boolean;
}

// ---------------------------------------------------------------------------
// Guild high-score board: ranks guilds by the SUM of every member's lifetimeXp.
// Aggregate JOIN of guilds -> guild_members -> characters (all in this pool); an
// INNER JOIN drops guilds with no seated members. Realm-scoped (the in-game
// panel) or global (cross-realm), mirroring topLifetimeXp. Read through the
// server-side cache in main.ts, never run per request under load.
// ---------------------------------------------------------------------------

export async function topGuilds(
  limit = 100,
  opts: { global?: boolean } = {},
): Promise<GuildLeaderRow[]> {
  // Capped at LEADERBOARD_MAX (1000) like the player board, so a realm with many
  // guilds is fully ranked through the cached window.
  const cap = Math.max(1, Math.min(LEADERBOARD_MAX, limit));
  const selectAgg = `g.name, g.realm, g.pledges_enabled, g.pledge_min_level, g.pledge_note,
                g.new_player_friendly,
                COUNT(gm.character_id)                                AS member_count,
                COALESCE(SUM(COALESCE((c.state->>'lifetimeXp')::bigint, 0)), 0) AS total_lifetime_xp,
                COALESCE(MAX(COALESCE((c.state->>'level')::int, 0)), 0)         AS top_level`;
  // The eligibility predicate applies to the MEMBER characters inside the SUM:
  // a banned or suspended member's XP stops inflating the guild score (and its
  // seat leaves member_count) without delisting the whole guild. A guild whose
  // every member is ineligible drops off the board like any empty guild.
  const fromJoin = `FROM guilds g
           JOIN guild_members gm ON gm.guild_id = g.id
           JOIN characters c ON c.id = gm.character_id
            AND EXISTS (SELECT 1 FROM accounts a
                         WHERE a.id = c.account_id AND ${ELIGIBLE_ACCOUNT_SQL})`;
  const groupOrder = `GROUP BY g.id, g.name, g.realm
          ORDER BY total_lifetime_xp DESC, member_count DESC, g.name ASC`;
  const res = await runWithStatementTimeout(DB_HEAVY_STATEMENT_TIMEOUT_MS, (query) =>
    opts.global
      ? query(
          `SELECT ${selectAgg}
           ${fromJoin}
          WHERE c.state IS NOT NULL
          ${groupOrder}
          LIMIT $1`,
          [cap],
        )
      : query(
          `SELECT ${selectAgg}
           ${fromJoin}
          WHERE g.realm = $1 AND c.state IS NOT NULL
          ${groupOrder}
          LIMIT $2`,
          [REALM, cap],
        ),
  );
  return res.rows.map((r) => ({
    name: r.name,
    realm: r.realm,
    memberCount: Number(r.member_count),
    totalLifetimeXp: Number(r.total_lifetime_xp),
    topLevel: Number(r.top_level),
    pledgesEnabled: !!r.pledges_enabled,
    pledgeMinLevel: Number(r.pledge_min_level) || 1,
    pledgeNote: typeof r.pledge_note === 'string' ? r.pledge_note : '',
    newPlayerFriendly: !!r.new_player_friendly,
  }));
}

// ---------------------------------------------------------------------------
// Officer roster: every Guild Master and officer on THIS realm, the input to
// the board's live "officers online" presence (guild_board_presence.ts). Realm
// scoped only: presence intersects with this process's sessions, which know
// nothing of other realms. The same eligibility screen as topGuilds, so a
// banned officer never lights a guild's dot even through a stale roster
// (a moderated account holds no session either way).
// ---------------------------------------------------------------------------

export interface GuildOfficerRow {
  /** The guild's display name, VERBATIM (g.name): the board row's key. Exact,
   *  never case-folded: guilds(realm, name) is the unique key, and two names
   *  differing only by case are two guilds. */
  guildName: string;
  characterId: number;
  name: string;
  rank: 'leader' | 'officer';
}

/** Row bound on the cached officer roster: the board shows at most
 *  LEADERBOARD_MAX guilds and nothing caps how many members a guild may
 *  promote, so the ceiling is an explicit multiple rather than a per-guild
 *  cap (the guild_roster.ts ROSTER_MEMBER_LIMIT reasoning: a tampered row
 *  can never balloon the cached payload). Ordered by guild name, so a realm
 *  somehow past the bound loses presence on its last guilds alphabetically,
 *  never a whole board. */
export const GUILD_BOARD_OFFICER_ROWS_MAX = LEADERBOARD_MAX * 4;

/** The roster read is a small realm scan refreshed once per presence TTL and
 *  serialized AFTER the board read on a cold request, so it takes a tight
 *  bound of its own rather than the 60s heavy-aggregate allowance; a slow
 *  read degrades to a presence-free page (guild_board_presence.ts), never a
 *  held request. */
export const GUILD_BOARD_OFFICER_ROSTER_TIMEOUT_MS = 10_000;

export async function topGuildOfficers(): Promise<GuildOfficerRow[]> {
  const res = await runWithStatementTimeout(GUILD_BOARD_OFFICER_ROSTER_TIMEOUT_MS, (query) =>
    query(
      `SELECT g.name AS guild_name, gm.character_id, c.name, gm.rank
         FROM guilds g
         JOIN guild_members gm ON gm.guild_id = g.id
         JOIN characters c ON c.id = gm.character_id
          AND EXISTS (SELECT 1 FROM accounts a
                       WHERE a.id = c.account_id AND ${ELIGIBLE_ACCOUNT_SQL})
        WHERE g.realm = $1 AND gm.rank IN ('leader', 'officer') AND c.state IS NOT NULL
        ORDER BY g.name ASC, CASE gm.rank WHEN 'leader' THEN 0 ELSE 1 END, c.name ASC
        LIMIT $2`,
      [REALM, GUILD_BOARD_OFFICER_ROWS_MAX],
    ),
  );
  return res.rows.map((r) => ({
    guildName: String(r.guild_name),
    characterId: Number(r.character_id),
    name: String(r.name),
    rank: r.rank === 'leader' ? 'leader' : 'officer',
  }));
}
