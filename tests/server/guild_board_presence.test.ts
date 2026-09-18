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
  GUILD_BOARD_PRESENCE_DEADLINE_MS,
  GUILD_BOARD_PRESENCE_DEMAND_TTL_MS,
  GUILD_BOARD_PRESENCE_RETRY_MS,
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

  it('bounds the wait on a cold read by the deadline, serving the page bare and installing the read for the next caller', async () => {
    // Presence may never add a database round trip's latency to a public
    // board read: a roster read still in flight past the deadline serves
    // the page without presence, keeps running (single-flight), and installs
    // for the next request. The deadline is a real timer; the read is held
    // open by hand and released after the first page went out bare.
    expect(GUILD_BOARD_PRESENCE_DEADLINE_MS).toBe(250);
    let release: (rows: GuildOfficerRow[]) => void = () => {};
    const readOfficers = vi.fn(
      () =>
        new Promise<GuildOfficerRow[]>((resolve) => {
          release = resolve;
        }),
    );
    const presence = createGuildBoardPresence({ readOfficers, deadlineMs: 5, now: () => 0 });
    const page = [entry(1, 'Stormcallers')];
    const bare = await presence.attach(page, () => true);
    expect(bare).toEqual(page);
    expect(bare).not.toBe(page);
    expect(readOfficers).toHaveBeenCalledTimes(1);
    release(ROWS);
    const decorated = await presence.attach(page, (id) => id === 1);
    expect(decorated[0].onlineOfficers).toEqual([{ name: 'Boss', rank: 'leader' }]);
    // The in-flight read was joined, never restarted.
    expect(readOfficers).toHaveBeenCalledTimes(1);
  });

  it('skips the roster for the retry window after a cold read fails, then tries again', async () => {
    // Single-flight bounds concurrency, not rate: without the window every
    // request on a down database would start (and log) a fresh attempt the
    // moment the last one settled.
    expect(GUILD_BOARD_PRESENCE_RETRY_MS).toBe(5_000);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let now = 0;
    let down = true;
    const readOfficers = vi.fn(async () => {
      if (down) throw new Error('db down');
      return ROWS;
    });
    const presence = createGuildBoardPresence({ readOfficers, retryMs: 5_000, now: () => now });
    const page = [entry(1, 'Stormcallers')];
    expect(await presence.attach(page, () => true)).toEqual(page);
    now = 4_999;
    expect(await presence.attach(page, () => true)).toEqual(page);
    expect(readOfficers).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    now = 5_000;
    down = false;
    const out = await presence.attach(page, () => true);
    expect(readOfficers).toHaveBeenCalledTimes(2);
    expect(out[0].onlineOfficers).toEqual([
      { name: 'Boss', rank: 'leader' },
      { name: 'Right Hand', rank: 'officer' },
      { name: 'Left Hand', rank: 'officer' },
    ]);
    // A bust clears the window too: a moderation action must never leave
    // the board dot-less for the rest of a failure window.
    down = true;
    presence.bust();
    now = 10_000;
    await presence.attach(page, () => true);
    presence.bust();
    await presence.attach(page, () => true);
    expect(readOfficers).toHaveBeenCalledTimes(4);
    error.mockRestore();
  });

  it('warm() is demand-gated: an idle realm pays nothing, a viewed board refreshes', async () => {
    expect(GUILD_BOARD_PRESENCE_DEMAND_TTL_MS).toBe(10 * 60_000);
    let now = 0;
    const readOfficers = vi.fn(async () => ROWS);
    const presence = createGuildBoardPresence({ readOfficers, now: () => now });
    await presence.warm();
    expect(readOfficers).not.toHaveBeenCalled();
    // A served page registers demand; the next warm refreshes, and the
    // warmed roster then serves a page with no read of its own.
    await presence.attach([entry(1, 'Gatekept')], () => false);
    expect(readOfficers).toHaveBeenCalledTimes(1);
    now = 30_000;
    await presence.warm();
    expect(readOfficers).toHaveBeenCalledTimes(2);
    const out = await presence.attach([entry(1, 'Gatekept')], (id) => id === 9);
    expect(out[0].onlineOfficers).toEqual([{ name: 'Warden', rank: 'leader' }]);
    expect(readOfficers).toHaveBeenCalledTimes(2);
    // Demand lapses: the loop stops paying for a board nobody opens.
    now = 30_000 + 10 * 60_000;
    await presence.warm();
    expect(readOfficers).toHaveBeenCalledTimes(2);
  });

  it('warm() forces the refresh even while the roster is still fresh (the loop runs on the TTL cadence)', async () => {
    let now = 0;
    const readOfficers = vi.fn(async () => ROWS);
    const presence = createGuildBoardPresence({ readOfficers, ttlMs: 30_000, now: () => now });
    await presence.attach([entry(1, 'Gatekept')], () => false);
    now = 29_999;
    // read() would still serve the cached roster here; the warm must not.
    await presence.warm();
    expect(readOfficers).toHaveBeenCalledTimes(2);
  });

  it('warm() never rejects: a failing refresh is logged and arms the retry window', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let now = 0;
    let down = false;
    const readOfficers = vi.fn(async () => {
      if (down) throw new Error('db down');
      return ROWS;
    });
    const presence = createGuildBoardPresence({ readOfficers, retryMs: 5_000, now: () => now });
    await presence.attach([entry(1, 'Gatekept')], () => false);
    down = true;
    presence.bust();
    await expect(presence.warm()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    // Inside the window a page is served bare with no read of its own.
    now = 1_000;
    expect(await presence.attach([entry(1, 'Gatekept')], () => true)).toEqual([
      entry(1, 'Gatekept'),
    ]);
    expect(readOfficers).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('a successful read inside the retry window re-arms presence at once', async () => {
    // The window exists to stop a DOWN database being hammered; a read that
    // succeeds (the warm loop, typically) must not leave pages bare until
    // the window lapses.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let now = 0;
    let down = true;
    const readOfficers = vi.fn(async () => {
      if (down) throw new Error('db down');
      return ROWS;
    });
    const presence = createGuildBoardPresence({ readOfficers, retryMs: 5_000, now: () => now });
    const page = [entry(1, 'Gatekept')];
    expect(await presence.attach(page, () => true)).toEqual(page);
    down = false;
    now = 1_000;
    await presence.warm();
    expect(readOfficers).toHaveBeenCalledTimes(2);
    const out = await presence.attach(page, (id) => id === 9);
    expect(out[0].onlineOfficers).toEqual([{ name: 'Warden', rank: 'leader' }]);
    expect(readOfficers).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
