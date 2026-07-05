// Tests for the leaderboard window pure core (leaderboard_view.ts):
//  - the async state machine: loading / error / empty / ranked discriminators,
//  - row derivation (rank, me-flag, knownClass, prestige passthrough),
//  - the off-page "your standing" sticky row,
//  - the pager state (hidden on one page, prev/next disabled at the ends),
//  - server page-clamp passthrough,
//  - parity: a Sim-shaped page (with extra ignored fields) and a
//    ClientWorld-mirror-shaped page carrying the same logical data render an
//    identical model, across EVERY state including error, plus same-input
//    determinism.
//
// The core is async-free (the painter owns the Promise); this Node suite drives it
// directly. DOM-free / i18n-free, so the localized markup is covered by the
// leaderboard_window.ts WCAG-markup source guard.

import { describe, expect, it } from 'vitest';
import { virtualLevel } from '../src/sim/types';
import {
  buildLeaderboardView,
  type LeaderboardInput,
  type LeaderboardView,
  type LeaderboardViewer,
} from '../src/ui/leaderboard_view';
import type { LeaderboardEntry, LeaderboardPage } from '../src/world_api';

const VIEWER: LeaderboardViewer = { name: 'Me', level: 60, lifetimeXp: 999_999 };

function entry(over: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    rank: 1,
    name: 'Me',
    cls: 'warrior',
    level: 60,
    virtualLevel: 12,
    lifetimeXp: 5_000_000,
    prestigeRank: 0,
    ...over,
  };
}

// A resolved page. shape: 'sim' carries extra fields the core must ignore (the
// online-only-shape trap this parity check exists to catch).
function page(
  shape: 'sim' | 'client',
  leaders: LeaderboardEntry[],
  over: Partial<LeaderboardPage> = {},
): LeaderboardPage {
  const junk = shape === 'sim' ? { _serverSeq: 9, _dirty: true } : {};
  return {
    leaders,
    page: 0,
    pageCount: 1,
    total: leaders.length,
    pageSize: 50,
    ...junk,
    ...over,
  } as unknown as LeaderboardPage;
}

function ranked(view: LeaderboardView): Extract<LeaderboardView, { kind: 'ranked' }> {
  if (view.kind !== 'ranked') throw new Error(`expected a ranked view, got ${view.kind}`);
  return view;
}

describe('buildLeaderboardView: async state discriminators', () => {
  it('maps the in-flight loading input to the loading state', () => {
    expect(buildLeaderboardView({ kind: 'loading' })).toEqual({ kind: 'loading' });
  });

  it('maps a rejected / offline-unavailable fetch to the error state', () => {
    expect(buildLeaderboardView({ kind: 'error' })).toEqual({ kind: 'error' });
  });

  it('maps a resolved page with no leaders to the empty state', () => {
    const v = buildLeaderboardView({ kind: 'page', page: page('sim', []), viewer: VIEWER });
    expect(v).toEqual({ kind: 'empty' });
  });

  it('maps a resolved page with leaders to the ranked state', () => {
    const v = buildLeaderboardView({
      kind: 'page',
      page: page('sim', [entry()]),
      viewer: VIEWER,
    });
    expect(v.kind).toBe('ranked');
  });
});

describe('buildLeaderboardView: row derivation', () => {
  it('me-flags the viewer by name and marks known classes', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [
          entry({ rank: 1, name: 'Me', cls: 'warrior' }),
          entry({ rank: 2, name: 'Rival', cls: 'mage' }),
        ]),
        viewer: VIEWER,
      }),
    );
    expect(v.rows.map((r) => r.me)).toEqual([true, false]);
    expect(v.rows.every((r) => r.knownClass)).toBe(true);
    expect(v.rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('flags an unknown class id as knownClass=false and carries the raw id through', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry({ name: 'Mystery', cls: 'not_a_class' as never })]),
        viewer: VIEWER,
      }),
    );
    expect(v.rows[0].knownClass).toBe(false);
    expect(v.rows[0].cls).toBe('not_a_class');
  });

  it('carries the prestige rank through for the painter star', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry({ name: 'Champ', prestigeRank: 3 })]),
        viewer: VIEWER,
      }),
    );
    expect(v.rows[0].prestigeRank).toBe(3);
  });

  it('passes the level, virtual level, and lifetime xp through to the row', () => {
    // entry() carries distinct level (60) / virtualLevel (12) / lifetimeXp values,
    // so a swapped passthrough (e.g. level into virtualLevel) is caught here.
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry({ level: 60, virtualLevel: 12, lifetimeXp: 5_000_000 })]),
        viewer: VIEWER,
      }),
    );
    expect(v.rows[0].level).toBe(60);
    expect(v.rows[0].virtualLevel).toBe(12);
    expect(v.rows[0].lifetimeXp).toBe(5_000_000);
  });
});

