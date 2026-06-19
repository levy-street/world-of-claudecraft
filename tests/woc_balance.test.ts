import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWocBalance, holderInfoForPubkey } from '../server/woc_balance';

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

// Mock the RPC with an arbitrary, possibly-malformed, parsed JSON body. Used to
// drive the defensive parsing paths in fetchWocBalance (missing/typeless fields).
function mockRawRpc(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fetchWocBalance', () => {
  it('sums uiAmount across all of the owner’s token accounts', async () => {
    vi.stubGlobal('fetch', mockRpc([1000, 250.5]));
    expect(await fetchWocBalance('AAA')).toBe(1250.5);
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

  it('skips a uiAmount of the wrong type (string or null), summing only numbers', async () => {
    vi.stubGlobal('fetch', mockRawRpc({
      result: {
        value: [
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: '500' } } } } } }, // string → skipped
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: null } } } } } },  // null → skipped
          { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 7.5 } } } } } },    // number → counted
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

    // Past the 5-minute TTL the cache entry is stale → next call re-fetches.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const second = mockRpc([100_000]); // Vaultwarden (tier 6) — a different balance
    vi.stubGlobal('fetch', second);
    expect(await holderTierForPubkey('tierExpiry')).toBe(6); // re-fetched the new tier
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known tier when a refresh fails for a known wallet', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockRpc([10_000])); // Gilded (tier 5)
    expect(await holderTierForPubkey('tierKeepLast')).toBe(5); // prime the cache

    // After the TTL the entry is stale, so the next call must re-fetch — but the
    // RPC now fails, so it keeps the last known tier rather than dropping to 0.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
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

    // Past the TTL the cache is stale, so the next call re-fetches — but the RPC
    // now fails, so it must keep the last known {tier, balance}, not drop to 0.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rpc down'); }));
    expect(await holderInfoForPubkey('infoKeepLast')).toEqual({ tier: 5, balance: 12_345 });
  });
});
