// The Market Sweep card's pure core (src/ui/market_sweep_core.ts): row eligibility,
// the quote echo match, the quote line view, the typed-count clamp, and the
// confirm-time recheck. Driven with plain snapshots, the market_buy_confirm idiom.
import { describe, expect, it } from 'vitest';
import { MARKET_SWEEP_MAX_UNITS } from '../src/sim/market_sweep';
import {
  recheckMarketSweep,
  stagedSweepQuote,
  sweepCountFromInput,
  sweepEligibleRow,
  sweepQuoteView,
} from '../src/ui/market_sweep_core';
import type { MarketInfo, MarketListingView, MarketSweepQuote } from '../src/world_api';

const ORE = 'copper_ore';

function listing(over: Partial<MarketListingView> = {}): MarketListingView {
  return {
    id: 1,
    sellerName: 'Halden',
    itemId: ORE,
    count: 1,
    price: 10,
    mine: false,
    house: false,
    ...over,
  };
}

function info(sweepQuote: MarketSweepQuote | null): MarketInfo {
  return {
    listings: [],
    totalCount: 0,
    filter: '',
    itemType: 'all',
    subtype: 'all',
    armorClass: 'all',
    primaryStat: 'all',
    rarity: 'all',
    sort: 'name',
    collapseLowest: false,
    page: 0,
    pageCount: 1,
    collectionCopper: 0,
    collectionItems: [],
    collectionSales: [],
    collectionSalesOmitted: 0,
    cutPct: 5,
    maxListings: 12,
    myListingCount: 0,
    sellPriceItemId: null,
    sellLowestPrice: null,
    sweepQuote,
  };
}

const quote = (over: Partial<MarketSweepQuote> = {}): MarketSweepQuote => ({
  itemId: ORE,
  count: 6,
  units: 7,
  listings: 2,
  total: 37,
  short: false,
  ...over,
});

describe('sweepEligibleRow', () => {
  it('admits only a plain, fungible, someone-else row', () => {
    expect(sweepEligibleRow(listing())).toBe(true);
    expect(sweepEligibleRow(listing({ mine: true }))).toBe(false);
    expect(sweepEligibleRow(listing({ house: true }))).toBe(false);
    expect(sweepEligibleRow(listing({ instance: { name: 'Signed' } }))).toBe(false);
    expect(sweepEligibleRow(listing({ craftedRecipeId: 'recipe_copper_bar' }))).toBe(false);
    expect(
      sweepEligibleRow(
        listing({ materialSources: [{ source: { signer: 'Mira' }, units: 1 } as never] }),
      ),
    ).toBe(false);
    expect(
      sweepEligibleRow(listing({ materialSources: [{ source: {}, units: 1 } as never] })),
    ).toBe(true);
  });
});

describe('stagedSweepQuote / sweepQuoteView', () => {
  it('trusts the echo only when it answers the staged item AND count', () => {
    const stage = { itemId: ORE, count: 6 };
    expect(stagedSweepQuote(info(quote()), stage)).toEqual(quote());
    expect(stagedSweepQuote(info(quote({ count: 5 })), stage)).toBeNull();
    expect(stagedSweepQuote(info(quote({ itemId: 'wolf_fang' })), stage)).toBeNull();
    expect(stagedSweepQuote(null, stage)).toBeNull();
    expect(sweepQuoteView(info(quote({ count: 5 })), stage)).toEqual({ state: 'waiting' });
  });

  it('states the plan with a ceil per-unit ask, and names a short or empty book', () => {
    const stage = { itemId: ORE, count: 6 };
    expect(sweepQuoteView(info(quote()), stage)).toEqual({
      state: 'ok',
      units: 7,
      listings: 2,
      total: 37,
      each: 6,
    });
    expect(
      sweepQuoteView(info(quote({ units: 2, listings: 1, total: 20, short: true })), stage),
    ).toMatchObject({ state: 'short', units: 2, each: 10 });
    expect(
      sweepQuoteView(info(quote({ units: 0, listings: 0, total: 0, short: true })), stage),
    ).toEqual({ state: 'none' });
  });
});

describe('sweepCountFromInput', () => {
  it('parses a positive integer and clamps junk and overflow', () => {
    expect(sweepCountFromInput('12')).toBe(12);
    expect(sweepCountFromInput('0')).toBe(1);
    expect(sweepCountFromInput('-3')).toBe(1);
    expect(sweepCountFromInput('')).toBe(1);
    expect(sweepCountFromInput('abc')).toBe(1);
    expect(sweepCountFromInput('9999')).toBe(MARKET_SWEEP_MAX_UNITS);
  });
});

describe('recheckMarketSweep', () => {
  const stage = { itemId: ORE, count: 6 };
  const agreed = { units: 7, total: 37 };
  it('is ok when the live quote still says what the player read', () => {
    expect(recheckMarketSweep(info(quote()), stage, agreed)).toEqual({ state: 'ok', total: 37 });
  });
  it('is gone with no snapshot, no matching quote, or an emptied book', () => {
    expect(recheckMarketSweep(null, stage, agreed)).toEqual({ state: 'gone' });
    expect(recheckMarketSweep(info(null), stage, agreed)).toEqual({ state: 'gone' });
    expect(recheckMarketSweep(info(quote({ count: 5 })), stage, agreed)).toEqual({ state: 'gone' });
    expect(recheckMarketSweep(info(quote({ units: 0, total: 0 })), stage, agreed)).toEqual({
      state: 'gone',
    });
  });
  it('is changed when the units or the total moved', () => {
    expect(recheckMarketSweep(info(quote({ total: 40 })), stage, agreed)).toEqual({
      state: 'changed',
    });
    expect(recheckMarketSweep(info(quote({ units: 8 })), stage, agreed)).toEqual({
      state: 'changed',
    });
  });
});
