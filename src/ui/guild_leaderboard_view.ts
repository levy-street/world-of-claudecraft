// Pure, host-agnostic view model for the signpost guild board (and the
// leaderboard window's plain guild ranking).
//
// The pure-core half of the pure-core + thin-painter split (sibling of
// leaderboard_view.ts, which models the player tab). Like that core this is
// ASYNC-FREE and DOM/i18n-free: it maps an already-resolved GuildLeaderboardPage
// (or an explicit loading / error discriminator) to a render model the painter
// localizes. The async/paged shape is the online-only-shape trap, so the core is
// fed BOTH a Sim-shaped (empty) and a ClientWorld-mirror-shaped page in the tests.
//
// Guilds are server-only, so there is no "your standing" sticky row here (unlike
// the player tab): the offline Sim ranks no guilds and resolves the empty state.
//
// Guild board categories (src/sim/guild_board_category.ts): the board can be
// narrowed to guilds wearing an opt-in tag. The SERVER filters (before paging,
// so pages stay full); this core only carries the active category through so
// the painter can render the filtered empty state and the tick box, and it
// decides which category a signpost opens on (defaultGuildBoardCategory).

import { PROVING_SHORE_NOTICEBOARD_ID } from '../sim/content/noticeboards';
import type { GuildBoardCategory } from '../sim/guild_board_category';
import { guildTierForLifetimeXp } from '../sim/guild_tier';
import type { GuildBoardOfficer, GuildLeaderboardPage } from '../world_api';
import type { LeaderboardPager } from './leaderboard_view';

/** The pledge affordance a board row shows the viewer
 *  (docs/prd/guild-pledge-board.md):
 *  - 'none': no affordance at all (a pre-pledge-board server, or the viewer is
 *    a member of some OTHER guild: members do not pledge);
 *  - 'yours': the viewer's own guild's row;
 *  - 'pledged': the viewer's standing pledge is with this guild;
 *  - 'closed': the guild is not accepting pledges;
 *  - 'belowLevel': accepting, but the viewer is under the guild's level floor;
 *  - 'pledge': the actionable Pledge button. */
export type GuildPledgeCell = 'none' | 'yours' | 'pledged' | 'closed' | 'belowLevel' | 'pledge';

/** The viewer facts the pledge cell depends on; null when offline. */
export interface GuildBoardViewer {
  /** The viewer's own guild name, null when unguilded. */
  guildName: string | null;
  level: number;
  /** The guild the viewer's standing pledge names, null when none. */
  pledgedTo: string | null;
}

/** One ranked guild row: rank + the guild's summed-XP standing, plus the
 *  pledge-board recruiting status the row displays. */
export interface GuildLeaderboardRow {
  rank: number;
  name: string;
  memberCount: number;
  totalLifetimeXp: number;
  topLevel: number;
  /** The guild colour tier (guildTierForLifetimeXp of the summed XP): the same
   *  ladder the overhead nameplate's guild line colours by. */
  tier: number;
  /** Recruiting status: null when the server predates the pledge board (the
   *  whole pledge column hides then), else open/closed + the level floor. */
  open: boolean | null;
  minLevel: number;
  /** The Guild Master's recruiting note ('' when unset). Player-controlled
   *  text: the painter must escape it. */
  note: string;
  pledge: GuildPledgeCell;
  /** The guild opted into the new-player-friendly listing (the row's chip;
   *  false on a pre-category server). */
  newPlayerFriendly: boolean;
  /** The Guild Master and officers the server saw online when it served the
   *  row, in roster order (the Guild Master first); empty when none, and
   *  always empty on a pre-presence server. Player names: the painter must
   *  escape them. Drives the row's presence dot and its tooltip. */
  onlineOfficers: readonly GuildBoardOfficer[];
}

/**
 * Resolve the pledge affordance for one row. Order matters: the viewer's own
 * guild row always reads 'yours' (even with pledging closed), any OTHER
 * membership kills the affordance entirely, a standing pledge shows as
 * 'pledged' even if the guild has since closed (the pledge still stands;
 * withdrawing lives in the social window), and only then do the guild's own
 * gates (closed, level floor) apply.
 */
export function guildPledgeCell(
  row: { name: string; open: boolean | null; minLevel: number },
  viewer: GuildBoardViewer | null,
): GuildPledgeCell {
  if (row.open === null || viewer === null) return 'none';
  if (viewer.guildName === row.name) return 'yours';
  if (viewer.guildName) return 'none';
  if (viewer.pledgedTo === row.name) return 'pledged';
  if (!row.open) return 'closed';
  if (viewer.level < row.minLevel) return 'belowLevel';
  return 'pledge';
}

