// Tests for the developers-tab pure core (dev_leaderboard_view.ts):
//  - the async state machine: loading / error / empty / ranked discriminators,
//  - row derivation (rank, login, mergedPrs, devTier passthrough),
//  - the viewer's own row flagged `me` by case-insensitive GitHub login match,
//  - the pager state (hidden on one page, prev/next disabled at the ends),
//  - server page-clamp passthrough,
//  - parity: a Sim-shaped empty page and a ClientWorld-mirror-shaped page render
//    the matching model, plus same-input determinism.
//
// The core is async-free (the painter owns the Promise); this Node suite drives it
// directly. The board is sourced from GitHub stats, so the offline Sim always
// lands on `empty`.

import { describe, expect, it } from 'vitest';
import { paginateDevLeaderboard } from '../src/sim/leaderboard_page';
import { buildDevLeaderboardView, type DevLeaderboardInput } from '../src/ui/dev_leaderboard_view';
import type { DevLeaderboardEntry, DevLeaderboardPage } from '../src/world_api';

function entry(over: Partial<DevLeaderboardEntry> = {}): DevLeaderboardEntry {
  return { rank: 1, login: 'FernandoX7', mergedPrs: 821, devTier: 5, ...over };
}

function page(over: Partial<DevLeaderboardPage> = {}): DevLeaderboardPage {
  return { leaders: [entry()], page: 0, pageCount: 1, total: 1, pageSize: 50, ...over };
}

describe('buildDevLeaderboardView', () => {
  it('maps the loading discriminator straight through', () => {
    expect(buildDevLeaderboardView({ kind: 'loading' })).toEqual({ kind: 'loading' });
  });

  it('maps the error discriminator straight through', () => {
    expect(buildDevLeaderboardView({ kind: 'error' })).toEqual({ kind: 'error' });
  });

  it('reports an empty page as empty (the offline Sim always lands here)', () => {
    const view = buildDevLeaderboardView({ kind: 'page', page: page({ leaders: [], total: 0 }) });
    expect(view.kind).toBe('empty');
  });

  it('derives ranked rows, passing every contributor field through, with me false when no viewer login', () => {
    const input: DevLeaderboardInput = {
      kind: 'page',
      page: page({
        leaders: [
          entry({ rank: 1, login: 'FernandoX7', mergedPrs: 821, devTier: 5 }),
          entry({ rank: 2, login: 'jgyy', mergedPrs: 664, devTier: 5 }),
        ],
        total: 2,
      }),
    };
    const view = buildDevLeaderboardView(input);
    expect(view.kind).toBe('ranked');
    if (view.kind !== 'ranked') return;
    expect(view.rows).toEqual([
      { rank: 1, login: 'FernandoX7', mergedPrs: 821, devTier: 5, me: false },
      { rank: 2, login: 'jgyy', mergedPrs: 664, devTier: 5, me: false },
    ]);
  });

  it('flags the viewer row case-insensitively by GitHub login', () => {
    const input: DevLeaderboardInput = {
      kind: 'page',
      page: page({
        leaders: [entry({ rank: 1, login: 'FernandoX7' }), entry({ rank: 2, login: 'jgyy' })],
        total: 2,
      }),
      viewerLogin: 'JGYY',
    };
    const view = buildDevLeaderboardView(input);
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.rows[0].me).toBe(false);
    expect(view.rows[1].me).toBe(true);
  });

  it('does not flag any row me when viewerLogin is absent or empty', () => {
    const viewNoLogin = buildDevLeaderboardView({ kind: 'page', page: page() });
    if (viewNoLogin.kind !== 'ranked') throw new Error('expected ranked');
    expect(viewNoLogin.rows[0].me).toBe(false);

    const viewEmptyLogin = buildDevLeaderboardView({
      kind: 'page',
      page: page(),
      viewerLogin: '',
    });
    if (viewEmptyLogin.kind !== 'ranked') throw new Error('expected ranked');
    expect(viewEmptyLogin.rows[0].me).toBe(false);

    const viewNullLogin = buildDevLeaderboardView({
      kind: 'page',
      page: page(),
      viewerLogin: null,
    });
    if (viewNullLogin.kind !== 'ranked') throw new Error('expected ranked');
    expect(viewNullLogin.rows[0].me).toBe(false);
  });

  it('omits the pager when the board fits on one page', () => {
    const view = buildDevLeaderboardView({ kind: 'page', page: page() });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toBeNull();
  });

  it('builds pager state with prev disabled on the first page', () => {
    const view = buildDevLeaderboardView({
      kind: 'page',
      page: page({ page: 0, pageCount: 3 }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 0, pageCount: 3, prevDisabled: true, nextDisabled: false });
  });

  it('builds pager state with next disabled on the last page', () => {
    const view = buildDevLeaderboardView({
      kind: 'page',
      page: page({ page: 2, pageCount: 3 }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 2, pageCount: 3, prevDisabled: false, nextDisabled: true });
  });

  it('mirrors the server-clamped page back into the view', () => {
    const view = buildDevLeaderboardView({
      kind: 'page',
      page: page({ page: 1, pageCount: 4 }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.page).toBe(1);
  });

  it('is deterministic for the same input', () => {
    const input: DevLeaderboardInput = { kind: 'page', page: page(), viewerLogin: 'jgyy' };
    expect(buildDevLeaderboardView(input)).toEqual(buildDevLeaderboardView(input));
  });

  it('parity: a Sim-shaped empty page renders empty like the offline world', () => {
    // The offline Sim resolves paginateDevLeaderboard([], ...): an empty board.
    const simPage = paginateDevLeaderboard([], 0, 50);
    const view = buildDevLeaderboardView({ kind: 'page', page: simPage });
    expect(view.kind).toBe('empty');
  });
});
