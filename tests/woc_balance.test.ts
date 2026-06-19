import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWocBalance, holderTierForPubkey } from '../server/woc_balance';

// Mock the Solana JSON-RPC: return token accounts whose uiAmounts we control.
function mockRpc(uiAmounts: number[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      result: { value: uiAmounts.map((ui) => ({ account: { data: { parsed: { info: { tokenAmount: { uiAmount: ui } } } } } })) },
    }),
  }));
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
});
