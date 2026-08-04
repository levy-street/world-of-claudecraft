// The Phase 9 keyed bounded cache for the GET /api/discord status core
// (server/discord_status_cache.ts): the KeyedCachedRead mechanism (miss/hit,
// TTL on an injected clock, per-key isolation, the in-flight joiner arm, and
// the entry bound REACHED with the survivors pinned), the process singleton
// (reader wiring, env-driven ttl/cap, busts), and the structural pin that both
// /api/discord arms still share the one payload assembly. The handler-level
// arms (zero-query cache hits, busts driven through the real write paths) live
// in tests/discord_server.test.ts and tests/discord_db.test.ts, on the rigs
// those suites already use.
//
// This file deliberately never imports server/discord: the first describe pins
// the unconfigured-reader guard, which is observable only before some module
// has installed the production reader.

import { describe, expect, it, vi } from 'vitest';
import {
  bustAllDiscordStatus,
  bustDiscordStatus,
  configureDiscordStatusCache,
  DISCORD_STATUS_CACHE_MAX_ENTRIES_DEFAULT,
  DISCORD_STATUS_CACHE_TTL_MS_DEFAULT,
  type DiscordStatusCore,
  discordStatusCacheSize,
  discordStatusCacheStats,
  KeyedCachedRead,
  positiveIntFromEnv,
  readDiscordStatusCore,
  resetDiscordStatusCacheForTests,
} from '../../server/discord_status_cache';

function core(overrides: Partial<DiscordStatusCore> = {}): DiscordStatusCore {
  return {
    link: null,
    points: 0,
    lifetimePoints: 0,
    claimedSwagIds: [],
    passwordSet: true,
    ...overrides,
  };
}

// FIRST on purpose (see the file header): once any test configures a reader
// there is no way back to the never-configured state in this module instance.
describe('singleton before any reader is configured', () => {
  it('rejects a read instead of silently serving nothing, and busts are no-ops', async () => {
    resetDiscordStatusCacheForTests();
    await expect(readDiscordStatusCore(1)).rejects.toThrow(
      'discord status cache has no configured reader',
    );
    // A bust before the cache exists must not throw (write paths can run in
    // processes that never serve /api/discord).
    bustDiscordStatus(1);
    bustAllDiscordStatus();
    expect(discordStatusCacheSize()).toBe(0);
    // The cold-fallback branch of the stats accessor: all zeros, no throw.
    expect(discordStatusCacheStats()).toEqual({
      reads: 0,
      refreshes: 0,
      evictions: 0,
      busts: 0,
      entries: 0,
    });
  });
});

