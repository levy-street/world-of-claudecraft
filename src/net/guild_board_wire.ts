// The signpost guild board's wire helpers for ClientWorld (online.ts), in the
// wire-decode sibling idiom (src/net/CLAUDE.md): DOM-free, ClientWorld-free,
// every field re-validated so a version-skewed frame never lands `undefined`
// in the mirror.
//  - guildBoardPath builds the REST read for one board page, naming the
//    category filter through the shared query key
//    (src/sim/guild_board_category.ts), so the client and the server decode
//    the same literal;
//  - decodeGuildPledgeSettings normalizes the social frame's recruiting
//    settings: an older server's frame (no pledge board, or no categories)
//    still yields a fully-shaped mirror with the feature defaults (accepting,
//    no floor, no note, not listed as new-player friendly).

import {
  GUILD_BOARD_CATEGORY_PARAM,
  type GuildBoardCategory,
  parseGuildBoardCategory,
} from '../sim/guild_board_category';
import type { GuildLeaderboardPage } from '../sim/leaderboard_page';
import type { GuildPledgeSettings } from '../world_api/social_graph';

/** The path + query of GET /api/leaderboard for one guild board page. */
export function guildBoardPath(
  page: number,
  pageSize: number,
  category: GuildBoardCategory | null,
): string {
  const base = `/api/leaderboard?board=guilds&page=${page}&pageSize=${pageSize}`;
  if (category === null) return base;
  return `${base}&${GUILD_BOARD_CATEGORY_PARAM}=${encodeURIComponent(category)}`;
}

/** The empty page a failed or refused board read resolves to (the window's
 *  honest nothing-posted state, never a throw into render). */
export function emptyGuildBoardPage(pageSize: number): GuildLeaderboardPage {
  return { leaders: [], page: 0, pageCount: 1, total: 0, pageSize };
}

/** Decode one served board page. The entries pass through (the view core
 *  re-validates the per-row fields); the applied category is narrowed at the
 *  trust boundary and carried ONLY when the server echoed a known one, so an
 *  older server's unfiltered answer to a filtered request decodes as the
 *  whole board and the window can say so. */
export function decodeGuildBoardPage(
  raw: unknown,
  requestedPage: number,
  pageSize: number,
): GuildLeaderboardPage {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const leaders = Array.isArray(data.leaders)
    ? (data.leaders as GuildLeaderboardPage['leaders'])
    : [];
  const category = parseGuildBoardCategory(data.category);
  return {
    leaders,
    page: typeof data.page === 'number' ? data.page : requestedPage,
    pageCount: typeof data.pageCount === 'number' ? data.pageCount : 1,
    total: typeof data.total === 'number' ? data.total : leaders.length,
    pageSize: typeof data.pageSize === 'number' ? data.pageSize : pageSize,
    ...(category === null ? {} : { category }),
  };
}

/** The feature defaults an absent or partial frame resolves to. */
export const DEFAULT_GUILD_PLEDGE_SETTINGS: Readonly<GuildPledgeSettings> = Object.freeze({
  enabled: true,
  minLevel: 1,
  note: '',
  newPlayerFriendly: false,
});

/** Decode the social frame's `guild.pledgeSettings`; every field falls back to
 *  its default independently, so a frame that carries the three original
 *  fields but not the category flag still decodes whole. */
export function decodeGuildPledgeSettings(raw: unknown): GuildPledgeSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const minLevel = Number(r.minLevel);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_GUILD_PLEDGE_SETTINGS.enabled,
    minLevel:
      Number.isFinite(minLevel) && minLevel >= 1
        ? Math.floor(minLevel)
        : DEFAULT_GUILD_PLEDGE_SETTINGS.minLevel,
    note: typeof r.note === 'string' ? r.note : DEFAULT_GUILD_PLEDGE_SETTINGS.note,
    newPlayerFriendly:
      typeof r.newPlayerFriendly === 'boolean'
        ? r.newPlayerFriendly
        : DEFAULT_GUILD_PLEDGE_SETTINGS.newPlayerFriendly,
  };
}
