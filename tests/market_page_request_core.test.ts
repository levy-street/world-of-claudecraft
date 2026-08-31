import { describe, expect, it } from 'vitest';
import {
  beginMarketPageRequest,
  reconcileMarketPageEcho,
} from '../src/ui/market_page_request_core';
import type { MarketInfo } from '../src/world_api';

function info(page: number, pageCount = 3, filter = ''): MarketInfo {
  return {
    listings: [],
    totalCount: 120,
    filter,
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    sort: 'name',
    collapseLowest: false,
    page,
    pageCount,
    collectionCopper: 0,
    collectionItems: [],
    collectionSales: [],
    collectionSalesOmitted: 0,
    cutPct: 5,
    maxListings: 12,
    myListingCount: 0,
    sellPriceItemId: null,
    sellLowestPrice: null,
  };
}

describe('market page request reconciliation', () => {
  it('ignores an older nonzero echo until a page-zero response arrives', () => {
    const initial = info(0);
    const pending = beginMarketPageRequest(null, 0, 1, initial);
    const stale = reconcileMarketPageEcho(pending, 0, info(1), true);

    expect(stale.page).toBe(0);
    expect(stale.accepted).toBe(false);
    expect(stale.pending?.sawOtherEcho).toBe(true);
    expect(reconcileMarketPageEcho(stale.pending, stale.page, initial, true)).toEqual({
      page: 0,
      pending: null,
      accepted: true,
    });
  });

  it('ignores an older page-zero echo after a nonzero request supersedes it', () => {
    const priorNonzero = info(1);
    const pending = beginMarketPageRequest(null, 1, 0, priorNonzero);
    const stale = reconcileMarketPageEcho(pending, 1, info(0), true);

    expect(stale.page).toBe(1);
    expect(stale.accepted).toBe(false);
    expect(stale.pending?.sawOtherEcho).toBe(true);
    expect(reconcileMarketPageEcho(stale.pending, stale.page, priorNonzero, true)).toEqual({
      page: 1,
      pending: null,
      accepted: true,
    });
  });

  it('accepts an authoritative clamp when the requested page no longer exists', () => {
    const pending = beginMarketPageRequest(null, 2, 1, info(1, 3));
    const clamped = info(0, 1);
    clamped.totalCount = 0;

    expect(reconcileMarketPageEcho(pending, 2, clamped, true)).toEqual({
      page: 0,
      pending: null,
      accepted: true,
    });
  });

  it('does not accept a response for a superseded search or filter query', () => {
    const pending = beginMarketPageRequest(null, 0, 1, info(1, 3, 'old'));
    const stale = reconcileMarketPageEcho(pending, 0, info(0, 3, 'old'), false);

    expect(stale.page).toBe(0);
    expect(stale.accepted).toBe(false);
    expect(stale.pending?.sawOtherEcho).toBe(true);
  });

  it('accepts an authoritative echo when there is no pending page request', () => {
    expect(reconcileMarketPageEcho(null, 0, info(1), true)).toEqual({
      page: 1,
      pending: null,
      accepted: true,
    });
  });

  it('rejects a mismatched query echo even when the page itself is not pending', () => {
    expect(reconcileMarketPageEcho(null, 0, info(0, 1, 'older'), false)).toEqual({
      page: 0,
      pending: null,
      accepted: false,
    });
  });
});
