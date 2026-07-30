// Board-read single-flight: the TTL-cached board reads (deed rarity, the
// lifetime-XP leaderboard, the guild leaderboard, the arena ladder, and the
// project-stats accounts/characters-created counts) each share ONE underlying db
// read across N concurrent cold/expired callers, a rejected refresh is never
// cached (the next call re-reads fresh), a refresh error stale-serves the
// last-good value, and a moderation bust landing mid-flight evicts any in-flight
// pre-ban joiner (the epoch-keyed leaderboard, arena, and deeds Renown board
// flights) instead of handing it the pre-ban snapshot. The arena ladder is per
// FORMAT (each of '1v1' / '2v2' its own slot and flight); the project-stats
// counts share ONE single-key cache (both getters read one readProjectStats
// flight, so a cold burst costs exactly one getAccountsCount and one
// getCharactersCount read) and are moderation-INVARIANT, so the cache is NOT
// bust-wired and a cold-cache db error degrades both counts to 0.
//
// These drive the REAL module-private getters through boardReadTestSeam (exported
// by server/main.ts) with only the underlying db reads mocked, so every
// assertion exercises the genuine single-flight wiring. They deliberately do NOT
// go through configureDeedsRuntime / configureLeaderboardRuntime + fakeCtx: those
// runtime seams REPLACE the function under test with an injected fake, so a
// call-count pin taken that way would pass identically whether or not
// single-flight exists (a QA-passing zero-value test).
//
// MUTATION-CHECK (documented for the later serial pass; do NOT execute it here):
//   The structural guard that the epoch-keyed install is load-bearing is pinned in
//   tests/server/leaderboard_moderation.test.ts ("bumps the board epoch ..."). To
//   prove that pin actually bites: in server/main.ts, replace the
//   `if (boardEpoch === epoch)` install guard inside refreshLeaderboard with
//   `if (true)` (do NOT merely comment the line out, since that pin is a literal
//   source-text scan and a `//`-prefixed line still contains the substring),
//   confirm the leaderboard_moderation "bumps the board epoch" case goes RED, then
//   revert. The BEHAVIORAL oracle for the same property is the epoch/joiner-
//   eviction case below ("a moderation bust mid-flight ..."): it asserts the
//   post-bust caller triggered a FRESH read (topLifetimeXp ran twice) and the
//   pre-ban snapshot never installed, and reds if the flight is not keyed on
//   boardEpoch. Run neither mutation here.

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_board_single_flight';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

// The underlying board reads, controlled per case. Hoisted so the vi.mock
// factories below (which run before the module imports) can reference them.
const dbMocks = vi.hoisted(() => ({
  topLifetimeXp: vi.fn(),
  topGuilds: vi.fn(),
  topArenaRatings: vi.fn(),
  getAccountsCount: vi.fn(),
  getCharactersCount: vi.fn(),
  deedRarityCounts: vi.fn(),
  deedsBoardRanked: vi.fn(),
  charactersForDeedsBoard: vi.fn(),
}));

// Mock ONLY the underlying reads, spreading the real modules so every other
// export main.ts pulls from them (the pool, the many db helpers, the deeds SQL)
// stays real and the import stays inert. publicRarityPayload
// (server/deeds_records) is deliberately NOT mocked: it must strip hidden deeds
// for real so the strip-at-refresh case is meaningful.
vi.mock('../../server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/db')>()),
  topLifetimeXp: dbMocks.topLifetimeXp,
  topGuilds: dbMocks.topGuilds,
  topArenaRatings: dbMocks.topArenaRatings,
  getAccountsCount: dbMocks.getAccountsCount,
  getCharactersCount: dbMocks.getCharactersCount,
  deedsBoardRanked: dbMocks.deedsBoardRanked,
  charactersForDeedsBoard: dbMocks.charactersForDeedsBoard,
}));
vi.mock('../../server/deeds_db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/deeds_db')>()),
  deedRarityCounts: dbMocks.deedRarityCounts,
}));

import type {
  ArenaLeaderRow,
  DeedsBoardCharacterRow,
  GuildLeaderRow,
  LifetimeXpLeaderRow,
} from '../../server/db';
import type { RankedDeedsAccount } from '../../server/deeds_board';
import type { DeedRarityAggregate } from '../../server/deeds_db';
import { ARENA_LEADERBOARD_LIMIT } from '../../server/leaderboard';
import { boardReadTestSeam } from '../../server/main';

const seam = boardReadTestSeam;

// A real hidden deed id and a real non-hidden control, both sourced from
// src/sim/content/deeds.ts (hid_saul_footnote has `hidden: true`; prog_first_steps
// does not). publicRarityPayload strips the hidden one (isPubliclyListableDeedId
// fails closed on hidden ids) and keeps the listable one.
const HIDDEN_DEED_ID = 'hid_saul_footnote';
const LISTABLE_DEED_ID = 'prog_first_steps';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function xpRows(tag: string): LifetimeXpLeaderRow[] {
  return [
    {
      name: `${tag}-hero`,
      class: 'warrior',
      level: 60,
      realm: 'test-realm',
      lifetimeXp: 1_000,
      prestigeRank: 0,
      activeTitle: null,
    },
  ];
}

function guildRows(tag: string): GuildLeaderRow[] {
  return [
    {
      name: `${tag}-guild`,
      realm: 'test-realm',
      memberCount: 5,
      totalLifetimeXp: 5_000,
      topLevel: 60,
    },
  ];
}

