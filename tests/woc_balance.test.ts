import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';
import {
  CACHE_TTL_MS,
  WOC_BALANCE_CACHE_MAX_ENTRIES,
  fetchWocBalance,
  holderInfoForPubkey,
  cachedWocBalance,
  handleWocBalance,
  parseWocBalanceQuery,
  resetWocBalanceCacheForTests,
  wocBalanceCacheStats,
} from '../server/woc_balance';

// A real 32-byte base58 Solana address (passes isSolanaAddress).
const VALID_ADDR = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

function makeRes(): any {
  return {
    statusCode: 0, body: '',
    writeHead(s: number) { this.statusCode = s; return this; },
    end(d: string) { this.body = d ?? ''; return this; },
  };
}
const callBalance = async (owner: string, fresh = false) => {
  const res = makeRes();
  await handleWocBalance(res, owner, fresh);
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : {} };
};

// holderInfoForPubkey returns { tier, balance }; these cases assert the tier.
const holderTierForPubkey = async (pubkey: string) => (await holderInfoForPubkey(pubkey)).tier;

// Mock the Solana JSON-RPC: return token accounts whose uiAmounts we control.
function mockRpc(uiAmounts: number[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: { value: uiAmounts.map((ui) => ({ account: { data: { parsed: { info: { tokenAmount: { uiAmount: ui } } } } } })) },
    }),
  }));
}

type MockTokenAmount = {
  uiAmount?: unknown;
  uiAmountString?: unknown;
  amount?: unknown;
  decimals?: unknown;
};

function mockTokenAmountRpc(tokenAmounts: MockTokenAmount[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: {
        value: tokenAmounts.map((tokenAmount) => ({
          account: { data: { parsed: { info: { tokenAmount } } } },
        })),
      },
    }),
  }));
}

// Mock the RPC with an arbitrary, possibly-malformed, parsed JSON body. Used to
// drive the defensive parsing paths in fetchWocBalance (missing/typeless fields).
function mockRawRpc(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

afterEach(() => {
  resetWocBalanceCacheForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('server import boundary', () => {
  it('keeps holder tier math out of src/ui imports', () => {
    const source = readFileSync(new URL('../server/woc_balance.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/src\/ui\/holder_tier|ui\/holder_tier/);
    expect(source).toContain('../src/sim/holder_tier');
  });
});

describe('fetchWocBalance', () => {
  it('sums uiAmount across all of the owner’s token accounts', async () => {
    vi.stubGlobal('fetch', mockRpc([1000, 250.5]));
    expect(await fetchWocBalance('AAA')).toBe(1250.5);
  });

  it('uses uiAmountString when uiAmount is null', async () => {
    vi.stubGlobal('fetch', mockTokenAmountRpc([
      { uiAmount: null, uiAmountString: '1000.25' },
      { uiAmount: null, uiAmountString: '0.75' },
    ]));
    expect(await fetchWocBalance('AA2')).toBe(1001);
  });

  it('uses raw amount and decimals when uiAmount is null and uiAmountString is unavailable', async () => {
    vi.stubGlobal('fetch', mockTokenAmountRpc([
      { uiAmount: null, amount: '123456789', decimals: 6 },
      { uiAmount: null, amount: '1000000000000000000', decimals: 9 },
    ]));
    expect(await fetchWocBalance('AA3')).toBeCloseTo(1_000_000_123.456789, 6);
  });

  it('falls back from an invalid uiAmountString to raw amount and decimals', async () => {
    vi.stubGlobal('fetch', mockTokenAmountRpc([
      { uiAmount: null, uiAmountString: 'not-a-number', amount: '2500000', decimals: 6 },
    ]));
    expect(await fetchWocBalance('AA4')).toBe(2.5);
  });

  it('returns null on a non-ok RPC response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await fetchWocBalance('BBB')).toBeNull();
  });

  it('returns null when the RPC throws (no token accounts / network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await fetchWocBalance('CCC')).toBeNull();
  });

  it('returns 0 for an owner with no token accounts (empty value array)', async () => {
    vi.stubGlobal('fetch', mockRpc([]));
    expect(await fetchWocBalance('DDD')).toBe(0);
  });

  it('returns null when result.value is not an array', async () => {
    vi.stubGlobal('fetch', mockRawRpc({ result: { value: 'not-an-array' } }));
    expect(await fetchWocBalance('EEE')).toBeNull();
  });

  it('returns null when result.value is missing entirely', async () => {
    vi.stubGlobal('fetch', mockRawRpc({ result: {} }));
    expect(await fetchWocBalance('FFF')).toBeNull();
  });

  it('skips a token account missing tokenAmount/uiAmount (summed as 0)', async () => {
    vi.stubGlobal('fetch', mockRawRpc({
      result: {
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 42 } } } } } },
          { account: { data: { parsed: { info: {} } } } }, // no tokenAmount → skipped
          {}, // no account at all → skipped
        ],
      },
    }));
    expect(await fetchWocBalance('GGG')).toBe(42);
  });

  it('skips malformed token amount fields, summing only parseable balances', async () => {
    vi.stubGlobal('fetch', mockRawRpc({
      result: {
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: '500' } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: null } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { uiAmountString: '1e9' } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { amount: '2500000.5', decimals: 6 } } } } } },
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 7.5 } } } } } },
        ],
      },
    }));
    expect(await fetchWocBalance('HHH')).toBe(7.5);
  });
});

