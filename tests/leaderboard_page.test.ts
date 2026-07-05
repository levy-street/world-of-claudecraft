import { describe, expect, it } from 'vitest';
import {
  LEADERBOARD_MAX,
  LEADERBOARD_PAGE_SIZE,
  paginateGuildLeaderboard,
  paginateLeaderboard,
  paginateRanked,
} from '../src/sim/leaderboard_page';
import type { GuildLeaderboardEntry, LeaderboardEntry } from '../src/world_api';

function makeEntries(n: number): LeaderboardEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    name: `Player${i + 1}`,
    cls: 'warrior',
    level: 20,
    virtualLevel: 20,
    lifetimeXp: (n - i) * 1000,
    prestigeRank: 0,
  }));
}

describe('paginateLeaderboard', () => {
  it('returns the first page with default size', () => {
    const page = paginateLeaderboard(makeEntries(250), 0);
    expect(page.leaders).toHaveLength(LEADERBOARD_PAGE_SIZE);
    expect(page.leaders[0].rank).toBe(1);
    expect(page.leaders[LEADERBOARD_PAGE_SIZE - 1].rank).toBe(LEADERBOARD_PAGE_SIZE);
    expect(page.page).toBe(0);
    expect(page.total).toBe(250);
    expect(page.pageCount).toBe(5);
    expect(page.pageSize).toBe(LEADERBOARD_PAGE_SIZE);
  });

  it('slices a middle page preserving absolute ranks', () => {
    const page = paginateLeaderboard(makeEntries(250), 2);
    expect(page.page).toBe(2);
    expect(page.leaders[0].rank).toBe(101);
    expect(page.leaders.at(-1)!.rank).toBe(150);
  });

  it('exposes more than 100 entries (the reported bug: >100 level-20s)', () => {
    const entries = makeEntries(140);
    const first = paginateLeaderboard(entries, 0);
    const third = paginateLeaderboard(entries, 2);
    expect(first.pageCount).toBe(3);
    // rank 101+ is now reachable instead of being capped away at 100
    expect(third.leaders.some((e) => e.rank > 100)).toBe(true);
    expect(third.leaders.at(-1)!.rank).toBe(140);
  });

  it('clamps an out-of-range page to the last page', () => {
    const page = paginateLeaderboard(makeEntries(60), 99);
    expect(page.page).toBe(1);
    expect(page.leaders[0].rank).toBe(51);
    expect(page.leaders).toHaveLength(10);
  });

  it('clamps a negative or non-finite page to 0', () => {
    expect(paginateLeaderboard(makeEntries(60), -5).page).toBe(0);
    expect(paginateLeaderboard(makeEntries(60), NaN).page).toBe(0);
  });

  it('handles an empty board as one empty page', () => {
    const page = paginateLeaderboard([], 0);
    expect(page.leaders).toHaveLength(0);
    expect(page.pageCount).toBe(1);
    expect(page.total).toBe(0);
  });

  it('caps total and pageCount at LEADERBOARD_MAX', () => {
    const page = paginateLeaderboard(makeEntries(LEADERBOARD_MAX + 500), 0);
    expect(page.total).toBe(LEADERBOARD_MAX);
    expect(page.pageCount).toBe(LEADERBOARD_MAX / LEADERBOARD_PAGE_SIZE);
  });

  it('clamps an oversized pageSize rather than trusting the client', () => {
    const page = paginateLeaderboard(makeEntries(500), 0, 100000);
    expect(page.pageSize).toBe(LEADERBOARD_PAGE_SIZE * 2);
  });

  it('honors a custom in-range pageSize', () => {
    const page = paginateLeaderboard(makeEntries(75), 1, 25);
    expect(page.pageSize).toBe(25);
    expect(page.leaders[0].rank).toBe(26);
    expect(page.leaders).toHaveLength(25);
  });
});

function makeGuilds(n: number): GuildLeaderboardEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    name: `Guild${i + 1}`,
    memberCount: 10,
    totalLifetimeXp: (n - i) * 10_000,
    topLevel: 20,
  }));
}

// The guild board reuses the exact same slicing, clamping, and 1000-cap rule as
// the player board through the generic paginateRanked.
describe('paginateGuildLeaderboard', () => {
  it('returns the first page with default size and absolute ranks', () => {
    const page = paginateGuildLeaderboard(makeGuilds(120), 0);
    expect(page.leaders).toHaveLength(LEADERBOARD_PAGE_SIZE);
    expect(page.leaders[0].rank).toBe(1);
    expect(page.total).toBe(120);
    expect(page.pageCount).toBe(3);
  });

  it('slices a middle page preserving absolute ranks', () => {
    const page = paginateGuildLeaderboard(makeGuilds(120), 1);
    expect(page.leaders[0].rank).toBe(51);
    expect(page.leaders.at(-1)!.rank).toBe(100);
  });

  it('caps total and pageCount at LEADERBOARD_MAX', () => {
    const page = paginateGuildLeaderboard(makeGuilds(LEADERBOARD_MAX + 200), 0);
    expect(page.total).toBe(LEADERBOARD_MAX);
    expect(page.pageCount).toBe(LEADERBOARD_MAX / LEADERBOARD_PAGE_SIZE);
  });

  it('returns an empty single page for the offline (no-guild) world', () => {
    const page = paginateGuildLeaderboard([], 0);
    expect(page.leaders).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.pageCount).toBe(1);
  });

  it('paginateRanked is generic over the entry type (shared by both boards)', () => {
    const players = paginateRanked(makeEntries(60), 0);
    const guilds = paginateRanked(makeGuilds(60), 0);
    expect(players.total).toBe(60);
    expect(guilds.total).toBe(60);
    expect(players.pageCount).toBe(guilds.pageCount);
  });
});