describe('KeyedCachedRead mechanism', () => {
  it('serves the second read inside the TTL from cache and refreshes past it', async () => {
    let t = 0;
    let refreshes = 0;
    const cache = new KeyedCachedRead<string>(
      async (key) => {
        refreshes++;
        return `k${key}r${refreshes}`;
      },
      { ttlMs: 1000, maxEntries: 10, now: () => t },
    );
    expect(await cache.read(1)).toBe('k1r1');
    t = 999;
    expect(await cache.read(1)).toBe('k1r1');
    expect(refreshes).toBe(1);
    t = 1000;
    expect(await cache.read(1)).toBe('k1r2');
    expect(refreshes).toBe(2);
  });

  it('never serves one key a value refreshed for another (cross-account isolation)', async () => {
    const reads = new Map<number, number>();
    const cache = new KeyedCachedRead<string>(
      async (key) => {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return `account-${key}`;
      },
      { ttlMs: 60_000, maxEntries: 10, now: () => 0 },
    );
    expect(await cache.read(1)).toBe('account-1');
    expect(await cache.read(2)).toBe('account-2');
    expect(await cache.read(1)).toBe('account-1');
    expect(await cache.read(2)).toBe('account-2');
    expect(reads.get(1)).toBe(1);
    expect(reads.get(2)).toBe(1);
    // Busting one key leaves the other's cached entry untouched.
    cache.bust(1);
    expect(await cache.read(2)).toBe('account-2');
    expect(reads.get(2)).toBe(1);
    expect(await cache.read(1)).toBe('account-1');
    expect(reads.get(1)).toBe(2);
  });

  it('collapses concurrent readers of one key into a single flight', async () => {
    let refreshes = 0;
    const gates: Array<(v: string) => void> = [];
    const cache = new KeyedCachedRead<string>(
      (key) =>
        new Promise((resolve) => {
          refreshes++;
          gates.push((v) => resolve(`k${key}:${v}`));
        }),
      { ttlMs: 1000, maxEntries: 10, now: () => 0 },
    );
    const a = cache.read(7);
    const b = cache.read(7);
    expect(refreshes).toBe(1);
    gates[0]('shared');
    expect(await a).toBe('k7:shared');
    expect(await b).toBe('k7:shared');
  });

  it('a bust during an in-flight refresh never hands a post-bust reader the pre-bust flight', async () => {
    const gates: Array<(v: string) => void> = [];
    const cache = new KeyedCachedRead<string>(() => new Promise((resolve) => gates.push(resolve)), {
      ttlMs: 60_000,
      maxEntries: 10,
      now: () => 0,
    });
    const preBust = cache.read(1); // flight 1 opens
    cache.bust(1); // bust lands mid-flight
    const postBust = cache.read(1); // must open flight 2, never join flight 1
    expect(gates).toHaveLength(2);
    gates[1]('post-bust');
    gates[0]('pre-bust');
    // The post-bust reader sees post-bust data; the pre-bust joiner keeps the
    // value its own flight computed (cached_read's documented contract).
    await expect(postBust).resolves.toBe('post-bust');
    await expect(preBust).resolves.toBe('pre-bust');
    // And the value INSTALLED for later readers is the post-bust one, even
    // though the stale flight settled after it.
    await expect(cache.read(1)).resolves.toBe('post-bust');
  });

  it('stale-serves a warm entry while its refresh fails, and a cold key still rejects', async () => {
    // The brownout contract the module header states (it CHANGES this
    // endpoint's failure behavior, so it gets its own decisive arm): a warm
    // entry answers with a value of unbounded age while refreshes fail, which
    // requires the failing entry to STAY INSTALLED in the map (a read() that
    // dropped a failing key would destroy stale-serve and this arm reds it).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let t = 0;
      let healthy = true;
      const cache = new KeyedCachedRead<string>(
        async (key) => {
          if (!healthy) throw new Error(`refresh down for k${key}`);
          return `k${key}-fresh`;
        },
        { ttlMs: 1000, maxEntries: 10, now: () => t },
      );
      expect(await cache.read(1)).toBe('k1-fresh');
      healthy = false;
      t = 5000;
      expect(await cache.read(1)).toBe('k1-fresh');
      t = 10_000;
      expect(await cache.read(1)).toBe('k1-fresh');
      expect(cache.size()).toBe(1);
      // cached_read's visibility contract: ONE warn per failure streak (the
      // second failing read above is latched silent, so exactly one).
      expect(warnSpy).toHaveBeenCalledTimes(1);
      // A cold key has nothing to stale-serve: the failure surfaces raw, and
      // the value-less entry RELEASES its cap slot at settle (only the warm
      // entry remains), so a brownout cannot fill the map with dead weight.
      await expect(cache.read(2)).rejects.toThrow('refresh down for k2');
      expect(cache.size()).toBe(1);
      healthy = true;
      await expect(cache.read(2)).resolves.toBe('k2-fresh');
      // The stale entry heals on its next read too, not only new keys.
      await expect(cache.read(1)).resolves.toBe('k1-fresh');
      // And the streak latch RESET on that successful refresh: a second
      // brownout warns again rather than staying silenced forever.
      healthy = false;
      t = 20_000;
      expect(await cache.read(1)).toBe('k1-fresh');
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('failed mints never accumulate as dead weight (brownout churn below the cap)', async () => {
    // The slot-release rule's no-accumulation half: sequential failing mints
    // below the cap each release at settle, so the map never fills with
    // value-less entries and the warm snapshot is never displaced. Keeping
    // failed mints in the map would fill the second slot at the first failure
    // and evict key 1 at the second (size 2 at the cap when key 3 mints), so
    // this arm reds on the refetch without the release.
    // (No warn spy: a cold rejection never warns, only a stale-serve does.)
    const reads = new Map<number, number>();
    let healthy = true;
    const cache = new KeyedCachedRead<string>(
      async (key) => {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        if (!healthy) throw new Error(`down for k${key}`);
        return `k${key}`;
      },
      { ttlMs: 60_000, maxEntries: 2, now: () => 0 },
    );
    expect(await cache.read(1)).toBe('k1');
    healthy = false;
    for (const key of [2, 3, 4, 5]) {
      await expect(cache.read(key)).rejects.toThrow(`down for k${key}`);
    }
    expect(cache.size()).toBe(1);
    // The warm snapshot survived the churn: still served from cache.
    expect(await cache.read(1)).toBe('k1');
    expect(reads.get(1)).toBe(1);
  });

  it('AT the cap a failing mint transiently displaces exactly the coldest entry', async () => {
    // The honest other half, stated in the module header: the bound is hard
    // on the way in (R11), so a mint that later fails has already run the
    // insert-side eviction. One warm entry (the coldest) is displaced per
    // failing mint at the cap; the failed mint itself does not stay, and the
    // other warm entry is untouched.
    const reads = new Map<number, number>();
    let healthy = true;
    const cache = new KeyedCachedRead<string>(
      async (key) => {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        if (!healthy) throw new Error(`down for k${key}`);
        return `k${key}`;
      },
      { ttlMs: 60_000, maxEntries: 2, now: () => 0 },
    );
    expect(await cache.read(1)).toBe('k1');
    expect(await cache.read(2)).toBe('k2');
    healthy = false;
    await expect(cache.read(3)).rejects.toThrow('down for k3');
    // Key 1 (coldest) was displaced by the failing mint's transient slot; the
    // slot itself was released at settle, so only key 2 remains.
    expect(cache.size()).toBe(1);
    healthy = true;
    expect(await cache.read(2)).toBe('k2');
    expect(reads.get(2)).toBe(1);
    expect(await cache.read(1)).toBe('k1');
    expect(reads.get(1)).toBe(2);
  });

  it('overlapping failing mints can displace the warm entry below the value cap', async () => {
    // The concurrent brownout shape, pinned so the header's honest cost
    // statement has a test behind it: each in-flight mint occupies its slot
    // from the synchronous insert until its own settle, so failing mints that
    // OVERLAP evict each other and the warm entry even though the map never
    // holds more than one VALUE. The sequential sibling arm's warm-survival
    // promise holds only below the cap; this is the boundary of it.
    const reads = new Map<number, number>();
    let healthy = true;
    const cache = new KeyedCachedRead<string>(
      async (key) => {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        if (!healthy) throw new Error(`down for k${key}`);
        return `k${key}`;
      },
      { ttlMs: 60_000, maxEntries: 2, now: () => 0 },
    );
    expect(await cache.read(1)).toBe('k1');
    healthy = false;
    await Promise.all([2, 3, 4, 5].map((key) => cache.read(key).catch(() => 'rejected')));
    // The overlapping inserts evicted keys 1 to 3 on the way in; the two
    // still-in-flight mints released at settle, leaving nothing.
    expect(cache.size()).toBe(0);
    healthy = true;
    expect(await cache.read(1)).toBe('k1');
    expect(reads.get(1)).toBe(2);
  });

  it('holds the bound AT the cap and evicts the least-recently-read key', async () => {
    let refreshes = 0;
    const cache = new KeyedCachedRead<number>(
      async (key) => {
        refreshes++;
        return key * 10;
      },
      { ttlMs: 60_000, maxEntries: 3, now: () => 0 },
    );
    await cache.read(1);
    await cache.read(2);
    await cache.read(3);
    expect(cache.size()).toBe(3);
    await cache.read(1); // LRU touch: key 2 is now the coldest
    await cache.read(4); // past the cap: evicts exactly one
    expect(cache.size()).toBe(3);
    expect(refreshes).toBe(4);
    // Survivors pinned: 1 (touched), 3, and 4 are still served from cache...
    await cache.read(1);
    await cache.read(3);
    await cache.read(4);
    expect(refreshes).toBe(4);
    // ...and the evicted key really was 2: reading it refetches.
    await cache.read(2);
    expect(refreshes).toBe(5);
    expect(cache.size()).toBe(3);
  });

  it('bustAll drops every entry', async () => {
    let refreshes = 0;
    const cache = new KeyedCachedRead<number>(
      async (key) => {
        refreshes++;
        return key;
      },
      { ttlMs: 60_000, maxEntries: 10, now: () => 0 },
    );
    await cache.read(1);
    await cache.read(2);
    cache.bustAll();
    expect(cache.size()).toBe(0);
    await cache.read(1);
    await cache.read(2);
    expect(refreshes).toBe(4);
  });

  it('counts reads, refresh flights, cap evictions, and busts separately', async () => {
    let t = 0;
    const cache = new KeyedCachedRead<number>(async (key) => key, {
      ttlMs: 1000,
      maxEntries: 2,
      now: () => t,
    });
    await cache.read(1); // refresh 1 (cold)
    await cache.read(1); // hit: read counted, no refresh
    t = 1000;
    await cache.read(1); // refresh 2 (TTL expiry, no eviction, no bust)
    await cache.read(2); // refresh 3 (cold)
    await cache.read(3); // refresh 4 (cold) + evicts 1 at the cap
    cache.bust(2); // bust counted...
    cache.bust(99); // ...but a miss is not
    await cache.read(2); // refresh 5 (post-bust)
    expect(cache.stats()).toEqual({
      reads: 6,
      refreshes: 5,
      evictions: 1,
      busts: 1,
      entries: 2,
    });
    cache.bustAll();
    expect(cache.stats().busts).toBe(3);
    expect(cache.stats().entries).toBe(0);
  });

  it('refuses a non-positive ttl or cap loudly at construction', () => {
    const refresh = async () => 0;
    expect(() => new KeyedCachedRead(refresh, { ttlMs: 0, maxEntries: 5 })).toThrow(
      'ttlMs must be positive',
    );
    expect(() => new KeyedCachedRead(refresh, { ttlMs: 1000, maxEntries: 0 })).toThrow(
      'maxEntries must be a positive integer',
    );
    expect(() => new KeyedCachedRead(refresh, { ttlMs: 1000, maxEntries: 1.5 })).toThrow(
      'maxEntries must be a positive integer',
    );
  });
});

describe('positiveIntFromEnv', () => {
  it('falls back for missing, empty, non-numeric, and non-positive alike', () => {
    // Number('') is 0, so a blank .env line must NOT become a zero TTL.
    expect(positiveIntFromEnv(undefined, 15_000)).toBe(15_000);
    expect(positiveIntFromEnv('', 15_000)).toBe(15_000);
    expect(positiveIntFromEnv('abc', 15_000)).toBe(15_000);
    expect(positiveIntFromEnv('0', 15_000)).toBe(15_000);
    expect(positiveIntFromEnv('-5', 15_000)).toBe(15_000);
    expect(positiveIntFromEnv('0.4', 15_000)).toBe(15_000);
    expect(positiveIntFromEnv('Infinity', 15_000)).toBe(15_000);
  });

  it('passes a valid value through, floored to an integer, however small', () => {
    expect(positiveIntFromEnv('1', 15_000)).toBe(1);
    expect(positiveIntFromEnv('2.9', 15_000)).toBe(2);
    expect(positiveIntFromEnv('600000', 15_000)).toBe(600_000);
  });

  it('pins the documented defaults to literals', () => {
    // The DEPLOY.md rows state these values; a drifted constant breaks the
    // operator docs silently, so the pin is against literals, never the
    // constant compared with itself.
    expect(DISCORD_STATUS_CACHE_TTL_MS_DEFAULT).toBe(15_000);
    expect(DISCORD_STATUS_CACHE_MAX_ENTRIES_DEFAULT).toBe(2_000);
  });
});

describe('process singleton wiring', () => {
  function installCountingReader(): Map<number, number> {
    const reads = new Map<number, number>();
    configureDiscordStatusCache(async (accountId) => {
      reads.set(accountId, (reads.get(accountId) ?? 0) + 1);
      return core({ points: accountId });
    });
    return reads;
  }

  it('caches per account, busts one account, and busts all', async () => {
    const reads = installCountingReader();
    resetDiscordStatusCacheForTests();
    expect((await readDiscordStatusCore(1)).points).toBe(1);
    expect((await readDiscordStatusCore(2)).points).toBe(2);
    await readDiscordStatusCore(1);
    expect(reads.get(1)).toBe(1);
    expect(discordStatusCacheSize()).toBe(2);
    bustDiscordStatus(1);
    expect(discordStatusCacheSize()).toBe(1);
    await readDiscordStatusCore(1);
    expect(reads.get(1)).toBe(2);
    expect(reads.get(2)).toBe(1);
    bustAllDiscordStatus();
    expect(discordStatusCacheSize()).toBe(0);
    await readDiscordStatusCore(2);
    expect(reads.get(2)).toBe(2);
    // The built-instance branch of the stats accessor reports the activity
    // above: 5 reads, 4 refresh flights (2 cold + 1 post-bust + 1 post-bustAll),
    // 3 busted entries (bust(1) + bustAll over two), no cap eviction.
    expect(discordStatusCacheStats()).toEqual({
      reads: 5,
      refreshes: 4,
      evictions: 0,
      busts: 3,
      entries: 1,
    });
  });

  it('drives the TTL from an injected clock via the test reset hook', async () => {
    const reads = installCountingReader();
    let t = 0;
    resetDiscordStatusCacheForTests({ ttlMs: 1000, now: () => t });
    await readDiscordStatusCore(5);
    t = 999;
    await readDiscordStatusCore(5);
    expect(reads.get(5)).toBe(1);
    t = 1000;
    await readDiscordStatusCore(5);
    expect(reads.get(5)).toBe(2);
  });

  it('honors DISCORD_STATUS_CACHE_TTL_MS from the environment', async () => {
    const reads = installCountingReader();
    // The literal env key IS the operator contract (D13); the test sets it by
    // name so a renamed lookup in the module goes red here.
    process.env.DISCORD_STATUS_CACHE_TTL_MS = '500';
    try {
      let t = 0;
      resetDiscordStatusCacheForTests({ now: () => t });
      await readDiscordStatusCore(9);
      t = 499;
      await readDiscordStatusCore(9);
      expect(reads.get(9)).toBe(1);
      t = 500;
      await readDiscordStatusCore(9);
      expect(reads.get(9)).toBe(2);
    } finally {
      delete process.env.DISCORD_STATUS_CACHE_TTL_MS;
      resetDiscordStatusCacheForTests();
    }
  });

  it('honors DISCORD_STATUS_CACHE_MAX_ENTRIES from the environment', async () => {
    const reads = installCountingReader();
    process.env.DISCORD_STATUS_CACHE_MAX_ENTRIES = '2';
    try {
      resetDiscordStatusCacheForTests();
      await readDiscordStatusCore(1);
      await readDiscordStatusCore(2);
      await readDiscordStatusCore(3); // evicts account 1
      expect(discordStatusCacheSize()).toBe(2);
      // The re-minted entry refreshes under ITS OWN key and hands back its own
      // value (the last shape of eviction aliasing: a re-mint serving another
      // key's core would return 2 or 3 here).
      expect((await readDiscordStatusCore(1)).points).toBe(1);
      expect(reads.get(1)).toBe(2);
    } finally {
      delete process.env.DISCORD_STATUS_CACHE_MAX_ENTRIES;
      resetDiscordStatusCacheForTests();
    }
  });
});

describe('both /api/discord arms share the one payload assembly', () => {
  // The dual-arm rule (D9) holds by CONSTRUCTION for this endpoint: both arms
  // call handleDiscordStatus, whose body is the tested shared function, so the
  // cache covers them identically. These pins are the drift tripwire: they say
  // only that each arm routes through the shared helper (the behavioral claims
  // live in tests/discord_server.test.ts against the helper itself), which is
  // the one shape a source pin can carry honestly.
  it('the legacy arm in main.ts delegates GET /api/discord to handleDiscordStatus', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../server/main.ts', import.meta.url), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    // Bounded to the GET arm: the guard forbids crossing into another
    // req.method dispatch block, so this cannot match via the DELETE arm.
    expect(src).toMatch(
      /if \(req\.method === 'GET' && url === '\/api\/discord'\) \{(?:(?!req\.method)[\s\S]){0,400}?return handleDiscordStatus\(req, res, accountId\);/,
    );
    // Exactly one call site: a second, diverging status assembly in main.ts
    // would slip a bare presence/coverage pin.
    expect(src.split('handleDiscordStatus(')).toHaveLength(2);
    // The legacy arm's 15/min rate guard sits immediately BEFORE the shared
    // handler, unchanged by the caching (caching is not a reason to loosen
    // it). The RouteDef arm's guard is pinned behaviorally by the 429 arms in
    // tests/server/discord.test.ts.
    expect(src).toContain(
      "if (!discordRateLimited(req, accountId).allowed) return json(res, 429, { error: 'rate limited' }); return handleDiscordStatus(req, res, accountId);",
    );
    // Byte-exact (normalized) pin of the WHOLE frozen GET arm. The regex above
    // tolerates up to 400 inserted characters before the delegate line, so a
    // divergent early return slipped in after the brace would keep it green
    // while bypassing the cache. This arm is frozen legacy surface (D9), so
    // the full-block literal is the honest pin: ANY insertion reds it.
    expect(src).toContain(
      "if (req.method === 'GET' && url === '/api/discord') { " +
        'const accountId = await bearerActiveAccount(req, res); ' +
        'if (accountId === null) return; ' +
        'if (!discordRateLimited(req, accountId).allowed) ' +
        "return json(res, 429, { error: 'rate limited' }); " +
        'return handleDiscordStatus(req, res, accountId); }',
    );
  });

  it('the RouteDef arm delegates to the same shared handler', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../server/discord.ts', import.meta.url), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    expect(src).toContain(
      'async function discordStatusHandler(ctx: Ctx): Promise<void> { return handleDiscordStatus(ctx.req, ctx.res, ctxAccountId(ctx)); }',
    );
  });
});