describe('holderTierForPubkey', () => {
  it('maps the on-chain balance to a tier index', async () => {
    vi.stubGlobal('fetch', mockRpc([10_000])); // Gilded
    expect(await holderTierForPubkey('tierGilded')).toBe(5);
  });

  it('caches within the TTL (one RPC per wallet)', async () => {
    const f = mockRpc([1_000_000]); // Whale
    vi.stubGlobal('fetch', f);
    expect(await holderTierForPubkey('tierWhale')).toBe(7);
    expect(await holderTierForPubkey('tierWhale')).toBe(7);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns 0 for a never-seen wallet when the RPC fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await holderTierForPubkey('tierUnseen')).toBe(0);
  });

  it('returns 0 (no tier) for a wallet holding under 1 $WOC', async () => {
    vi.stubGlobal('fetch', mockRpc([0]));
    expect(await holderTierForPubkey('tierBroke')).toBe(0);
  });

  it('re-fetches after the cache TTL expires (fake-clock advance)', async () => {
    vi.useFakeTimers();
    const first = mockRpc([10_000]); // Gilded (tier 5)
    vi.stubGlobal('fetch', first);
    expect(await holderTierForPubkey('tierExpiry')).toBe(5); // 1st RPC
    expect(await holderTierForPubkey('tierExpiry')).toBe(5); // cached, no new RPC
    expect(first).toHaveBeenCalledTimes(1);

    // Past the TTL the cache entry is stale → next call re-fetches.
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    const second = mockRpc([100_000]); // Vaultwarden (tier 6), a different balance
    vi.stubGlobal('fetch', second);
    expect(await holderTierForPubkey('tierExpiry')).toBe(6); // re-fetched the new tier
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known tier when a refresh fails for a known wallet', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockRpc([10_000])); // Gilded (tier 5)
    expect(await holderTierForPubkey('tierKeepLast')).toBe(5); // prime the cache

    // After the TTL the entry is stale, so the next call must re-fetch, but the
    // RPC now fails, so it keeps the last known tier rather than dropping to 0.
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await holderTierForPubkey('tierKeepLast')).toBe(5);
  });

  it('maps a balance exactly at a tier threshold to that tier (1000 → Silverbound tier 4)', async () => {
    vi.stubGlobal('fetch', mockRpc([1_000])); // exactly Silverbound's threshold
    expect(await holderTierForPubkey('tierThresholdEdge')).toBe(4);
  });
});

describe('holderInfoForPubkey (tier + exact balance)', () => {
  it('returns both the tier and the exact summed balance', async () => {
    vi.stubGlobal('fetch', mockRpc([10_000])); // Gilded (tier 5)
    expect(await holderInfoForPubkey('infoGilded')).toEqual({ tier: 5, balance: 10_000 });
  });

  it('returns the summed balance across multiple token accounts with its tier', async () => {
    // 1000 + 250.5 = 1250.5 → still Silverbound (tier 4, threshold 1000).
    vi.stubGlobal('fetch', mockRpc([1_000, 250.5]));
    expect(await holderInfoForPubkey('infoSum')).toEqual({ tier: 4, balance: 1_250.5 });
  });

  it('returns {tier:0, balance:0} for a balance under 1 $WOC', async () => {
    vi.stubGlobal('fetch', mockRpc([0.5]));
    expect(await holderInfoForPubkey('infoSubEmber')).toEqual({ tier: 0, balance: 0.5 });
  });

  it('returns {tier:0, balance:0} for a never-seen wallet when the RPC fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await holderInfoForPubkey('infoUnseen')).toEqual({ tier: 0, balance: 0 });
  });

  it('keeps the last known BALANCE and tier when a refresh fails for a known wallet', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockRpc([12_345])); // Gilded (tier 5), exact balance 12345
    expect(await holderInfoForPubkey('infoKeepLast')).toEqual({ tier: 5, balance: 12_345 });

    // Past the TTL the cache is stale, so the next call re-fetches, but the RPC
    // now fails, so it must keep the last known {tier, balance}, not drop to 0.
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await holderInfoForPubkey('infoKeepLast')).toEqual({ tier: 5, balance: 12_345 });
  });
});

