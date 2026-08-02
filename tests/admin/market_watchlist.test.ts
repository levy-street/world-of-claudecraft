// @vitest-environment jsdom
// The Market watchlist helper: localStorage round-trip, toggle semantics,
// and garbage tolerance (a corrupt or blocked store degrades to empty, never
// a throw). jsdom env for the localStorage polyfill; _setup clears it.
import './_setup';
import { describe, expect, it } from 'vitest';
import { readMarketWatchlist, toggleMarketWatchlist } from '../../src/admin/market_watchlist';

describe('market watchlist', () => {
  it('starts empty, toggles on and off, and persists across reads', () => {
    expect(readMarketWatchlist().size).toBe(0);
    let list = toggleMarketWatchlist(readMarketWatchlist(), 'wolf_fang');
    expect([...list]).toEqual(['wolf_fang']);
    expect([...readMarketWatchlist()]).toEqual(['wolf_fang']);
    list = toggleMarketWatchlist(list, 'spring_water');
    expect([...readMarketWatchlist()].sort()).toEqual(['spring_water', 'wolf_fang']);
    list = toggleMarketWatchlist(list, 'wolf_fang');
    expect([...readMarketWatchlist()]).toEqual(['spring_water']);
  });

  it('returns a fresh set so reactive state sees the change', () => {
    const before = readMarketWatchlist();
    const after = toggleMarketWatchlist(before, 'wolf_fang');
    expect(after).not.toBe(before);
    expect(before.has('wolf_fang')).toBe(false);
  });

  it('tolerates garbage in storage', () => {
    localStorage.setItem('claudecraft_admin_market_watchlist', '{not json');
    expect(readMarketWatchlist().size).toBe(0);
    localStorage.setItem('claudecraft_admin_market_watchlist', '{"a":1}');
    expect(readMarketWatchlist().size).toBe(0);
    localStorage.setItem('claudecraft_admin_market_watchlist', '["ok", 5, null]');
    expect([...readMarketWatchlist()]).toEqual(['ok']);
  });
});