function arenaRows(tag: string): ArenaLeaderRow[] {
  return [{ name: `${tag}-champ`, class: 'mage', level: 60, rating: 1800, wins: 20, losses: 5 }];
}

function rarityAggregate(): DeedRarityAggregate {
  return { totalEligible: 100, earned: { [LISTABLE_DEED_ID]: 40 } };
}

// A one-account Renown board roll-up whose display character id carries the
// pre/post discriminator: the entry fill reads the character NAME live
// (deedsCharacter below), so the tag surfaces on the entry name.
function deedsBoard(tag: 'preban' | 'postban'): {
  ranked: RankedDeedsAccount[];
  totalRanked: number;
  unknownDeedIds: string[];
} {
  return {
    ranked: [
      {
        accountId: 9,
        renown: 500,
        completionTime: 1_000,
        displayCharacterId: tag === 'preban' ? 1 : 2,
      },
    ],
    totalRanked: 1,
    unknownDeedIds: [],
  };
}

function deedsCharacter(id: number): DeedsBoardCharacterRow {
  return {
    id,
    name: id === 1 ? 'preban-deedster' : 'postban-deedster',
    class: 'warrior',
    level: 60,
    realm: 'test-realm',
    activeTitle: null,
  };
}

beforeEach(() => {
  dbMocks.topLifetimeXp.mockReset();
  dbMocks.topGuilds.mockReset();
  dbMocks.topArenaRatings.mockReset();
  dbMocks.getAccountsCount.mockReset();
  dbMocks.getCharactersCount.mockReset();
  dbMocks.deedRarityCounts.mockReset();
  dbMocks.deedsBoardRanked.mockReset();
  dbMocks.charactersForDeedsBoard.mockReset();
  // Null the leaderboard/guild/rarity caches between cases (the flights clear
  // their own in-flight slots on settle, and every case below settles all its
  // deferreds, so no slot leaks across cases).
  seam.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

// (A) CONCURRENCY: N concurrent cold callers cost one underlying read and all
// resolve to the one produced value.
async function sharesOneFlight<T>(mock: Mock, stub: unknown, invoke: () => Promise<T>): Promise<T> {
  const d = deferred<unknown>();
  mock.mockReturnValue(d.promise);
  const [a, b, c] = [invoke(), invoke(), invoke()];
  // The decisive oracle: three cold callers racing one flight cost ONE read.
  expect(mock).toHaveBeenCalledTimes(1);
  d.resolve(stub);
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  expect(mock).toHaveBeenCalledTimes(1);
  // All three resolve to the single value the one flight produced (same reference).
  expect(ra).toBe(rb);
  expect(rb).toBe(rc);
  return ra;
}

describe('concurrency: N cold callers share one underlying read', () => {
  it('getDeedsRarity: concurrent cold callers cost one deedRarityCounts read', async () => {
    const payload = await sharesOneFlight(dbMocks.deedRarityCounts, rarityAggregate(), () =>
      seam.getDeedsRarity(),
    );
    expect(payload.totalEligible).toBe(100);
    expect(payload.earned[LISTABLE_DEED_ID]).toBe(40);
  });

  it('getLeaderboard(realm): concurrent cold callers cost one topLifetimeXp read', async () => {
    const entries = await sharesOneFlight(dbMocks.topLifetimeXp, xpRows('realm'), () =>
      seam.getLeaderboard('realm'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('realm-hero');
  });

  it('getLeaderboard(global): concurrent cold callers cost one topLifetimeXp read', async () => {
    const entries = await sharesOneFlight(dbMocks.topLifetimeXp, xpRows('global'), () =>
      seam.getLeaderboard('global'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('global-hero');
    expect(entries[0].realm).toBe('test-realm'); // the global arm carries realm
  });

  it('getGuildLeaderboard(realm): concurrent cold callers cost one topGuilds read', async () => {
    const entries = await sharesOneFlight(dbMocks.topGuilds, guildRows('realm'), () =>
      seam.getGuildLeaderboard('realm'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('realm-guild');
  });

  it('getGuildLeaderboard(global): concurrent cold callers cost one topGuilds read', async () => {
    const entries = await sharesOneFlight(dbMocks.topGuilds, guildRows('global'), () =>
      seam.getGuildLeaderboard('global'),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('global-guild');
    expect(entries[0].realm).toBe('test-realm');
  });

  it('getArenaLeaderboard(1v1): concurrent cold callers cost one topArenaRatings read', async () => {
    const leaders = await sharesOneFlight(dbMocks.topArenaRatings, arenaRows('1v1'), () =>
      seam.getArenaLeaderboard('1v1'),
    );
    expect(leaders).toHaveLength(1);
    expect(leaders[0].name).toBe('1v1-champ');
    // the read is issued for the top ARENA_LEADERBOARD_LIMIT rows of this format
    expect(dbMocks.topArenaRatings).toHaveBeenCalledWith(ARENA_LEADERBOARD_LIMIT, '1v1');
  });

  it('getArenaLeaderboard(2v2): concurrent cold callers cost one topArenaRatings read', async () => {
    const leaders = await sharesOneFlight(dbMocks.topArenaRatings, arenaRows('2v2'), () =>
      seam.getArenaLeaderboard('2v2'),
    );
    expect(leaders).toHaveLength(1);
    expect(leaders[0].name).toBe('2v2-champ');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledWith(ARENA_LEADERBOARD_LIMIT, '2v2');
  });

  it('getAccountsCreatedCount: concurrent cold callers cost one getAccountsCount read', async () => {
    // The shared project-stats flight reads the peer count too; prime it so the
    // deferred below is the only pending read.
    dbMocks.getCharactersCount.mockResolvedValue(7);
    const count = await sharesOneFlight(dbMocks.getAccountsCount, 4242, () =>
      seam.getAccountsCreatedCount(),
    );
    expect(count).toBe(4242);
  });

  it('getCharactersCreatedCount: concurrent cold callers cost one getCharactersCount read', async () => {
    dbMocks.getAccountsCount.mockResolvedValue(7);
    const count = await sharesOneFlight(dbMocks.getCharactersCount, 456, () =>
      seam.getCharactersCreatedCount(),
    );
    expect(count).toBe(456);
  });

  it('both project-stats getters share ONE flight: one read per underlying count', async () => {
    // The decisive pin against per-getter caches wrapping the same inner read:
    // a cold burst across BOTH getters must cost exactly one getAccountsCount
    // and one getCharactersCount call, not one pair per getter.
    dbMocks.getAccountsCount.mockResolvedValue(123);
    dbMocks.getCharactersCount.mockResolvedValue(456);
    const [accounts, characters] = await Promise.all([
      seam.getAccountsCreatedCount(),
      seam.getCharactersCreatedCount(),
    ]);
    expect(accounts).toBe(123);
    expect(characters).toBe(456);
    expect(dbMocks.getAccountsCount).toHaveBeenCalledTimes(1);
    expect(dbMocks.getCharactersCount).toHaveBeenCalledTimes(1);
  });
});

// (B) REJECTION-NOT-CACHED: a rejected refresh serves the empty fallback to the
// concurrent sharers (cold cache) and does NOT cache the failure, so the next
// call re-invokes the underlying read.
describe('a rejected refresh is not cached: the next call re-reads fresh', () => {
  it('getDeedsRarity: rejection serves the empty aggregate, then re-reads', async () => {
    dbMocks.deedRarityCounts
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockResolvedValueOnce(rarityAggregate());
    const first = seam.getDeedsRarity();
    const second = seam.getDeedsRarity(); // shares the failing flight
    expect(dbMocks.deedRarityCounts).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual({ totalEligible: 0, earned: {} });
    await expect(second).resolves.toEqual({ totalEligible: 0, earned: {} });
    const third = await seam.getDeedsRarity();
    // The failure was not cached: the read ran a SECOND time on the next call.
    expect(dbMocks.deedRarityCounts).toHaveBeenCalledTimes(2);
    expect(third.earned[LISTABLE_DEED_ID]).toBe(40);
  });

  it('getLeaderboard(realm): rejection serves [], then re-reads', async () => {
    dbMocks.topLifetimeXp
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockResolvedValueOnce(xpRows('recovered'));
    const first = seam.getLeaderboard('realm');
    const second = seam.getLeaderboard('realm');
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    const third = await seam.getLeaderboard('realm');
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(2);
    expect(third).toHaveLength(1);
    expect(third[0].name).toBe('recovered-hero');
  });

  it('getGuildLeaderboard(realm): rejection serves [], then re-reads', async () => {
    dbMocks.topGuilds
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockResolvedValueOnce(guildRows('recovered'));
    const first = seam.getGuildLeaderboard('realm');
    const second = seam.getGuildLeaderboard('realm');
    expect(dbMocks.topGuilds).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    const third = await seam.getGuildLeaderboard('realm');
    expect(dbMocks.topGuilds).toHaveBeenCalledTimes(2);
    expect(third).toHaveLength(1);
    expect(third[0].name).toBe('recovered-guild');
  });

  it('getLeaderboard(global): rejection serves [], then re-reads', async () => {
    dbMocks.topLifetimeXp
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockResolvedValueOnce(xpRows('recovered'));
    const first = seam.getLeaderboard('global');
    const second = seam.getLeaderboard('global');
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    const third = await seam.getLeaderboard('global');
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(2);
    expect(third).toHaveLength(1);
    expect(third[0].name).toBe('recovered-hero');
  });

  it('getGuildLeaderboard(global): rejection serves [], then re-reads', async () => {
    dbMocks.topGuilds
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockResolvedValueOnce(guildRows('recovered'));
    const first = seam.getGuildLeaderboard('global');
    const second = seam.getGuildLeaderboard('global');
    expect(dbMocks.topGuilds).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    const third = await seam.getGuildLeaderboard('global');
    expect(dbMocks.topGuilds).toHaveBeenCalledTimes(2);
    expect(third).toHaveLength(1);
    expect(third[0].name).toBe('recovered-guild');
  });

  it('getArenaLeaderboard(1v1): rejection serves [], then re-reads', async () => {
    dbMocks.topArenaRatings
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockResolvedValueOnce(arenaRows('recovered'));
    const first = seam.getArenaLeaderboard('1v1');
    const second = seam.getArenaLeaderboard('1v1');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    const third = await seam.getArenaLeaderboard('1v1');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(2);
    expect(third).toHaveLength(1);
    expect(third[0].name).toBe('recovered-champ');
  });
});

// (C) STALE-SERVE ON ERROR: seed a fresh cache, expire it (advance the clock past
// the TTL), then force the refresh to reject; the caller gets the last-good cached
// value, not the empty fallback and not a throw.
describe('stale-serve on error: a refresh failure serves the last-good cache', () => {
  it('getDeedsRarity: serves the previous payload, not the empty aggregate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    dbMocks.deedRarityCounts.mockResolvedValueOnce(rarityAggregate());
    const good = await seam.getDeedsRarity();
    expect(good.earned[LISTABLE_DEED_ID]).toBe(40);
    // Past DEEDS_RARITY_TTL_MS (5 min): the next read refreshes, and it fails.
    vi.setSystemTime(new Date('2026-07-11T12:06:00.000Z'));
    dbMocks.deedRarityCounts.mockRejectedValueOnce(new Error('db down'));
    const served = await seam.getDeedsRarity();
    expect(dbMocks.deedRarityCounts).toHaveBeenCalledTimes(2);
    expect(served).toBe(good); // the exact cached payload, not a fresh empty aggregate
    expect(served).not.toEqual({ totalEligible: 0, earned: {} });
  });

  it('getLeaderboard(realm): serves the previous entries, not []', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    dbMocks.topLifetimeXp.mockResolvedValueOnce(xpRows('seed'));
    const good = await seam.getLeaderboard('realm');
    expect(good).toHaveLength(1);
    // Past LEADERBOARD_TTL_MS (30 s): the next read refreshes, and it fails.
    vi.setSystemTime(new Date('2026-07-11T12:00:31.000Z'));
    dbMocks.topLifetimeXp.mockRejectedValueOnce(new Error('db down'));
    const served = await seam.getLeaderboard('realm');
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(2);
    expect(served).toBe(good);
    expect(served).not.toEqual([]);
  });

  it('getGuildLeaderboard(realm): serves the previous entries, not []', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    dbMocks.topGuilds.mockResolvedValueOnce(guildRows('seed'));
    const good = await seam.getGuildLeaderboard('realm');
    expect(good).toHaveLength(1);
    vi.setSystemTime(new Date('2026-07-11T12:00:31.000Z'));
    dbMocks.topGuilds.mockRejectedValueOnce(new Error('db down'));
    const served = await seam.getGuildLeaderboard('realm');
    expect(dbMocks.topGuilds).toHaveBeenCalledTimes(2);
    expect(served).toBe(good);
    expect(served).not.toEqual([]);
  });

  it('getLeaderboard(global): serves the previous entries, not []', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    dbMocks.topLifetimeXp.mockResolvedValueOnce(xpRows('seed'));
    const good = await seam.getLeaderboard('global');
    expect(good).toHaveLength(1);
    vi.setSystemTime(new Date('2026-07-11T12:00:31.000Z'));
    dbMocks.topLifetimeXp.mockRejectedValueOnce(new Error('db down'));
    const served = await seam.getLeaderboard('global');
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(2);
    expect(served).toBe(good);
    expect(served).not.toEqual([]);
  });

  it('getGuildLeaderboard(global): serves the previous entries, not []', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    dbMocks.topGuilds.mockResolvedValueOnce(guildRows('seed'));
    const good = await seam.getGuildLeaderboard('global');
    expect(good).toHaveLength(1);
    vi.setSystemTime(new Date('2026-07-11T12:00:31.000Z'));
    dbMocks.topGuilds.mockRejectedValueOnce(new Error('db down'));
    const served = await seam.getGuildLeaderboard('global');
    expect(dbMocks.topGuilds).toHaveBeenCalledTimes(2);
    expect(served).toBe(good);
    expect(served).not.toEqual([]);
  });

  it('getArenaLeaderboard(1v1): serves the previous leaders, not []', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    dbMocks.topArenaRatings.mockResolvedValueOnce(arenaRows('seed'));
    const good = await seam.getArenaLeaderboard('1v1');
    expect(good).toHaveLength(1);
    // Past LEADERBOARD_TTL_MS (30 s): the next read refreshes, and it fails.
    vi.setSystemTime(new Date('2026-07-11T12:00:31.000Z'));
    dbMocks.topArenaRatings.mockRejectedValueOnce(new Error('db down'));
    const served = await seam.getArenaLeaderboard('1v1');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(2);
    expect(served).toBe(good);
    expect(served).not.toEqual([]);
  });
  // The project-stats count's warm-then-fail stale-serve is createCachedRead's own
  // contract, pinned with an injected clock in tests/server/cached_read.test.ts
  // (this cache captures Date.now at construction, so vi.useFakeTimers cannot expire
  // it here the way it can the inline-Date.now board caches). The wrapper only adds
  // the cold-cache degrade-to-0 fallback, pinned in (E3) below.
});

// (D) BOTH LEADERBOARD READ PATHS SHARE ONE FLIGHT.
describe('server/main.ts wiring: both leaderboard read paths share one flight', () => {
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');

  // A whitespace/newline-insensitive source strip of `//` line comments (leaving
  // `://` protocol slashes intact), so the call-site count below cannot be thrown
  // by a future comment that merely names the function.
  const codeOnly = src.replace(/(^|[^:])\/\/.*$/gm, '$1');

  // Whitespace-collapsed views so these pins survive biome line-wrapping of the
  // fluent `.realm().catch(...)` chains and the `singleFlight(() => ...)` wraps.
  const compactSrc = src.replace(/\s+/g, '');
  // Comment-stripped AND collapsed: the epoch-getter count below sits on this
  // view so a getter that is commented out (its text alive in the comment) still
  // drops the count and reds, the comment-gameable trap the raw compactSrc view
  // cannot catch.
  const compactCode = codeOnly.replace(/\s+/g, '');

  it('warmLeaderboards routes its four reads through the shared flights, none bare', () => {
    const at = src.indexOf('const warmLeaderboards');
    expect(at).toBeGreaterThan(-1);
    const compactBody = src
      .slice(at, src.indexOf('setInterval(warmLeaderboards', at))
      .replace(/\s+/g, '');
    expect(compactBody).toContain('refreshLeaderboardShared.realm()');
    expect(compactBody).toContain('refreshLeaderboardShared.global()');
    expect(compactBody).toContain('refreshGuildLeaderboardShared.realm()');
    expect(compactBody).toContain('refreshGuildLeaderboardShared.global()');
    // No bare (unwrapped) warm read on either path: only the *Shared accessors run
    // (a bare `refreshLeaderboard('realm')` call is absent; the *Shared accessor
    // `refreshLeaderboardShared.realm()` does not contain that substring).
    expect(compactBody).not.toContain("refreshLeaderboard('realm')");
    expect(compactBody).not.toContain("refreshLeaderboard('global')");
    expect(compactBody).not.toContain("refreshGuildLeaderboard('realm')");
    expect(compactBody).not.toContain("refreshGuildLeaderboard('global')");
  });

  it('no bare refreshLeaderboard/refreshGuildLeaderboard call survives outside the def and the two flight wraps', () => {
    // Each name resolves to EXACTLY three `<name>(` call sites: the
    // `async function <name>(` definition and the two per-scope
    // `() => <name>('realm'|'global')` singleFlight wraps. The `Shared` accessors
    // (refreshLeaderboardShared.realm()) do not match `<name>(` (the `Shared`
    // token sits between the name and the paren), and warm/getter reads go through
    // those accessors, so anything beyond these three would be a raw bypass. The
    // `<name>(` token is atomic (biome never splits a name from its paren), so the
    // count is formatting-stable.
    expect(codeOnly.match(/\brefreshLeaderboard\(/g)).toHaveLength(3);
    expect(codeOnly.match(/\brefreshGuildLeaderboard\(/g)).toHaveLength(3);
    // The three accounted sites for each name (definition + both wraps).
    expect(src).toContain('async function refreshLeaderboard(');
    expect(compactSrc).toContain("()=>refreshLeaderboard('realm')");
    expect(compactSrc).toContain("()=>refreshLeaderboard('global')");
    expect(src).toContain('async function refreshGuildLeaderboard(');
    expect(compactSrc).toContain("()=>refreshGuildLeaderboard('realm')");
    expect(compactSrc).toContain("()=>refreshGuildLeaderboard('global')");
  });

  it('getLeaderboard / getGuildLeaderboard read through the shared per-scope flights', () => {
    const glStart = src.indexOf('async function getLeaderboard(');
    expect(glStart).toBeGreaterThan(-1);
    const glBody = src.slice(glStart, src.indexOf('\n}\n', glStart)).replace(/\s+/g, '');
    expect(glBody).toContain('refreshLeaderboardShared[scope]()');
    const ggStart = src.indexOf('async function getGuildLeaderboard(');
    expect(ggStart).toBeGreaterThan(-1);
    const ggBody = src.slice(ggStart, src.indexOf('\n}\n', ggStart)).replace(/\s+/g, '');
    expect(ggBody).toContain('refreshGuildLeaderboardShared[scope]()');
  });

  it('no bare refreshArena call survives outside the def and the two flight wraps', () => {
    // refreshArena resolves to EXACTLY three `refreshArena(` sites: the
    // `async function refreshArena(` definition and the two per-format
    // `() => refreshArena('1v1'|'2v2')` singleFlight wraps. The `refreshArenaShared`
    // accessor does not match `refreshArena(` (the `Shared` token sits between the
    // name and the paren), and every read goes through that accessor, so anything
    // beyond these three would be a raw bypass that skips the epoch-keyed flight.
    expect(codeOnly.match(/\brefreshArena\(/g)).toHaveLength(3);
    expect(src).toContain('async function refreshArena(');
    expect(compactSrc).toContain("()=>refreshArena('1v1')");
    expect(compactSrc).toContain("()=>refreshArena('2v2')");
  });

  it('getArenaLeaderboard reads through the shared per-format flights', () => {
    const gaStart = src.indexOf('async function getArenaLeaderboard(');
    expect(gaStart).toBeGreaterThan(-1);
    const gaBody = src.slice(gaStart, src.indexOf('\n}\n', gaStart)).replace(/\s+/g, '');
    expect(gaBody).toContain('refreshArenaShared[format]()');
  });

  it('every leaderboard, arena, and deeds-board flight is constructed with the boardEpoch getter (rarity + count are not)', () => {
    // The whole hard-stop value is that each epoch-keyed flight is keyed on
    // boardEpoch, so a moderation bust evicts an in-flight joiner. Pin the epoch
    // getter on each construction: dropping it from any flight compiles and passes
    // every behavioral test that does not exercise THAT flight, so this structural
    // pin plus the per-flight eviction cases below together close the gap. The
    // closing paren is intentionally omitted: biome formats each flight multi-line
    // with a trailing comma (`() => boardEpoch,`), so the collapsed text is
    // `...boardEpoch,)`; matching up to `boardEpoch` pins the epoch getter without
    // depending on that punctuation.
    expect(compactSrc).toContain("singleFlight(()=>refreshLeaderboard('realm'),()=>boardEpoch");
    expect(compactSrc).toContain("singleFlight(()=>refreshLeaderboard('global'),()=>boardEpoch");
    expect(compactSrc).toContain(
      "singleFlight(()=>refreshGuildLeaderboard('realm'),()=>boardEpoch",
    );
    expect(compactSrc).toContain(
      "singleFlight(()=>refreshGuildLeaderboard('global'),()=>boardEpoch",
    );
    expect(compactSrc).toContain("singleFlight(()=>refreshArena('1v1'),()=>boardEpoch");
    expect(compactSrc).toContain("singleFlight(()=>refreshArena('2v2'),()=>boardEpoch");
    // The deeds Renown board flight wraps a NAMED function (no per-scope arrow),
    // pinned on the comment-stripped view: the board is character-faced, so its
    // plain flight let one post-bust read serve a just-banned account's character.
    expect(compactCode).toContain('singleFlight(refreshDeedsBoard,()=>boardEpoch');
    // Exactly seven epoch-keyed flights (player + guild, realm + global; arena
    // 1v1 + 2v2; the deeds board): the rarity and project-stats caches (not
    // bust-wired) must NOT gain the getter, and no board flight may lose it. The
    // count sits on the comment-stripped compactCode view so a commented-out
    // getter drops it.
    expect(compactCode.match(/\(\)=>boardEpoch/g)).toHaveLength(7);
  });

  it('a warm tick landing during an in-flight inline read runs the query once', async () => {
    const d = deferred<LifetimeXpLeaderRow[]>();
    dbMocks.topLifetimeXp.mockReturnValue(d.promise);
    const inline = seam.getLeaderboard('realm'); // inline read, in flight
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(1);
    const warm = seam.refreshLeaderboardShared.realm(); // a warm tick joins the same flight
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(1);
    d.resolve(xpRows('shared'));
    const [i, w] = await Promise.all([inline, warm]);
    expect(dbMocks.topLifetimeXp).toHaveBeenCalledTimes(1);
    expect(i).toBe(w); // both see the one flight's entries
    expect(i[0].name).toBe('shared-hero');
  });
});

// (E) BEHAVIORAL EPOCH / JOINER-EVICTION: a moderation bust that lands while a
// refresh is in flight bumps boardEpoch, so a post-bust reader starts a FRESH
// (delisting) read instead of joining the pre-ban flight, and the pre-ban flight's
// install is declined. Parametrized over ALL FOUR epoch-keyed leaderboard flights
// (player and guild, realm and global): the whole point of the change is that every
// one of them evicts the joiner on bust, so each is proven behaviorally, not just
// the realm-player flight. Distinct pre/post stub values discriminate which read
// each caller got. The arena (per format) and deeds Renown board cases below
// mirror the same five oracles; the deeds case is bespoke because that flight's
// refresh chains TWO db reads (the ranked roll-up, then the display-character
// fill), so the generic helper's single-mock shape does not fit it.
async function assertBustEvictsJoiner<R extends { name: string }, E extends { name: string }>(
  mock: Mock,
  rows: (tag: string) => R[],
  read: () => Promise<E[]>,
): Promise<void> {
  const preD = deferred<R[]>();
  const postD = deferred<R[]>();
  mock.mockImplementationOnce(() => preD.promise).mockImplementationOnce(() => postD.promise);

  const first = read(); // pre-ban flight (epoch E0), in flight
  expect(mock).toHaveBeenCalledTimes(1);

  seam.bustBoardCaches(); // boardEpoch++ (E1) and nulls the leaderboard/guild caches

  const second = read(); // cache null; E1 != E0 -> fresh flight, not a join
  // THE key oracle: the post-bust caller did NOT join the pre-ban flight; it
  // started its own read. This reds if THIS flight is not keyed on boardEpoch.
  expect(mock).toHaveBeenCalledTimes(2);

  // Resolve the POST-ban read FIRST, then the pre-ban read, so the pre-ban flight's
  // install is the LAST one attempted: with the capture-before-await guard in place
  // it is declined (the cache stays post-ban); WITHOUT the guard the pre-ban snapshot
  // would install last and the peek below would red. This makes the "never installs"
  // oracle independently decisive here, not only in the moderation source pin.
  postD.resolve(rows('postban'));
  preD.resolve(rows('preban'));
  const [r1, r2] = await Promise.all([first, second]);

  // The in-flight pre-ban caller still gets its own computed snapshot ...
  expect(r1[0].name).toBe(rows('preban')[0].name);
  // ... but the post-bust caller got the POST-ban read, never the pre-ban one.
  expect(r2[0].name).toBe(rows('postban')[0].name);
  expect(r2[0].name).not.toBe(rows('preban')[0].name);

  // The installed cache is the post-ban snapshot: the pre-ban flight's install was
  // declined by the epoch mismatch. A fresh in-TTL read serves the installed value
  // with NO further underlying read (call count stays 2).
  const peeked = await read();
  expect(mock).toHaveBeenCalledTimes(2);
  expect(peeked[0].name).toBe(rows('postban')[0].name);
}

describe('a moderation bust mid-flight evicts the in-flight joiner (epoch-keyed)', () => {
  it('player leaderboard (realm): post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    await assertBustEvictsJoiner(dbMocks.topLifetimeXp, xpRows, () => seam.getLeaderboard('realm'));
  });

  it('player leaderboard (global): post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    await assertBustEvictsJoiner(dbMocks.topLifetimeXp, xpRows, () =>
      seam.getLeaderboard('global'),
    );
  });

  it('guild leaderboard (realm): post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    await assertBustEvictsJoiner(dbMocks.topGuilds, guildRows, () =>
      seam.getGuildLeaderboard('realm'),
    );
  });

  it('guild leaderboard (global): post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    await assertBustEvictsJoiner(dbMocks.topGuilds, guildRows, () =>
      seam.getGuildLeaderboard('global'),
    );
  });

  it('arena ladder (1v1): post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    await assertBustEvictsJoiner(dbMocks.topArenaRatings, arenaRows, () =>
      seam.getArenaLeaderboard('1v1'),
    );
  });

  it('arena ladder (2v2): post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    await assertBustEvictsJoiner(dbMocks.topArenaRatings, arenaRows, () =>
      seam.getArenaLeaderboard('2v2'),
    );
  });

  it('deeds Renown board: post-bust caller re-reads, pre-ban snapshot never installs', async () => {
    // The board is character-faced (each entry is an account's display
    // character), so a post-bust reader joining the pre-ban flight would serve a
    // just-banned account's character for one read. Same five oracles as
    // assertBustEvictsJoiner, hand-rolled because this flight chains a second db
    // read (the display-character fill) after the ranked roll-up: the deferreds
    // control the roll-up, and the fill resolves live from whichever character
    // ids the resolved board names, discriminating pre from post.
    const preD = deferred<ReturnType<typeof deedsBoard>>();
    const postD = deferred<ReturnType<typeof deedsBoard>>();
    dbMocks.deedsBoardRanked
      .mockImplementationOnce(() => preD.promise)
      .mockImplementationOnce(() => postD.promise);
    dbMocks.charactersForDeedsBoard.mockImplementation(async (ids: readonly number[]) =>
      ids.map(deedsCharacter),
    );

    const first = seam.getDeedsLeaderboard(); // pre-ban flight (epoch E0), in flight
    expect(dbMocks.deedsBoardRanked).toHaveBeenCalledTimes(1);

    seam.bustBoardCaches(); // boardEpoch++ (E1) and nulls the deeds board cache

    const second = seam.getDeedsLeaderboard(); // cache null; E1 != E0 -> fresh flight
    // THE key oracle: the post-bust caller did NOT join the pre-ban flight; it
    // started its own read. This reds if THIS flight is not keyed on boardEpoch.
    expect(dbMocks.deedsBoardRanked).toHaveBeenCalledTimes(2);

    // Resolve the POST-ban roll-up FIRST so the pre-ban flight's install is the
    // LAST one attempted: the capture-before-await guard declines it, keeping the
    // post-ban snapshot installed (same decisiveness ordering as the helper).
    postD.resolve(deedsBoard('postban'));
    preD.resolve(deedsBoard('preban'));
    const [r1, r2] = await Promise.all([first, second]);

    // The in-flight pre-ban caller still gets its own computed snapshot ...
    expect(r1[0].name).toBe('preban-deedster');
    // ... but the post-bust caller got the POST-ban read, never the pre-ban one.
    expect(r2[0].name).toBe('postban-deedster');

    // The installed cache is the post-ban snapshot: a fresh in-TTL read serves it
    // with NO further roll-up read (call count stays 2).
    const peeked = await seam.getDeedsLeaderboard();
    expect(dbMocks.deedsBoardRanked).toHaveBeenCalledTimes(2);
    expect(peeked[0].name).toBe('postban-deedster');
  });

  it('a WARM arena cache is nulled by the bust: the next read re-queries, not a stale TTL serve', async () => {
    // getArenaLeaderboard checks only TTL freshness on a cache HIT, never the epoch,
    // so the WARM-cache null in bustBoardCaches is what makes an in-process ban
    // delist immediately instead of after a full TTL. The joiner-eviction cases
    // above start from a cold/in-flight cache; this one settles a warm cache first,
    // so it is the behavioral backstop for the source-pinned null-out slots.
    dbMocks.topArenaRatings
      .mockResolvedValueOnce(arenaRows('preban'))
      .mockResolvedValueOnce(arenaRows('postban'));
    const warm = await seam.getArenaLeaderboard('1v1');
    expect(warm[0].name).toBe('preban-champ');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(1);
    seam.bustBoardCaches(); // nulls arenaLeaderboardCache['1v1'] (and bumps boardEpoch)
    const after = await seam.getArenaLeaderboard('1v1');
    // Without the null-out slot the warm, still-in-TTL cache would serve 'preban'
    // with NO new read; the null forces a fresh delisting read.
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(2);
    expect(after[0].name).toBe('postban-champ');
  });
});