/**
 * The category a signpost opens the board on. The Proving Shore's board is
 * the recruits' signpost (docs/prd/guild-pledge-board.md, "New player
 * friendly"): it opens on the guilds that opted in, so a player deciding who
 * to travel with sees the guilds that want them first. Every other board, and
 * an opener that names no board (the E2E rigs), opens the whole ranking.
 */
export function defaultGuildBoardCategory(boardId: string | undefined): GuildBoardCategory | null {
  return boardId === PROVING_SHORE_NOTICEBOARD_ID ? 'newPlayerFriendly' : null;
}

/** Re-validate the served officer list at the trust boundary: a malformed
 *  row is DROPPED (never rendered with an undefined name, never relabeled:
 *  a rank outside the two officer-plus ranks is not an officer and must not
 *  read as one), the server's order kept (the Guild Master first). */
export function onlineOfficerRows(raw: unknown): GuildBoardOfficer[] {
  if (!Array.isArray(raw)) return [];
  const rows: GuildBoardOfficer[] = [];
  for (const item of raw as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as { name?: unknown }).name;
    const rank = (item as { rank?: unknown }).rank;
    if (typeof name !== 'string' || name === '') continue;
    if (rank !== 'leader' && rank !== 'officer') continue;
    rows.push({ name, rank });
  }
  return rows;
}

/** The guild-tab view-model: the async-state discriminators or a page. The
 *  `category` on the empty and ranked states is the filter the page was read
 *  under (null: the whole board), so the painter can tell "no guilds at all"
 *  from "no guild wears this tag" and offer the way back. */
export type GuildLeaderboardView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty'; category: GuildBoardCategory | null }
  | {
      kind: 'ranked';
      rows: GuildLeaderboardRow[];
      pager: LeaderboardPager | null;
      /** The server clamps the requested page; the painter mirrors this back. */
      page: number;
      category: GuildBoardCategory | null;
    };

/** The painter feeds the builder the in-flight loading discriminator, the
 *  rejection/offline error discriminator, or an already-resolved page plus the
 *  viewer facts the pledge cells depend on (null viewer when offline) and the
 *  category the page was requested under (absent: the whole board). */
export type GuildLeaderboardInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | {
      kind: 'page';
      page: GuildLeaderboardPage;
      viewer: GuildBoardViewer | null;
      category?: GuildBoardCategory | null;
    };

/**
 * Build the guild-tab view-model. `loading` / `error` map straight through. A
 * resolved page with no guilds is `empty` (the offline Sim always lands here, as
 * does an online realm with no guilds yet, and a category no guild wears);
 * otherwise it is `ranked`. Reads only IWorld-mirrored data (the resolved
 * page), so the offline Sim and the online ClientWorld mirror produce identical
 * output.
 */
export function buildGuildLeaderboardView(input: GuildLeaderboardInput): GuildLeaderboardView {
  if (input.kind === 'loading') return { kind: 'loading' };
  if (input.kind === 'error') return { kind: 'error' };
  const { page } = input;
  const category = input.category ?? null;
  const entries = page.leaders;
  if (entries.length === 0) return { kind: 'empty', category };
  const rows: GuildLeaderboardRow[] = entries.map((e) => {
    // pledgesOpen absent = a pre-pledge-board server: the whole pledge column
    // hides (open null -> cell 'none'), never a guessed default.
    const open = e.pledgesOpen === undefined ? null : e.pledgesOpen;
    const minLevel = e.pledgeMinLevel ?? 1;
    return {
      rank: e.rank,
      name: e.name,
      memberCount: e.memberCount,
      totalLifetimeXp: e.totalLifetimeXp,
      topLevel: e.topLevel,
      tier: guildTierForLifetimeXp(e.totalLifetimeXp),
      open,
      minLevel,
      note: e.pledgeNote ?? '',
      pledge: guildPledgeCell({ name: e.name, open, minLevel }, input.viewer),
      newPlayerFriendly: e.newPlayerFriendly === true,
      onlineOfficers: onlineOfficerRows(e.onlineOfficers),
    };
  });
  const pager: LeaderboardPager | null =
    page.pageCount <= 1
      ? null
      : {
          page: page.page,
          pageCount: page.pageCount,
          prevDisabled: page.page <= 0,
          nextDisabled: page.page >= page.pageCount - 1,
        };
  return { kind: 'ranked', rows, pager, page: page.page, category };
}