describe('buildLeaderboardView: off-page "your standing" sticky row', () => {
  it('adds the sticky standing when the viewer is not on the visible page', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry({ name: 'Someone', cls: 'mage' })]),
        viewer: VIEWER,
      }),
    );
    expect(v.standing).toEqual({
      name: 'Me',
      level: 60,
      // virtualLevel is DERIVED from the viewer's lifetime XP (not passed in), so
      // assert the real derived value: this is the one field the core computes, and
      // it is distinct from the viewer's level (60), so a level/vlevel swap is caught.
      virtualLevel: virtualLevel(999_999),
      lifetimeXp: 999_999,
    });
  });

  it('omits the sticky standing when the viewer is on the visible page', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry({ name: 'Me' })]),
        viewer: VIEWER,
      }),
    );
    expect(v.standing).toBeNull();
  });
});

describe('buildLeaderboardView: pager state + server clamp', () => {
  it('omits the pager when the whole board fits on one page', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry()], { pageCount: 1 }),
        viewer: VIEWER,
      }),
    );
    expect(v.pager).toBeNull();
  });

  it('disables prev on the first page', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry()], { page: 0, pageCount: 3 }),
        viewer: VIEWER,
      }),
    );
    expect(v.pager).toEqual({ page: 0, pageCount: 3, prevDisabled: true, nextDisabled: false });
  });

  it('disables next on the last page', () => {
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry()], { page: 2, pageCount: 3 }),
        viewer: VIEWER,
      }),
    );
    expect(v.pager).toEqual({ page: 2, pageCount: 3, prevDisabled: false, nextDisabled: true });
  });

  it('passes the server-clamped page through so the painter can mirror it', () => {
    // The server clamped a request for page 9 down to the real last page (2).
    const v = ranked(
      buildLeaderboardView({
        kind: 'page',
        page: page('sim', [entry()], { page: 2, pageCount: 3 }),
        viewer: VIEWER,
      }),
    );
    expect(v.page).toBe(2);
    expect(v.pager?.nextDisabled).toBe(true);
  });
});

describe('buildLeaderboardView: ClientWorld-vs-Sim parity', () => {
  const leaders = [
    entry({ rank: 1, name: 'Me', cls: 'warrior' }),
    entry({ rank: 2, name: 'Rival', cls: 'mage', prestigeRank: 1 }),
  ];
  const cases: { label: string; input: (shape: 'sim' | 'client') => LeaderboardInput }[] = [
    { label: 'loading', input: () => ({ kind: 'loading' }) },
    { label: 'error', input: () => ({ kind: 'error' }) },
    {
      label: 'empty',
      input: (shape) => ({ kind: 'page', page: page(shape, []), viewer: VIEWER }),
    },
    {
      label: 'ranked (viewer on page)',
      input: (shape) => ({ kind: 'page', page: page(shape, leaders), viewer: VIEWER }),
    },
    {
      label: 'ranked (viewer off page, paged)',
      input: (shape) => ({
        kind: 'page',
        page: page(shape, [entry({ name: 'Other', cls: 'rogue' })], { page: 1, pageCount: 4 }),
        viewer: VIEWER,
      }),
    },
  ];

  for (const c of cases) {
    it(`renders identically from a Sim-shaped and a ClientWorld-mirror-shaped page: ${c.label}`, () => {
      const fromSim = buildLeaderboardView(c.input('sim'));
      const fromClient = buildLeaderboardView(c.input('client'));
      expect(fromSim).toEqual(fromClient);
    });
  }

  it('is deterministic: identical inputs produce a deep-equal view', () => {
    const input: LeaderboardInput = { kind: 'page', page: page('sim', leaders), viewer: VIEWER };
    expect(buildLeaderboardView(input)).toEqual(buildLeaderboardView(input));
  });
});
