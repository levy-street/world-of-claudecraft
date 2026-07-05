// Pure, host-agnostic view model for the lifetime-XP leaderboard window.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; reference arena_window_view.ts / market_view.ts). The leaderboard
// is the ONE async/paged window: the painter (leaderboard_window.ts)
// consumes IWorld.leaderboard(page, size): Promise<LeaderboardPage> and owns the
// Promise, the await, and the page controls. This core is ASYNC-FREE: it maps an
// already-resolved page (or an explicit loading / error discriminator) to a render
// model. The async/paged shape is exactly the online-only-shape trap
// catches (it passes every offline gate and silently misrenders online), so the
// core is fed BOTH a Sim-shaped and a ClientWorld-mirror-shaped page in the tests,
// across every state.
//
// DOM-free and i18n-free: rows carry the raw class id plus a `knownClass` flag the
// painter localizes (CLASSES is read here only to decide that flag), never the
// resolved display name; the loading / empty / error states are discriminators the
// painter resolves to t() copy.

import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import { virtualLevel } from '../sim/types';
import type { LeaderboardPage } from '../world_api';

/** The viewer's identity + lifetime XP, used to me-flag rows and build the
 *  off-page "your standing" row. */
export interface LeaderboardViewer {
  name: string;
  level: number;
  lifetimeXp: number;
}

/** One ranked row: rank + the raw class id (painter localizes when known). */
export interface LeaderboardRow {
  rank: number;
  name: string;
  cls: PlayerClass;
  /** CLASSES has this id, so the painter resolves a localized class name + title. */
  knownClass: boolean;
  level: number;
  virtualLevel: number;
  lifetimeXp: number;
  prestigeRank: number;
  me: boolean;
}

/** The viewer's own standing, shown as a sticky row when they are off the page. */
export interface LeaderboardStanding {
  name: string;
  level: number;
  virtualLevel: number;
  lifetimeXp: number;
}

/** Prev/Next pager state. Null when the whole board fits on one page. */
export interface LeaderboardPager {
  /** Zero-based current page (already clamped by the server). */
  page: number;
  pageCount: number;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

/** The full leaderboard view-model: the async-state discriminators or a page. */
export type LeaderboardView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | {
      kind: 'ranked';
      rows: LeaderboardRow[];
      /** The off-page "your standing" sticky row, or null when the viewer is on
       *  the visible page. */
      standing: LeaderboardStanding | null;
      pager: LeaderboardPager | null;
      /** The server clamps the requested page; the painter mirrors this back so
       *  the pager state never drifts past the real last page. */
      page: number;
    };

/** The painter feeds the builder one of: the in-flight loading discriminator, the
 *  rejection/offline error discriminator, or an already-resolved page + viewer. */
export type LeaderboardInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'page'; page: LeaderboardPage; viewer: LeaderboardViewer };

/**
 * Build the leaderboard view-model. `loading` / `error` map straight through to
 * their discriminators (the painter owns the Promise and passes `error` when
 * `leaderboard()` rejects or is unavailable offline). A resolved page with no
 * leaders is `empty`; otherwise it is `ranked`, with the off-page sticky standing
 * derived when the viewer is not on the visible page. Reads only IWorld-mirrored
 * data (the resolved LeaderboardPage + the viewer), so the offline Sim and the
 * online ClientWorld mirror produce identical output.
 */
export function buildLeaderboardView(input: LeaderboardInput): LeaderboardView {
  if (input.kind === 'loading') return { kind: 'loading' };
  if (input.kind === 'error') return { kind: 'error' };
  const { page, viewer } = input;
  const entries = page.leaders;
  if (entries.length === 0) return { kind: 'empty' };
  const rows: LeaderboardRow[] = entries.map((e) => ({
    rank: e.rank,
    name: e.name,
    cls: e.cls,
    knownClass: Boolean(CLASSES[e.cls]),
    level: e.level,
    virtualLevel: e.virtualLevel,
    lifetimeXp: e.lifetimeXp,
    prestigeRank: e.prestigeRank,
    me: e.name === viewer.name,
  }));
  const onPage = rows.some((r) => r.me);
  const standing: LeaderboardStanding | null = onPage
    ? null
    : {
        name: viewer.name,
        level: viewer.level,
        virtualLevel: virtualLevel(viewer.lifetimeXp),
        lifetimeXp: viewer.lifetimeXp,
      };
  const pager: LeaderboardPager | null =
    page.pageCount <= 1
      ? null
      : {
          page: page.page,
          pageCount: page.pageCount,
          prevDisabled: page.page <= 0,
          nextDisabled: page.page >= page.pageCount - 1,
        };
  return { kind: 'ranked', rows, standing, pager, page: page.page };
}
