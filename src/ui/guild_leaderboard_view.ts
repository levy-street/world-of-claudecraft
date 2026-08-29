// Pure, host-agnostic view model for the GUILD tab of the high-score window.
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

import { guildTierForLifetimeXp } from '../sim/guild_tier';
import type { GuildLeaderboardPage } from '../world_api';
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

/** The guild-tab view-model: the async-state discriminators or a page. */
export type GuildLeaderboardView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | {
      kind: 'ranked';
      rows: GuildLeaderboardRow[];
      pager: LeaderboardPager | null;
      /** The server clamps the requested page; the painter mirrors this back. */
      page: number;
    };

/** The painter feeds the builder the in-flight loading discriminator, the
 *  rejection/offline error discriminator, or an already-resolved page plus the
 *  viewer facts the pledge cells depend on (null viewer when offline). */
export type GuildLeaderboardInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'page'; page: GuildLeaderboardPage; viewer: GuildBoardViewer | null };

/**
 * Build the guild-tab view-model. `loading` / `error` map straight through. A
 * resolved page with no guilds is `empty` (the offline Sim always lands here, as
 * does an online realm with no guilds yet); otherwise it is `ranked`. Reads only
 * IWorld-mirrored data (the resolved page), so the offline Sim and the online
 * ClientWorld mirror produce identical output.
 */
export function buildGuildLeaderboardView(input: GuildLeaderboardInput): GuildLeaderboardView {
  if (input.kind === 'loading') return { kind: 'loading' };
  if (input.kind === 'error') return { kind: 'error' };
  const { page } = input;
  const entries = page.leaders;
  if (entries.length === 0) return { kind: 'empty' };
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
  return { kind: 'ranked', rows, pager, page: page.page };
}