describe('cachedWocBalance', () => {
  it('returns the freshly fetched balance', async () => {
    vi.stubGlobal('fetch', mockRpc([10_000]));
    expect(await cachedWocBalance('cacheFresh')).toBe(10_000);
  });

  it('serves the cached balance within the TTL (one RPC per wallet)', async () => {
    const f = mockRpc([2_500]);
    vi.stubGlobal('fetch', f);
    expect(await cachedWocBalance('cacheHit')).toBe(2_500);
    expect(await cachedWocBalance('cacheHit')).toBe(2_500);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('with fresh=true bypasses the TTL cache, re-fetches, and repopulates it', async () => {
    const first = mockRpc([1_000]);
    vi.stubGlobal('fetch', first);
    expect(await cachedWocBalance('cacheFreshArg')).toBe(1_000); // primes the cache
    expect(await cachedWocBalance('cacheFreshArg')).toBe(1_000); // served from cache
    expect(first).toHaveBeenCalledTimes(1);
    // The on-chain balance changed; a fresh read must reflect it within the TTL.
    const second = mockRpc([4_200]);
    vi.stubGlobal('fetch', second);
    expect(await cachedWocBalance('cacheFreshArg', true)).toBe(4_200);
    expect(second).toHaveBeenCalledTimes(1);
    // The fresh read repopulated the cache, so a later normal call sees the new value.
    expect(await cachedWocBalance('cacheFreshArg')).toBe(4_200);
    expect(second).toHaveBeenCalledTimes(1);
    // The fresh bypass of a still-in-TTL entry is a deliberate skip, NOT a stale
    // refresh — it must not inflate the stale-refresh metric (only genuine TTL
    // expiry does). Two hits, one initial miss, two stores (initial + fresh).
    expect(wocBalanceCacheStats()).toEqual(expect.objectContaining({
      hits: 2, misses: 1, stores: 2, staleRefreshes: 0,
    }));
  });

  it('tracks cache hits, misses, stores and current cache size', async () => {
    const f = mockRpc([2_500]);
    vi.stubGlobal('fetch', f);
    expect(await cachedWocBalance('cacheStats')).toBe(2_500);
    expect(await cachedWocBalance('cacheStats')).toBe(2_500);

    expect(wocBalanceCacheStats()).toEqual(expect.objectContaining({
      entries: 1,
      maxEntries: WOC_BALANCE_CACHE_MAX_ENTRIES,
      hits: 1,
      misses: 1,
      stores: 1,
      failures: 0,
      staleRefreshes: 0,
      evictions: 0,
    }));
  });

  it('keeps the last known balance when a refresh fails after the TTL', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockRpc([777]));
    expect(await cachedWocBalance('cacheKeep')).toBe(777);
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await cachedWocBalance('cacheKeep')).toBe(777); // last known, not null
    // The TTL-expired entry triggered exactly one GENUINE stale refresh, which then
    // failed — so the stale-refresh and failure metrics each count once.
    expect(wocBalanceCacheStats()).toEqual(expect.objectContaining({
      staleRefreshes: 1, failures: 1,
    }));
  });

  it('returns null for a never-seen wallet when the RPC fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await cachedWocBalance('cacheUnseen')).toBeNull();
  });

  it('evicts the oldest cached balance when successful unique wallets exceed the cap', async () => {
    const f = mockRpc([1]);
    vi.stubGlobal('fetch', f);
    for (let i = 0; i < WOC_BALANCE_CACHE_MAX_ENTRIES; i++) {
      expect(await cachedWocBalance(`cacheBounded${i}`)).toBe(1);
    }
    expect(f).toHaveBeenCalledTimes(WOC_BALANCE_CACHE_MAX_ENTRIES);

    expect(await cachedWocBalance('cacheBounded0')).toBe(1);
    expect(f).toHaveBeenCalledTimes(WOC_BALANCE_CACHE_MAX_ENTRIES);

    expect(await cachedWocBalance(`cacheBounded${WOC_BALANCE_CACHE_MAX_ENTRIES}`)).toBe(1);
    expect(f).toHaveBeenCalledTimes(WOC_BALANCE_CACHE_MAX_ENTRIES + 1);

    expect(await cachedWocBalance('cacheBounded1')).toBe(1);
    expect(f).toHaveBeenCalledTimes(WOC_BALANCE_CACHE_MAX_ENTRIES + 2);
    // Two entries were pushed past the cap (cacheBounded{MAX}, then the re-fetched
    // cacheBounded1), so exactly two oldest entries were evicted.
    expect(wocBalanceCacheStats().evictions).toBe(2);
  });
});

