import { describe, expect, it } from 'vitest';
import type { MarketQuery } from '../src/sim/market_query';
import type { MarketInfo } from '../src/world_api';
import { queryDiffersFromEcho } from '../src/world_api';

// Issue #2416: queryDiffersFromEcho is the pure decision MarketWindow.onReconnected
// makes to tell an ordinary resume (the server kept the session's query) apart from
// a fresh join (the server silently reset it to default), so the window re-pushes
// its own filter controls only when they actually drifted from what the server is
// really browsing by.

const baseQuery: MarketQuery = {
  search: 'robe',
  itemType: 'armor',
  subtype: 'chest',
  armorClass: 'cloth',
  primaryStat: 'int',
  rarity: 'rare',
  page: 0,
};

// Only the fields queryDiffersFromEcho reads; the rest of MarketInfo is irrelevant
// to the comparison, so the helper stays a thin object literal per case.
function echoOf(overrides: Partial<MarketInfo> = {}): MarketInfo {
  return {
    listings: [],
    totalCount: 0,
    filter: baseQuery.search,
    itemType: baseQuery.itemType,
    subtype: baseQuery.subtype,
    armorClass: baseQuery.armorClass,
    primaryStat: baseQuery.primaryStat,
    rarity: baseQuery.rarity,
    page: 0,
    pageCount: 1,
    collectionCopper: 0,
    collectionItems: [],
    collectionSales: [],
    collectionSalesOmitted: 0,
    cutPct: 5,
    maxListings: 12,
    myListingCount: 0,
    ...overrides,
  };
}

describe('queryDiffersFromEcho (issue #2416)', () => {
  it('reports no drift when the echo matches the query on every filter axis', () => {
    expect(queryDiffersFromEcho(baseQuery, echoOf())).toBe(false);
  });

  it('ignores page and the raw search text (server-clamped / not directly comparable)', () => {
    const query: MarketQuery = { ...baseQuery, page: 3, search: 'Robe ' };
    expect(queryDiffersFromEcho(query, echoOf({ page: 0, filter: 'robe' }))).toBe(false);
  });

  it('detects a fresh-join reset: the echo fell back to default while the query held the players intent', () => {
    const echo = echoOf({
      itemType: 'all',
      subtype: 'all',
      armorClass: 'all',
      primaryStat: 'all',
      rarity: 'all',
    });
    expect(queryDiffersFromEcho(baseQuery, echo)).toBe(true);
  });

  it.each([
    ['itemType', { itemType: 'weapon' as const }],
    ['subtype', { subtype: 'legs' as const }],
    ['armorClass', { armorClass: 'mail' as const }],
    ['primaryStat', { primaryStat: 'str' as const }],
    ['rarity', { rarity: 'epic' as const }],
  ])('detects drift on the %s axis alone', (_axis, overrides) => {
    expect(queryDiffersFromEcho(baseQuery, echoOf(overrides))).toBe(true);
  });
});
