// The guild board's "officers online" presence layer
// (server/guild_board_presence.ts): the roster fold, the pure per-page attach
// (immutable, order-keeping, allocation-free when nobody is online), and the
// cached read's freshness, single-flight, stale-serve and bust behavior with an
// injected fake reader and clock.

// server/db.ts constructs a pg Pool at module load and throws if DATABASE_URL is
// unset; the presence module reaches it through guild_board_db.ts for its
// production instance, which no test below exercises.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_guild_board_presence';

import { describe, expect, it, vi } from 'vitest';
import type { GuildOfficerRow } from '../../server/guild_board_db';
import {
  attachOfficerPresence,
  createGuildBoardPresence,
  GUILD_BOARD_PRESENCE_TTL_MS,
  type GuildOfficerRoster,
  onlineOfficersOf,
  rosterByGuild,
} from '../../server/guild_board_presence';
import type { GuildLeaderboardEntry } from '../../src/world_api';

const ROWS: GuildOfficerRow[] = [
  { guildName: 'Stormcallers', characterId: 1, name: 'Boss', rank: 'leader' },
  { guildName: 'Stormcallers', characterId: 2, name: 'Right Hand', rank: 'officer' },
  { guildName: 'Stormcallers', characterId: 3, name: 'Left Hand', rank: 'officer' },
  { guildName: 'Gatekept', characterId: 9, name: 'Warden', rank: 'leader' },
];

function entry(rank: number, name: string): GuildLeaderboardEntry {
  return { rank, name, memberCount: 3, totalLifetimeXp: 1000, topLevel: 20, pledgesOpen: true };
}

describe('rosterByGuild + onlineOfficersOf', () => {
  it('groups rows by exact guild name, keeping the roster order', () => {
    const roster = rosterByGuild(ROWS);
    expect([...roster.keys()]).toEqual(['Stormcallers', 'Gatekept']);
    expect(roster.get('Stormcallers')?.map((r) => r.name)).toEqual([
      'Boss',
      'Right Hand',
      'Left Hand',
    ]);
  });

  it('lists the online officers by name and rank only (no ids), in roster order', () => {
    const roster = rosterByGuild(ROWS);
    const online = new Set([3, 1]);
    expect(onlineOfficersOf(roster.get('Stormcallers'), (id) => online.has(id))).toEqual([
      { name: 'Boss', rank: 'leader' },
      { name: 'Left Hand', rank: 'officer' },
    ]);
    expect(onlineOfficersOf(undefined, () => true)).toEqual([]);
  });
});

describe('attachOfficerPresence', () => {
  const roster: GuildOfficerRoster = rosterByGuild(ROWS);

  it('decorates only the rows with an online officer, by reference otherwise', () => {
    const leaders = [entry(1, 'Stormcallers'), entry(2, 'Gatekept'), entry(3, 'Unknown')];
    Object.freeze(leaders[0]);
    const out = attachOfficerPresence(leaders, roster, (id) => id === 2);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      ...leaders[0],
      onlineOfficers: [{ name: 'Right Hand', rank: 'officer' }],
    });
    expect(out[0]).not.toBe(leaders[0]);
    expect(out[1]).toBe(leaders[1]);
    expect(out[2]).toBe(leaders[2]);
    // The cached (frozen, shared) row was never mutated.
    expect('onlineOfficers' in leaders[0]).toBe(false);
  });

  it('keeps two guilds whose names differ only by case apart (no union of officers)', () => {
    // guilds(realm, name) is case-sensitive and historical case-only pairs
    // exist; a folded key would light BOTH dots with both guilds' officers.
    const twins = rosterByGuild([
      ...ROWS,
      { guildName: 'stormcallers', characterId: 40, name: 'Impostor', rank: 'leader' },
    ]);
    const out = attachOfficerPresence(
      [entry(1, 'Stormcallers'), entry(2, 'stormcallers'), entry(3, 'STORMCALLERS')],
      twins,
      (id) => id === 1 || id === 40,
    );
    expect(out[0].onlineOfficers).toEqual([{ name: 'Boss', rank: 'leader' }]);
    expect(out[1].onlineOfficers).toEqual([{ name: 'Impostor', rank: 'leader' }]);
    expect(out[2].onlineOfficers).toBeUndefined();
  });
});

describe('createGuildBoardPresence', () => {
  it('defaults to the board caches cadence (main.ts LEADERBOARD_TTL_MS, 30s)', () => {
    expect(GUILD_BOARD_PRESENCE_TTL_MS).toBe(30_000);
  });

  it('reads the roster once per TTL, collapsing concurrent misses into one flight', async () => {
    let now = 0;
    const readOfficers = vi.fn(async () => ROWS);
    const presence = createGuildBoardPresence({ readOfficers, ttlMs: 30_000, now: () => now });
    const page = [entry(1, 'Stormcallers')];
    const isOnline = (id: number) => id === 1;
    const [a, b] = await Promise.all([
      presence.attach(page, isOnline),
      presence.attach(page, isOnline),
    ]);
    expect(readOfficers).toHaveBeenCalledTimes(1);
    expect(a[0].onlineOfficers).toEqual([{ name: 'Boss', rank: 'leader' }]);
    expect(b[0].onlineOfficers).toEqual([{ name: 'Boss', rank: 'leader' }]);
    now = 29_999;
    await presence.attach(page, isOnline);
    expect(readOfficers).toHaveBeenCalledTimes(1);
    now = 30_000;
    await presence.attach(page, isOnline);
    expect(readOfficers).toHaveBeenCalledTimes(2);
  });

  it('answers presence LIVE against the predicate even while the roster is cached', async () => {
    const presence = createGuildBoardPresence({ readOfficers: async () => ROWS, now: () => 0 });
    const page = [entry(1, 'Stormcallers')];
    expect((await presence.attach(page, () => false))[0].onlineOfficers).toBeUndefined();
    expect((await presence.attach(page, (id) => id === 2))[0].onlineOfficers).toEqual([
      { name: 'Right Hand', rank: 'officer' },
    ]);
  });

  it('never reads for an empty page', async () => {
    const readOfficers = vi.fn(async () => ROWS);
    const presence = createGuildBoardPresence({ readOfficers, now: () => 0 });
    expect(await presence.attach([], () => true)).toEqual([]);
    expect(readOfficers).not.toHaveBeenCalled();
  });

  it('serves the page without presence when the cold read fails, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const presence = createGuildBoardPresence({
      readOfficers: async () => {
        throw new Error('db down');
      },
      now: () => 0,
    });
    const page = [entry(1, 'Stormcallers')];
    const out = await presence.attach(page, () => true);
    expect(out).toEqual(page);
    expect(out).not.toBe(page);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('bust drops the cached roster so the next attach re-reads', async () => {
    const readOfficers = vi.fn(async () => ROWS);
    const presence = createGuildBoardPresence({ readOfficers, now: () => 0 });
    const page = [entry(1, 'Stormcallers')];
    await presence.attach(page, () => true);
    presence.bust();
    await presence.attach(page, () => true);
    expect(readOfficers).toHaveBeenCalledTimes(2);
  });
});