describe('handleWocBalance (GET /api/woc/balance proxy)', () => {
  it('rejects an invalid Solana address with 400 and never hits the RPC', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { status, data } = await callBalance('not-a-real-address');
    expect(status).toBe(400);
    expect(data.error).toMatch(/invalid Solana/i);
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects an empty owner with 400', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await callBalance('')).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('returns 200 with the exact balance for a valid address', async () => {
    vi.stubGlobal('fetch', mockRpc([1_000, 234.5]));
    const { status, data } = await callBalance(VALID_ADDR);
    expect(status).toBe(200);
    expect(data).toEqual({ balance: 1_234.5 });
  });

  it('forwards fresh=true to bypass the cache so a token change is reflected', async () => {
    vi.stubGlobal('fetch', mockRpc([500]));
    expect((await callBalance(VALID_ADDR)).data).toEqual({ balance: 500 }); // primes the cache
    // Without fresh, the cached value is returned even though the chain changed.
    vi.stubGlobal('fetch', mockRpc([900]));
    expect((await callBalance(VALID_ADDR)).data).toEqual({ balance: 500 });
    // With fresh, the proxy re-reads and returns the new balance.
    expect((await callBalance(VALID_ADDR, true)).data).toEqual({ balance: 900 });
  });

  it('returns 200 with balance:null when the RPC fails for an unseen wallet (UI omits it)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    const other = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 40));
    const { status, data } = await callBalance(other);
    expect(status).toBe(200);
    expect(data).toEqual({ balance: null });
  });
});

describe('parseWocBalanceQuery (the route-level query parse)', () => {
  it('extracts the owner and treats only fresh=1 as a forced refresh', () => {
    expect(parseWocBalanceQuery('/api/woc/balance?owner=ABC&fresh=1')).toEqual({ owner: 'ABC', fresh: true });
    expect(parseWocBalanceQuery('/api/woc/balance?owner=ABC')).toEqual({ owner: 'ABC', fresh: false });
    expect(parseWocBalanceQuery('/api/woc/balance?owner=ABC&fresh=0')).toEqual({ owner: 'ABC', fresh: false });
    // Any non-1 value (incl. truthy-looking strings) is NOT a forced refresh, so a
    // stray param can't be used to bypass the cache and hammer the RPC.
    expect(parseWocBalanceQuery('/api/woc/balance?owner=ABC&fresh=true').fresh).toBe(false);
    expect(parseWocBalanceQuery('/api/woc/balance?owner=ABC&fresh=11').fresh).toBe(false);
  });

  it('defaults a missing owner to the empty string (handler then 400s) and order-independently', () => {
    expect(parseWocBalanceQuery('/api/woc/balance')).toEqual({ owner: '', fresh: false });
    expect(parseWocBalanceQuery('/api/woc/balance?fresh=1')).toEqual({ owner: '', fresh: true });
    expect(parseWocBalanceQuery('/api/woc/balance?fresh=1&owner=ABC')).toEqual({ owner: 'ABC', fresh: true });
  });

  it('URL-decodes the owner value', () => {
    expect(parseWocBalanceQuery('/api/woc/balance?owner=a%20b').owner).toBe('a b');
  });

  it('drives the real handler end-to-end: a parsed fresh=1 URL bypasses the cache', async () => {
    // Real parse -> real handler, no mocks of either: proves the route wiring forwards
    // fresh through to a genuine cache bypass + repopulate.
    const callFromUrl = async (rawUrl: string) => {
      const { owner, fresh } = parseWocBalanceQuery(rawUrl);
      const res = makeRes();
      await handleWocBalance(res, owner, fresh);
      return res.body ? JSON.parse(res.body) : {};
    };
    const base = `/api/woc/balance?owner=${VALID_ADDR}`;
    vi.stubGlobal('fetch', mockRpc([700]));
    expect(await callFromUrl(base)).toEqual({ balance: 700 }); // primes the cache
    vi.stubGlobal('fetch', mockRpc([1_500]));
    expect(await callFromUrl(base)).toEqual({ balance: 700 }); // cached read ignores the chain change
    expect(await callFromUrl(`${base}&fresh=1`)).toEqual({ balance: 1_500 }); // fresh=1 re-reads
  });
});
