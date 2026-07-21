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

import type { GuildLeaderboardPage } from '../world_api';
import type { LeaderboardPager } from './leaderboard_view';

/** One ranked guild row: rank + the guild's summed-XP standing. */
export interface GuildLeaderboardRow {
  rank: number;
  name: string;
  memberCount: number;
  totalLifetimeXp: number;
  topLevel: number;
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
 *  rejection/offline error discriminator, or an already-resolved page. */
export type GuildLeaderboardInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'page'; page: GuildLeaderboardPage };

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
  const rows: GuildLeaderboardRow[] = entries.map((e) => ({
    rank: e.rank,
    name: e.name,
    memberCount: e.memberCount,
    totalLifetimeXp: e.totalLifetimeXp,
    topLevel: e.topLevel,
  }));
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