// (E2) PER-FORMAT ISOLATION: the arena cache is keyed by format, so filling one
// format's slot never serves another, and each format reads independently.
describe('the arena ladder is cached per format', () => {
  it('filling one format never serves another; each format reads its own slot', async () => {
    dbMocks.topArenaRatings
      .mockResolvedValueOnce(arenaRows('1v1'))
      .mockResolvedValueOnce(arenaRows('2v2'));
    const oneVone = await seam.getArenaLeaderboard('1v1');
    expect(oneVone[0].name).toBe('1v1-champ');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(1);
    // 2v2 is a cold miss on its OWN slot, so it triggers its own read; a warm 1v1
    // cache never serves 2v2.
    const twoVtwo = await seam.getArenaLeaderboard('2v2');
    expect(twoVtwo[0].name).toBe('2v2-champ');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(2);
    expect(dbMocks.topArenaRatings).toHaveBeenNthCalledWith(1, ARENA_LEADERBOARD_LIMIT, '1v1');
    expect(dbMocks.topArenaRatings).toHaveBeenNthCalledWith(2, ARENA_LEADERBOARD_LIMIT, '2v2');
    // A second 1v1 read is a warm hit: no third underlying read, and the 1v1 slot
    // still holds the 1v1 leaders (the 2v2 fill did not overwrite it).
    const oneVoneAgain = await seam.getArenaLeaderboard('1v1');
    expect(dbMocks.topArenaRatings).toHaveBeenCalledTimes(2);
    expect(oneVoneAgain[0].name).toBe('1v1-champ');
  });
});

