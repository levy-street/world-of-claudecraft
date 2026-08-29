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
  type GuildBoardViewer,
  type GuildLeaderboardInput,
  guildPledgeCell,
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
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ leaders: [], total: 0 }),
      viewer: null,
    });
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
      viewer: null,
    };
    const view = buildGuildLeaderboardView(input);
    expect(view.kind).toBe('ranked');
    if (view.kind !== 'ranked') return;
    expect(view.rows).toEqual([
      {
        rank: 1,
        name: 'Alpha',
        memberCount: 30,
        totalLifetimeXp: 5_000,
        topLevel: 20,
        tier: 0,
        open: null,
        minLevel: 1,
        note: '',
        pledge: 'none',
      },
      {
        rank: 2,
        name: 'Beta',
        memberCount: 12,
        totalLifetimeXp: 3_000,
        topLevel: 18,
        tier: 0,
        open: null,
        minLevel: 1,
        note: '',
        pledge: 'none',
      },
    ]);
  });

  it('omits the pager when the board fits on one page', () => {
    const view = buildGuildLeaderboardView({ kind: 'page', page: page(), viewer: null });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toBeNull();
  });

  it('builds pager state with prev disabled on the first page', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ page: 0, pageCount: 3 }),
      viewer: null,
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 0, pageCount: 3, prevDisabled: true, nextDisabled: false });
  });

  it('builds pager state with next disabled on the last page', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ page: 2, pageCount: 3 }),
      viewer: null,
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.pager).toEqual({ page: 2, pageCount: 3, prevDisabled: false, nextDisabled: true });
  });

  it('mirrors the server-clamped page back into the view', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({ page: 1, pageCount: 4 }),
      viewer: null,
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.page).toBe(1);
  });

  it('is deterministic for the same input', () => {
    const input: GuildLeaderboardInput = { kind: 'page', page: page(), viewer: null };
    expect(buildGuildLeaderboardView(input)).toEqual(buildGuildLeaderboardView(input));
  });

  it('parity: a Sim-shaped empty page renders empty like the offline world', () => {
    // The offline Sim resolves paginateGuildLeaderboard([], ...): an empty board.
    const simPage = paginateGuildLeaderboard([], 0, 50);
    const view = buildGuildLeaderboardView({ kind: 'page', page: simPage, viewer: null });
    expect(view.kind).toBe('empty');
  });

  it('derives the pledge-board recruiting fields and the colour tier', () => {
    const view = buildGuildLeaderboardView({
      kind: 'page',
      page: page({
        leaders: [
          entry({
            name: 'Serious Guild',
            // 1M summed XP crosses the second tier threshold (guild_tier.ts).
            totalLifetimeXp: 1_000_000,
            pledgesOpen: true,
            pledgeMinLevel: 20,
            pledgeNote: 'raiders wanted',
          }),
        ],
      }),
      viewer: { guildName: null, level: 60, pledgedTo: null },
    });
    if (view.kind !== 'ranked') throw new Error('expected ranked');
    expect(view.rows[0]).toMatchObject({
      tier: 2,
      open: true,
      minLevel: 20,
      note: 'raiders wanted',
      pledge: 'pledge',
    });
  });
});

// The pledge affordance decision table (docs/prd/guild-pledge-board.md): what
// the board's action cell shows the viewer, per row. The precedence pins are
// what matter: your own guild always reads 'yours', any other membership kills
// the affordance, a standing pledge survives the guild closing, and only then
// do the guild's own gates apply.
describe('guildPledgeCell', () => {
  const row = { name: 'Wolves', open: true as boolean | null, minLevel: 10 };
  const viewer = (over: Partial<GuildBoardViewer> = {}): GuildBoardViewer => ({
    guildName: null,
    level: 60,
    pledgedTo: null,
    ...over,
  });

  it('hides the affordance entirely on a pre-pledge-board server (open null)', () => {
    expect(guildPledgeCell({ ...row, open: null }, viewer())).toBe('none');
  });

  it('hides the affordance offline (no viewer)', () => {
    expect(guildPledgeCell(row, null)).toBe('none');
  });

  it("marks the viewer's own guild row 'yours', even when pledging is closed", () => {
    expect(guildPledgeCell({ ...row, open: false }, viewer({ guildName: 'Wolves' }))).toBe('yours');
  });

  it('shows no affordance to a member of another guild (members do not pledge)', () => {
    expect(guildPledgeCell(row, viewer({ guildName: 'Rivals' }))).toBe('none');
  });

  it("shows 'pledged' for a standing pledge, even after the guild closed", () => {
    expect(guildPledgeCell({ ...row, open: false }, viewer({ pledgedTo: 'Wolves' }))).toBe(
      'pledged',
    );
  });

  it("shows 'closed' when the guild is not accepting pledges", () => {
    expect(guildPledgeCell({ ...row, open: false }, viewer())).toBe('closed');
  });

  it("shows 'belowLevel' under the guild's level floor", () => {
    expect(guildPledgeCell(row, viewer({ level: 9 }))).toBe('belowLevel');
  });

  it('shows the actionable button at the floor exactly', () => {
    expect(guildPledgeCell(row, viewer({ level: 10 }))).toBe('pledge');
  });

  it('a pledge to a DIFFERENT guild leaves this row actionable (re-pledge moves it)', () => {
    expect(guildPledgeCell(row, viewer({ pledgedTo: 'Rivals' }))).toBe('pledge');
  });
});
