// Tests for the guild-tab pure core (guild_leaderboard_view.ts):
//  - the async state machine: loading / error / empty / ranked discriminators,
//  - row derivation (rank, memberCount, totalLifetimeXp, topLevel passthrough),
//  - the pager state (hidden on one page, prev/next disabled at the ends),
//  - server page-clamp passthrough,
//  - parity: a Sim-shaped empty page and a ClientWorld-mirror-shaped page render
//    the matching model, plus same-input determinism.
//
// The core is async-free (the painter owns the Promise); this Node suite drives it
// directly. Guilds are server-only, so the offline Sim always lands on `empty`.

import { describe, expect, it } from 'vitest';
import { paginateGuildLeaderboard } from '../src/sim/leaderboard_page';
import {
  buildGuildLeaderboardView,
  type GuildLeaderboardInput,
} from '../src/ui/guild_leaderboard_view';
import type { GuildLeaderboardEntry, GuildLeaderboardPage } from '../src/world_api';

function entry(over: Partial<GuildLeaderboardEntry> = {}): GuildLeaderboardEntry {
  return {
    rank: 1,
    name: 'Ironforge Guard',
    memberCount: 20,
    totalLifetimeXp: 1_000_000,
    topLevel: 20,
    ...over,
  };
}

function page(over: Partial<GuildLeaderboardPage> = {}): GuildLeaderboardPage {
  return { leaders: [entry()], page: 0, pageCount: 1, total: 1, pageSize: 50, ...over };
}

describe('buildGuildLeaderboardView', () => {
  it('maps the loading discriminator straight through', () => {
    expect(buildGuildLeaderboardView({ kind: 'loading' })).toEqual({ kind: 'loading' });
  });

  it('maps the error discriminator straight through', () => {
    expect(buildGuildLeaderboardView({ kind: 'error' })).toEqual({ kind: 'error' });
  });

  it('reports an empty page as empty (the offline Sim always lands here)', () => {
    const view = buildGuildLeaderboardView({ kind: 'page', page: page({ leaders: [], total: 0 }) });
    expect(view.kind).toBe('empty');
  });

  it('derives ranked rows, passing every guild field through', () => {
    const input: GuildLeaderboardInput = {
      kind: 'page',
      page: page({
        leaders: [
          entry({ rank: 1, name: 'Alpha', memberCount: 30, totalLifetimeXp: 5_000, topLevel: 20 }),
          entry({ rank: 2, name: 'Beta', memberCount: 12, totalLifetimeXp: 3_000, topLevel: 18 }),
        ],
        total: 2,
      }),
    };
    const view = buildGuildLeaderboardView(input);
    expect(view.kind).toBe('ranked');
    if (view.kind !== 'ranked') return;
    expect(view.rows).toEqual([
      { rank: 1, name: 'Alpha', memberCount: 30, totalLifetimeXp: 5_000, topLevel: 20 },
      { rank: 2, name: 'Beta', memberCount: 12, totalLifetimeXp: 3_000, topLevel: 18 },
    ]);
  });

  it('omits the pager when the board fits on one page', () => {
    const view = buildGuildLeaderboardView({ kind: 'page', page: page() });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toBeNull();
  });

  it('builds pager state with prev disabled on the first page', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ page: 0, pageCount: 3 }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 0, pageCount: 3, prevDisabled: true, nextDisabled: false });
  });

  it('builds pager state with next disabled on the last page', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ page: 2, pageCount: 3 }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 2, pageCount: 3, prevDisabled: false, nextDisabled: true });
  });

  it('mirrors the server-clamped page back into the view', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ page: 1, pageCount: 4 }),
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.page).toBe(1);
  });

  it('is deterministic for the same input', () => {
    const input: GuildLeaderboardInput = { kind: 'page', page: page() };
    expect(buildGuildLeaderboardView(input)).toEqual(buildGuildLeaderboardView(input));
  });

  it('parity: a Sim-shaped empty page renders empty like the offline world', () => {
    // The offline Sim resolves paginateGuildLeaderboard([], ...): an empty board.
    const simPage = paginateGuildLeaderboard([], 0, 50);
    const view = buildGuildLeaderboardView({ kind: 'page', page: simPage });
    expect(view.kind).toBe('empty');
  });
});