// (E3) COLD-CACHE DEGRADATION: the project-stats count is single-key and, before
// its first success, a db error degrades to 0 rather than throwing (so the endpoint
// stays 200 where an unguarded read 500'd).
describe('the project-stats counts degrade to 0 on a cold-cache db error', () => {
  it('a cold-cache getAccountsCount error serves 0, not a throw', async () => {
    dbMocks.getCharactersCount.mockResolvedValueOnce(7);
    dbMocks.getAccountsCount.mockRejectedValueOnce(new Error('db down'));
    await expect(seam.getAccountsCreatedCount()).resolves.toBe(0);
  });

  it('a cold-cache getCharactersCount error serves 0, not a throw', async () => {
    dbMocks.getAccountsCount.mockResolvedValueOnce(7);
    dbMocks.getCharactersCount.mockRejectedValueOnce(new Error('db down'));
    await expect(seam.getCharactersCreatedCount()).resolves.toBe(0);
  });
});

// (F) HIDDEN-DEED STRIP AT REFRESH TIME: publicRarityPayload strips a hidden deed
// BEFORE the cache install, so the installed/cached payload already lacks it (not a
// strip applied at read time).
describe('hidden deeds are stripped at refresh time, before the cache install', () => {
  it('the installed rarity cache already lacks the hidden deed', async () => {
    dbMocks.deedRarityCounts.mockResolvedValueOnce({
      totalEligible: 100,
      earned: { [LISTABLE_DEED_ID]: 40, [HIDDEN_DEED_ID]: 3 },
    });
    const refreshed = await seam.getDeedsRarity();
    // The refresh output is already stripped ...
    expect(refreshed.earned).toHaveProperty(LISTABLE_DEED_ID, 40);
    expect(refreshed.earned).not.toHaveProperty(HIDDEN_DEED_ID);

    // ... and the INSTALLED cache is the SAME stripped object (the strip ran before
    // install, not at read): a fresh in-TTL read returns it verbatim, by reference,
    // with no second underlying read. Reference identity is what discriminates
    // strip-at-refresh (installed object already stripped) from strip-at-read.
    const peeked = await seam.getDeedsRarity();
    expect(dbMocks.deedRarityCounts).toHaveBeenCalledTimes(1);
    expect(peeked).toBe(refreshed);
    expect(peeked.earned).not.toHaveProperty(HIDDEN_DEED_ID);
  });
});

