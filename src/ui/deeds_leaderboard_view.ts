// Pure, host-agnostic view model for the RENOWN tab of the high-score window.
//
// The pure-core half of the pure-core + thin-painter split (sibling of
// leaderboard_view.ts / guild_leaderboard_view.ts / dev_leaderboard_view.ts).
// Like those cores this is ASYNC-FREE and DOM/i18n-free: it maps an
// already-resolved DeedsLeaderboardPage (or an explicit loading / error
// discriminator) to a render model the painter localizes. Rows carry the raw
// class id plus a `knownClass` flag (CLASSES is read here only to decide that
// flag) and the selected TITLE stays a deed id: the painter resolves it
// through deed_i18n.ts, never this core.
//
// The board is account-scored but character-faced (each row is the account's
// highest-Renown character), so the viewer's own row is flagged `me` by the
// server-resolved account rank on the page's `self` line (rank is a strict
// total order, so equality identifies the row exactly). Names are not
// identity here: the viewer may be on a lower alt, and the board is global
// across realms, so a same-named cross-realm character must not match. The
// same `self` line doubles as the account's own standing instead of a
// computed sticky row: the client cannot derive an account-level rank from
// what it can see.

import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import type { DeedsLeaderboardPage } from '../world_api';
import type { LeaderboardPager } from './leaderboard_view';

/** One ranked account row, faced by its display character. Renown is the one
 *  ranked number on the row (the ranked-surface rule, docs/design/deeds.md:
 *  no deed count rides this board; the completion count lives in the Book
 *  of Deeds header). */
export interface DeedsLeaderboardRow {
  rank: number;
  name: string;
  realm: string;
  cls: PlayerClass;
  /** CLASSES has this id, so the painter resolves a localized class name. */
  knownClass: boolean;
  level: number;
  renown: number;
  /** The display character's selected title as a DEED ID (null untitled);
   *  the painter localizes through deed_i18n.ts. */
  title: string | null;
  /** True for the viewer's own account row (matched by the server-resolved
   *  account rank, `page.self.rank`, never by character name). */
  me: boolean;
}

/** The viewer's own board standing, as the server resolved it (authenticated
 *  and ranked callers only). The CORE decides which arm applies, so the
 *  choice is behaviorally testable: 'account' carries the board-scored
 *  Renown (a current server), 'rank' is the fallback when an OLDER server
 *  (rolling deploy, self-hosted) omits it. The painter only maps each kind
 *  to its t() key. */
export type DeedsLeaderboardSelfLine =
  | { kind: 'account'; rank: number; topPercent: number; renown: number }
  | { kind: 'rank'; rank: number; topPercent: number };

/** The Renown-tab view-model: the async-state discriminators or a page. */
export type DeedsLeaderboardView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty' }
  | {
      kind: 'ranked';
      rows: DeedsLeaderboardRow[];
      /** The viewer's server-resolved standing, or null (anonymous, unranked,
       *  or offline). */
      self: DeedsLeaderboardSelfLine | null;
      pager: LeaderboardPager | null;
      /** The server clamps the requested page; the painter mirrors this back. */
      page: number;
    };

/** The painter feeds the builder the in-flight loading discriminator, the
 *  rejection/offline error discriminator, or an already-resolved page (the
 *  page's server-resolved `self` rank flags the viewer's own row). */
export type DeedsLeaderboardInput =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'page'; page: DeedsLeaderboardPage };

/**
 * Build the Renown-tab view-model. `loading` / `error` map straight through.
 * A resolved page with no entries is `empty` (the offline Sim always lands
 * here: a sandbox has no account population); otherwise `ranked`. Reads only
 * IWorld-mirrored data (the resolved page), so the offline Sim and the online
 * ClientWorld mirror produce identical output.
 */
export function buildDeedsLeaderboardView(input: DeedsLeaderboardInput): DeedsLeaderboardView {
  if (input.kind === 'loading') return { kind: 'loading' };
  if (input.kind === 'error') return { kind: 'error' };
  const { page } = input;
  const entries = page.leaders;
  if (entries.length === 0) return { kind: 'empty' };
  const selfRank = page.self?.rank ?? null;
  const rows: DeedsLeaderboardRow[] = entries.map((e) => ({
    rank: e.rank,
    name: e.name,
    realm: e.realm,
    cls: e.cls,
    knownClass: Boolean(CLASSES[e.cls]),
    level: e.level,
    renown: e.renown,
    title: e.title,
    me: selfRank !== null && e.rank === selfRank,
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
  const self: DeedsLeaderboardSelfLine | null = page.self
    ? page.self.renown !== undefined
      ? {
          kind: 'account',
          rank: page.self.rank,
          topPercent: page.self.topPercent,
          renown: page.self.renown,
        }
      : { kind: 'rank', rank: page.self.rank, topPercent: page.self.topPercent }
    : null;
  return { kind: 'ranked', rows, self, pager, page: page.page };
}
