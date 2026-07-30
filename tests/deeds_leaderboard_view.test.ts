// Tests for the Renown-tab pure core (deeds_leaderboard_view.ts):
//  - the async state machine: loading / error / empty / ranked discriminators,
//  - row derivation (rank, name, realm, class + knownClass, level, renown,
//    and the TITLE passed through as a DEED ID, never text),
//  - the viewer's own row flagged `me` by the server-resolved account rank,
//  - the server-resolved `self` standing passed through (null when absent;
//    renown rides it from a current server and is absent from an older one),
//  - the pager state and the server page-clamp passthrough,
//  - parity: a Sim-shaped empty page (the offline sandbox has no account
//    population) and same-input determinism.
//
// The core is async-free (the painter owns the Promise); this Node suite
// drives it directly.

import { describe, expect, it } from 'vitest';
import { paginateDeedsLeaderboard } from '../src/sim/leaderboard_page';
import {
  buildDeedsLeaderboardView,
  type DeedsLeaderboardInput,
} from '../src/ui/deeds_leaderboard_view';
import type { DeedsLeaderboardEntry, DeedsLeaderboardPage } from '../src/world_api';

function entry(over: Partial<DeedsLeaderboardEntry> = {}): DeedsLeaderboardEntry {
  return {
    rank: 1,
    name: 'Aldwin',
    realm: 'Claudemoon',
    cls: 'warrior',
    level: 20,
    renown: 425,
    title: 'prog_veteran',
    ...over,
  };
}

function page(over: Partial<DeedsLeaderboardPage> = {}): DeedsLeaderboardPage {
  return { leaders: [entry()], page: 0, pageCount: 1, total: 1, pageSize: 50, ...over };
}