// (G) DUAL-ARM: the legacy /api/leaderboard branch and the RouteDef arm both resolve
// through the identical getLeaderboard / getGuildLeaderboard objects (injected once via
// configureLeaderboardRuntime), so the single-flight wrapping covers both arms with no
// per-arm read path to pin here. It is a pre-existing wiring property this change does
// not alter; the shared-flight delegation the getters themselves carry is pinned in (D).

// (H) TTL-UNCHANGED SOURCE PIN: the board-read TTLs are the byte-identical literals
// the caching change must not touch.
describe('the board-read TTLs and the arena depth', () => {
  const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8');
  it('pins DEEDS_RARITY_TTL_MS and LEADERBOARD_TTL_MS to their exact literals', () => {
    expect(src).toContain('DEEDS_RARITY_TTL_MS = 5 * 60_000');
    expect(src).toContain('LEADERBOARD_TTL_MS = 30_000');
  });

  it('pins the project-stats 60s TTL and the arena ladder reuse of LEADERBOARD_TTL_MS', () => {
    // The project-stats count carries its own 60s TTL (the D11 marketing-counter
    // exception), built into the cache with the named constant, never a bare literal.
    expect(src).toContain('PROJECT_STATS_TTL_MS = 60_000');
    expect(src.replace(/\s+/g, '')).toContain('ttlMs:PROJECT_STATS_TTL_MS');
    // The arena ladder reuses the 30s board TTL (no separate arena TTL constant),
    // so its freshness window can never silently drift from the other boards.
    const gaStart = src.indexOf('async function getArenaLeaderboard(');
    expect(gaStart).toBeGreaterThan(-1);
    const gaBody = src.slice(gaStart, src.indexOf('\n}\n', gaStart));
    expect(gaBody).toContain('LEADERBOARD_TTL_MS');
  });

  it('pins the arena ladder depth to the single ARENA_LEADERBOARD_LIMIT source (20)', () => {
    // The ladder depth lives once in server/leaderboard.ts and readArenaLeaderboard
    // is the only caller of the underlying read, so main.ts carries no second 20.
    expect(ARENA_LEADERBOARD_LIMIT).toBe(20);
    expect(src).not.toContain('topArenaRatings(20');
  });
});
