// Pure, host-agnostic view model for the DEVELOPERS tab of the high-score window.
//
// The pure-core half of the pure-core + thin-painter split (sibling of
// leaderboard_view.ts and guild_leaderboard_view.ts). Like those cores this is
// ASYNC-FREE and DOM/i18n-free: it maps an already-resolved DevLeaderboardPage (or
// an explicit loading / error discriminator) to a render model the painter
// localizes. The async/paged shape is the online-only-shape trap, so the core is
// fed BOTH a Sim-shaped (empty) and a ClientWorld-mirror-shaped page in the tests.
//
// The board is sourced from GitHub's merged-pull-request stats, the same for
// every realm, so there is no "your standing" sticky row; instead the viewer's
// own row is flagged `me` (matched by GitHub login) so the painter can
// highlight it.

import type { DevLeaderboardPage } from '../world_api';
import type { LeaderboardPager } from './leaderboard_view';

/** One ranked contributor row: rank + merged-PR standing + earned tier. */
export interface DevLeaderboardRow {
  rank: number;
  login: string;
  mergedPrs: number;
  devTier: number;
  /** True for the viewer's own contributor row (matched by linked GitHub login). */
  me: boolean;
}

/** The developers-tab view-model: the async-state discriminators or a page. */
export type DevLeaderboardView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | {
      kind: 'ranked';
      rows: DevLeaderboardRow[];
      pager: LeaderboardPager | null;
      /** The server clamps the requested page; the painter mirrors this back. */
      page: number;
    };

/** The painter feeds the builder the in-flight loading discriminator, the
 *  rejection/offline error discriminator, or an already-resolved page (plus the
 *  viewer's linked GitHub login, when known, to flag their own row). */
export type DevLeaderboardInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'page'; page: DevLeaderboardPage; viewerLogin?: string | null };

/**
 * Build the developers-tab view-model. `loading` / `error` map straight through.
 * A resolved page with no contributors is `empty` (the offline Sim always lands
 * here, as does an online server with the GitHub feature unconfigured); otherwise
 * it is `ranked`. Reads only IWorld-mirrored data (the resolved page), so the
 * offline Sim and the online ClientWorld mirror produce identical output.
 */
export function buildDevLeaderboardView(input: DevLeaderboardInput): DevLeaderboardView {
  if (input.kind === 'loading') return { kind: 'loading' };
  if (input.kind === 'error') return { kind: 'error' };
  const { page } = input;
  const entries = page.leaders;
  if (entries.length === 0) return { kind: 'empty' };
  const viewer = input.viewerLogin ? input.viewerLogin.toLowerCase() : '';
  const rows: DevLeaderboardRow[] = entries.map((e) => ({
    rank: e.rank,
    login: e.login,
    mergedPrs: e.mergedPrs,
    devTier: e.devTier,
    me: viewer !== '' && e.login.toLowerCase() === viewer,
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
