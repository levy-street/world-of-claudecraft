// The keyed, bounded TTL cache for the public lifetime-XP rank read
// (server/character_rank_cache.ts): the process singleton (reader wiring,
// env-driven ttl/cap, busts), and the module-specific contract (a moderation
// action must drop the WHOLE cache, not one key). The generic KeyedCachedRead
// mechanism itself (miss/hit, TTL, single-flight, stale-on-error, eviction,
// the lost-bust race) is exhaustively pinned once in
// tests/server/discord_status_cache.test.ts against the same class this
// module reuses; this file does not re-pin it.
//
// This file deliberately never imports server/db: the first describe pins the
// unconfigured-reader guard, which is observable only before some module has
// installed the production reader (mirrors discord_status_cache.test.ts).

import { describe, expect, it } from 'vitest';
import {
  bustAllLifetimeXpRankCache,
  bustLifetimeXpRankCache,
  configureLifetimeXpRankCache,
  LIFETIME_XP_RANK_CACHE_MAX_ENTRIES_DEFAULT,
  LIFETIME_XP_RANK_CACHE_TTL_MS_DEFAULT,
  type LifetimeXpRank,
  lifetimeXpRankCacheSize,
  lifetimeXpRankCacheStats,
  positiveIntFromEnv,
  readLifetimeXpRankForCharacter,
  resetLifetimeXpRankCacheForTests,
} from '../../server/character_rank_cache';

describe('singleton before any reader is configured', () => {
  it('rejects a read instead of silently serving nothing, and busts are no-ops', async () => {
    resetLifetimeXpRankCacheForTests();
    await expect(readLifetimeXpRankForCharacter(1)).rejects.toThrow(
      'lifetime XP rank cache has no configured reader',
    );
    bustLifetimeXpRankCache(1);
    bustAllLifetimeXpRankCache();
    expect(lifetimeXpRankCacheSize()).toBe(0);
    expect(lifetimeXpRankCacheStats()).toEqual({
      reads: 0,
      refreshes: 0,
      evictions: 0,
      busts: 0,
      entries: 0,
    });
  });
});

describe('positiveIntFromEnv', () => {
  it('falls back for missing, empty, non-numeric, and non-positive alike', () => {
    expect(positiveIntFromEnv(undefined, 30_000)).toBe(30_000);
    expect(positiveIntFromEnv('', 30_000)).toBe(30_000);
    expect(positiveIntFromEnv('abc', 30_000)).toBe(30_000);
    expect(positiveIntFromEnv('0', 30_000)).toBe(30_000);
    expect(positiveIntFromEnv('-5', 30_000)).toBe(30_000);
  });

  it('pins the documented defaults to literals', () => {
    // TTL matches LEADERBOARD_TTL_MS (server/main.ts): the same underlying
    // metric already tolerates that staleness on the boards.
    expect(LIFETIME_XP_RANK_CACHE_TTL_MS_DEFAULT).toBe(30_000);
    expect(LIFETIME_XP_RANK_CACHE_MAX_ENTRIES_DEFAULT).toBe(5_000);
  });
});

describe('process singleton wiring', () => {
  function installCountingReader(): Map<number, number> {
    const reads = new Map<number, number>();
    configureLifetimeXpRankCache(async (characterId) => {
      reads.set(characterId, (reads.get(characterId) ?? 0) + 1);
      const rank: LifetimeXpRank = { rank: characterId, total: 100 };
      return rank;
    });
    return reads;
  }

  it('caches per character, busts one character, and busts all', async () => {
    const reads = installCountingReader();
    resetLifetimeXpRankCacheForTests();
    expect((await readLifetimeXpRankForCharacter(1))?.rank).toBe(1);
    expect((await readLifetimeXpRankForCharacter(2))?.rank).toBe(2);
    await readLifetimeXpRankForCharacter(1);
    expect(reads.get(1)).toBe(1);
    expect(lifetimeXpRankCacheSize()).toBe(2);
    bustLifetimeXpRankCache(1);
    expect(lifetimeXpRankCacheSize()).toBe(1);
    await readLifetimeXpRankForCharacter(1);
    expect(reads.get(1)).toBe(2);
    expect(reads.get(2)).toBe(1);
    bustAllLifetimeXpRankCache();
    expect(lifetimeXpRankCacheSize()).toBe(0);
    await readLifetimeXpRankForCharacter(2);
    expect(reads.get(2)).toBe(2);
  });

  it('drives the TTL from an injected clock via the test reset hook', async () => {
    const reads = installCountingReader();
    let t = 0;
    resetLifetimeXpRankCacheForTests({ ttlMs: 1000, now: () => t });
    await readLifetimeXpRankForCharacter(5);
    t = 999;
    await readLifetimeXpRankForCharacter(5);
    expect(reads.get(5)).toBe(1);
    t = 1000;
    await readLifetimeXpRankForCharacter(5);
    expect(reads.get(5)).toBe(2);
  });

  it('honors LIFETIME_XP_RANK_CACHE_TTL_MS from the environment', async () => {
    const reads = installCountingReader();
    process.env.LIFETIME_XP_RANK_CACHE_TTL_MS = '500';
    try {
      let t = 0;
      resetLifetimeXpRankCacheForTests({ now: () => t });
      await readLifetimeXpRankForCharacter(9);
      t = 499;
      await readLifetimeXpRankForCharacter(9);
      expect(reads.get(9)).toBe(1);
      t = 500;
      await readLifetimeXpRankForCharacter(9);
      expect(reads.get(9)).toBe(2);
    } finally {
      delete process.env.LIFETIME_XP_RANK_CACHE_TTL_MS;
      resetLifetimeXpRankCacheForTests();
    }
  });

  it('honors LIFETIME_XP_RANK_CACHE_MAX_ENTRIES from the environment, never growing past it', async () => {
    const reads = installCountingReader();
    process.env.LIFETIME_XP_RANK_CACHE_MAX_ENTRIES = '3';
    try {
      resetLifetimeXpRankCacheForTests();
      // Drive well past the cap's worth of distinct keys through the cache
      // (server/CLAUDE.md's caching rule: a bounded key space still needs a
      // decisive size-never-exceeds-the-cap test).
      for (let characterId = 1; characterId <= 50; characterId++) {
        await readLifetimeXpRankForCharacter(characterId);
        expect(lifetimeXpRankCacheSize()).toBeLessThanOrEqual(3);
      }
      expect(lifetimeXpRankCacheSize()).toBe(3);
      // The re-minted entry refreshes under ITS OWN key and hands back its own
      // value (an eviction-aliasing bug would return another key's rank here).
      expect((await readLifetimeXpRankForCharacter(1))?.rank).toBe(1);
      expect(reads.get(1)).toBe(2);
    } finally {
      delete process.env.LIFETIME_XP_RANK_CACHE_MAX_ENTRIES;
      resetLifetimeXpRankCacheForTests();
    }
  });

  it('caches a null result (an unknown or delisted character) same as a value', async () => {
    let reads = 0;
    configureLifetimeXpRankCache(async () => {
      reads++;
      return null;
    });
    resetLifetimeXpRankCacheForTests();
    expect(await readLifetimeXpRankForCharacter(1)).toBeNull();
    expect(await readLifetimeXpRankForCharacter(1)).toBeNull();
    expect(reads).toBe(1);
  });
});
