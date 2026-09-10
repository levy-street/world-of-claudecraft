// The Collections window's $WOC Exchange price lookup
// (src/ui/collections/collections_host.ts exchangeLowestCentsFor).
//
// One browse per selection, lowest buy-now per item, and a failure that
// degrades to "no listings" rather than throwing into the painter. The pins
// here are the three ways a price row can lie to a player: showing a bid as if
// it were a purchase price, showing a higher listing than the real floor, and
// blanking on a failed call.

import { describe, expect, it, vi } from 'vitest';
import {
  type CollectionsExchangeClient,
  exchangeLowestCentsFor,
} from '../src/ui/collections/collections_host';

const listing = (itemId: string, buyNowCents: number | null): Record<string, unknown> => ({
  id: Math.random(),
  itemId,
  buyNowCents,
  quality: 'epic',
});

function clientReturning(listings: Record<string, unknown>[]): CollectionsExchangeClient {
  return {
    browse: vi.fn(async () => ({ ok: true as const, hasMore: false, page: 0, listings })),
  } as unknown as CollectionsExchangeClient;
}

describe('collections exchange price lookup', () => {
  it('asks for exactly one price-ascending browse over the named item ids', async () => {
    const client = clientReturning([]);
    await exchangeLowestCentsFor(client, ['a', 'b']);
    expect(client.browse).toHaveBeenCalledTimes(1);
    expect(client.browse).toHaveBeenCalledWith(
      expect.objectContaining({ itemIds: ['a', 'b'], sort: 'price_asc', page: 0 }),
    );
  });

  it('keeps the lowest buy-now per item and ignores bid-only listings', async () => {
    const prices = await exchangeLowestCentsFor(
      clientReturning([
        listing('helm', 900),
        listing('helm', 450),
        listing('helm', null), // auction with no buy-now: not a price to show
        listing('cloak', 1200),
      ]),
      ['helm', 'cloak'],
    );
    expect(prices.get('helm')).toBe(450);
    expect(prices.get('cloak')).toBe(1200);
    expect(prices.size).toBe(2);
  });

  it('resolves empty rather than throwing when the Exchange refuses', async () => {
    const failing = {
      browse: vi.fn(async () => ({ ok: false as const, error: 'woc_market.disabled' })),
    } as unknown as CollectionsExchangeClient;
    await expect(exchangeLowestCentsFor(failing, ['helm'])).resolves.toEqual(new Map());
  });

  it('never calls out with no client or no items', async () => {
    const client = clientReturning([listing('helm', 100)]);
    await expect(exchangeLowestCentsFor(null, ['helm'])).resolves.toEqual(new Map());
    await expect(exchangeLowestCentsFor(client, [])).resolves.toEqual(new Map());
    expect(client.browse).not.toHaveBeenCalled();
  });
});
