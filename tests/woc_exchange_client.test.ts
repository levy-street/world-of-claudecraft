import { afterEach, describe, expect, it, vi } from 'vitest';
import { WocExchangeClient } from '../src/net/woc_exchange_client';

afterEach(() => vi.unstubAllGlobals());

describe('restricted WOC Exchange client', () => {
  it('carries bearer auth and encodes browse filters', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ page: 2, hasMore: false, listings: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new WocExchangeClient({ token: () => 'token' });
    await expect(
      client.browse({
        page: 2,
        quality: 'epic',
        format: 'auction',
        category: null,
        subcategory: null,
        itemIds: ['item_a'],
        sort: 'price_asc',
      }),
    ).resolves.toMatchObject({ ok: true, page: 2 });
    const [url, init] = (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])[0];
    expect(String(url)).toContain('page=2');
    expect(String(url)).toContain('quality=epic');
    expect(String(url)).toContain('itemIds=item_a');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('sends only the contracted bid fields', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ bid: { id: 8 }, bond: { reference: 'bond' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new WocExchangeClient({ token: () => 'token' });
    await client.placeBid({ listingId: 7, characterId: 3, amountCents: 1200, acceptTerms: true });
    const [url, init] = (fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][])[0];
    expect(url).toBe('/api/woc-market/listings/7/bids');
    expect(JSON.parse(String(init?.body))).toEqual({
      characterId: 3,
      amountCents: 1200,
      acceptTerms: true,
    });
  });

  it('pins the remaining financial mutation routes and request bodies', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        cancelPending: true,
        bond: { reference: 'bond' },
        quote: { reference: 'settlement' },
        settlement: { id: 12 },
        standing: true,
        state: 'confirming',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new WocExchangeClient({ token: () => 'token' });

    await client.cancelListing(7);
    await client.bondQuote(8);
    await client.abandonBid(8);
    await client.confirmBond(8, 'bond-signature');
    await client.buyNow({ listingId: 7, characterId: 3, acceptTerms: true });
    await client.settlementQuote(12);
    await client.confirmSettlement(12, 'settlement-signature');

    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    expect(calls.map(([url]) => String(url))).toEqual([
      '/api/woc-market/listings/7/cancel',
      '/api/woc-market/bids/8/bond-quote',
      '/api/woc-market/bids/8/abandon',
      '/api/woc-market/bids/8/bond',
      '/api/woc-market/listings/7/buy-now',
      '/api/woc-market/settlements/12/quote',
      '/api/woc-market/settlements/12/confirm',
    ]);
    expect(JSON.parse(String(calls[3][1]?.body))).toEqual({ signature: 'bond-signature' });
    expect(JSON.parse(String(calls[4][1]?.body))).toEqual({
      characterId: 3,
      acceptTerms: true,
    });
    expect(JSON.parse(String(calls[6][1]?.body))).toEqual({
      signature: 'settlement-signature',
    });
  });

  it('pins item and seller history routes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ sales: [], seller: null }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new WocExchangeClient({ token: () => 'token' });
    await client.history('item / one');
    await client.sellerHistory('Seller / One');
    const calls = fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit?][];
    expect(calls.map(([url]) => String(url))).toEqual([
      '/api/woc-market/history/item%20%2F%20one',
      '/api/woc-market/seller-history/Seller%20%2F%20One',
    ]);
  });

  it('fails closed on non-JSON and codeless errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('offline', { status: 503 })),
    );
    const client = new WocExchangeClient({ token: () => null });
    await expect(client.me()).resolves.toEqual({
      ok: false,
      code: 'woc_market.quote_unavailable',
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