describe('buildDeedsLeaderboardView', () => {
  it('maps the loading discriminator straight through', () => {
    expect(buildDeedsLeaderboardView({ kind: 'loading' })).toEqual({ kind: 'loading' });
  });

  it('maps the error discriminator straight through', () => {
    expect(buildDeedsLeaderboardView({ kind: 'error' })).toEqual({ kind: 'error' });
  });

  it('reports an empty page as empty (the offline Sim always lands here)', () => {
    const view = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({ leaders: [], total: 0 }),
    });
    expect(view.kind).toBe('empty');
  });

  it('derives ranked rows, passing every entry field through with the title as a deed id', () => {
    const input: DeedsLeaderboardInput = {
      kind: 'page',
      page: page({
        leaders: [
          entry({ rank: 1, name: 'Aldwin', renown: 425, title: 'prog_veteran' }),
          entry({ rank: 2, name: 'Berrin', realm: 'Duskhold', renown: 300, title: null }),
        ],
        total: 2,
      }),
    };
    const view = buildDeedsLeaderboardView(input);
    expect(view.kind).toBe('ranked');
    if (view.kind !== 'ranked') return;
    // toEqual is exact: a row carries Renown as its one ranked number and
    // nothing beyond the pinned shape (the ranked-surface rule).
    expect(view.rows).toEqual([
      {
        rank: 1,
        name: 'Aldwin',
        realm: 'Claudemoon',
        cls: 'warrior',
        knownClass: true,
        level: 20,
        renown: 425,
        // Never localized here: the painter resolves through deed_i18n.ts.
        title: 'prog_veteran',
        me: false,
      },
      {
        rank: 2,
        name: 'Berrin',
        realm: 'Duskhold',
        cls: 'warrior',
        knownClass: true,
        level: 20,
        renown: 300,
        title: null,
        me: false,
      },
    ]);
  });

  it('flags an unknown class id so the painter skips the class tooltip', () => {
    const view = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({
        leaders: [entry({ cls: 'gone_class' as DeedsLeaderboardEntry['cls'] })],
      }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.rows[0].knownClass).toBe(false);
  });

  it('flags exactly the row whose rank equals the server-resolved self rank, whatever its name', () => {
    // The board is account-scored and character-faced: the viewer may be
    // logged in on a lower alt whose name never appears on the board, so
    // identity is the account rank the server resolved, not the name.
    const view = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({
        leaders: [entry({ rank: 1, name: 'Aldwin' }), entry({ rank: 2, name: 'Berrin' })],
        total: 2,
        self: { rank: 2, topPercent: 4 },
      }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.rows[0].me).toBe(false);
    expect(view.rows[1].me).toBe(true);
  });

  it('does not flag a same-named row when self is null or points at a different rank', () => {
    // The board is global across realms, so a same-named cross-realm
    // character must never read as the viewer.
    const noSelf = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({ leaders: [entry({ rank: 1, name: 'Aldwin' })] }),
    });
    if (noSelf.kind !== 'ranked') throw new Error('expected ranked');
    expect(noSelf.rows[0].me).toBe(false);

    const otherRank = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({
        leaders: [entry({ rank: 1, name: 'Aldwin' }), entry({ rank: 2, name: 'Aldwin' })],
        total: 2,
        self: { rank: 2, topPercent: 4 },
      }),
    });
    if (otherRank.kind !== 'ranked') throw new Error('expected ranked');
    expect(otherRank.rows[0].me).toBe(false);
    expect(otherRank.rows[1].me).toBe(true);
  });

  it('flags nothing when self is absent or its rank is off the visible page', () => {
    const absent = buildDeedsLeaderboardView({ kind: 'page', page: page() });
    if (absent.kind !== 'ranked') throw new Error('expected ranked');
    expect(absent.rows.every((r) => !r.me)).toBe(true);

    const offPage = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({
        leaders: [entry({ rank: 1 }), entry({ rank: 2, name: 'Berrin' })],
        total: 120,
        pageCount: 3,
        self: { rank: 90, topPercent: 75 },
      }),
    });
    if (offPage.kind !== 'ranked') throw new Error('expected ranked');
    expect(offPage.rows.every((r) => !r.me)).toBe(true);
  });

  it('decides the self-line arm in the core: account with renown, rank without, null absent', () => {
    // A current server sends the account's renown: the CORE picks the
    // 'account' arm, so the choice is behaviorally pinned here (the painter
    // only maps each kind to its t() key; swapping the keys between arms
    // fails the painter's arm-bound source pin, not just a scan).
    const withRenown = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({ self: { rank: 12, topPercent: 4, renown: 1620 } }),
    });
    if (withRenown.kind !== 'ranked') throw new Error('expected ranked');
    expect(withRenown.self).toEqual({ kind: 'account', rank: 12, topPercent: 4, renown: 1620 });

    // An OLDER server (rolling deploy, self-hosted) omits renown: the core
    // falls back to the rank-only arm rather than dropping the standing.
    const withSelf = buildDeedsLeaderboardView({
      kind: 'page',
      page: page({ self: { rank: 12, topPercent: 4 } }),
    });
    if (withSelf.kind !== 'ranked') throw new Error('expected ranked');
    expect(withSelf.self).toEqual({ kind: 'rank', rank: 12, topPercent: 4 });

    const withoutSelf = buildDeedsLeaderboardView({ kind: 'page', page: page() });
    if (withoutSelf.kind !== 'ranked') throw new Error('expected ranked');
    expect(withoutSelf.self).toBeNull();
  });

  it('omits the pager when the board fits on one page', () => {
    const view = buildDeedsLeaderboardView({ kind: 'page', page: page() });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toBeNull();
  });

  it('builds pager state with prev disabled on the first page', () => {
    const view = buildDeedsLeaderboardView({ kind: 'page', page: page({ page: 0, pageCount: 3 }) });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 0, pageCount: 3, prevDisabled: true, nextDisabled: false });
  });

  it('builds pager state with next disabled on the last page', () => {
    const view = buildDeedsLeaderboardView({ kind: 'page', page: page({ page: 2, pageCount: 3 }) });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 2, pageCount: 3, prevDisabled: false, nextDisabled: true });
  });

  it('mirrors the server-clamped page back into the view', () => {
    const view = buildDeedsLeaderboardView({ kind: 'page', page: page({ page: 1, pageCount: 4 }) });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.page).toBe(1);
  });

  it('is deterministic for the same input', () => {
    const input: DeedsLeaderboardInput = {
      kind: 'page',
      page: page({ self: { rank: 1, topPercent: 1 } }),
    };
    expect(buildDeedsLeaderboardView(input)).toEqual(buildDeedsLeaderboardView(input));
  });

  it('parity: a Sim-shaped empty page renders empty like the offline world', () => {
    // The offline Sim resolves paginateDeedsLeaderboard([], ...): an empty
    // board with no self line, exactly the sandbox contract.
    const simPage = paginateDeedsLeaderboard([], 0, 50);
    const view = buildDeedsLeaderboardView({ kind: 'page', page: simPage });
    expect(view.kind).toBe('empty');
  });
});
