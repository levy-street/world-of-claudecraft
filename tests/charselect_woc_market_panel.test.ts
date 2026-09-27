// @vitest-environment jsdom
//
// The character-select read-only $WOC Exchange panel: browse and sales
// history must render from a fake client with no character/inventory/wallet
// in play, the news panel must yield its dock while this one is open and get
// it back on close, and the platform gate + client-not-attached case must
// leave the panel entirely inert (open() a no-op).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WocListingView, WocSaleView } from '../src/net/woc_market_sdk';
import { ITEMS } from '../src/sim/data';
import {
  type CharselectMarketClient,
  type CharselectWocMarketDeps,
  CharselectWocMarketPanel,
} from '../src/ui/charselect_woc_market_panel';
import { itemDisplayName } from '../src/ui/entity_i18n';

const ITEM_ID = Object.keys(ITEMS)[0]!;
const ITEM_NAME = itemDisplayName(ITEMS[ITEM_ID]!);

function mountShell(): void {
  document.body.innerHTML = `
    <button id="opener">Open</button>
    <div id="charselect-news"></div>
    <div id="charselect-woc-market" hidden></div>`;
}

const STATUS = {
  ok: true as const,
  enabled: true,
  price: { available: true, healthy: true, tokensPerUsd: 100, asOfMs: 900_000 },
  maxActiveListings: 12,
  durationsHours: [12, 24, 48],
  minPriceCents: 25,
  maxPriceCents: 100_000,
  allowMounts: true,
  allowMechChromas: true,
  qualityFloor: 'epic',
  settlementWindowSeconds: 600,
};

function makeListing(over: Partial<WocListingView> = {}): WocListingView {
  return {
    id: 1,
    item: { itemId: ITEM_ID, count: 1 },
    itemId: ITEM_ID,
    quality: 'epic',
    format: 'auction',
    sellerName: 'Sellsword',
    mine: false,
    startCents: 1000,
    hasReserve: false,
    reserveMet: null,
    buyNowCents: 5000,
    offerNext: false,
    status: 'active',
    resolution: null,
    currentBidCents: 1500,
    minNextBidCents: 1600,
    minNextBidBondCents: 100,
    buyNowLocked: false,
    endsAtMs: Date.now() + 3_600_000,
    createdAtMs: Date.now() - 3_600_000,
    ...over,
  };
}

function makeSale(over: Partial<WocSaleView> = {}): WocSaleView {
  return {
    id: 1,
    itemId: ITEM_ID,
    priceCents: 2500,
    sellerName: 'Sellsword',
    buyerName: 'Buyerson',
    atMs: Date.now() - 60_000,
    saleType: 'auction',
    quality: 'epic',
    ...over,
  };
}

/** A recording fake satisfying CharselectMarketClient; every call is a spy
 *  so a test can assert the exact request shape (page, itemIds) without
 *  reaching into the panel's private state. */
type FakeClient = {
  status: ReturnType<typeof vi.fn>;
  browse: ReturnType<typeof vi.fn>;
  recentSales: ReturnType<typeof vi.fn>;
};

function fakeClient(over: Partial<FakeClient> = {}): FakeClient {
  return {
    status: vi.fn(async () => STATUS),
    browse: vi.fn(async () => ({ ok: true, page: 0, hasMore: false, listings: [makeListing()] })),
    recentSales: vi.fn(async () => ({ ok: true, page: 0, hasMore: false, sales: [makeSale()] })),
    ...over,
  };
}

function panelWith(
  client: FakeClient | null,
  overDeps: Partial<CharselectWocMarketDeps> = {},
): { panel: CharselectWocMarketPanel; closeRedesignIfOpen: ReturnType<typeof vi.fn> } {
  const closeRedesignIfOpen = vi.fn();
  // The cast is the test-double seam (charselect_redesign.test.ts's own
  // convention): a fake missing a member still fails tsc above it.
  const typedClient = client as unknown as CharselectMarketClient | null;
  const panel = new CharselectWocMarketPanel({
    root: () => document.getElementById('charselect-woc-market'),
    client: () => typedClient,
    newsHost: () => document.getElementById('charselect-news'),
    closeRedesignIfOpen,
    ...overDeps,
  });
  return { panel, closeRedesignIfOpen };
}

async function flush(): Promise<void> {
  // Two microtask hops: reload() awaits status() then Promise.all([browse, history]).
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mountShell();
});

describe('open', () => {
  it('is a no-op with no attached client', () => {
    const { panel } = panelWith(null);
    panel.open(document.getElementById('opener'));
    expect(document.getElementById('charselect-woc-market')?.hasAttribute('hidden')).toBe(true);
    expect(panel.isOpen).toBe(false);
  });

  it('reveals the panel, hides the news dock, and closes an open redesign editor', () => {
    const { panel, closeRedesignIfOpen } = panelWith(fakeClient());
    panel.open(document.getElementById('opener'));
    expect(document.getElementById('charselect-woc-market')?.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('charselect-news')?.hasAttribute('hidden')).toBe(true);
    expect(closeRedesignIfOpen).toHaveBeenCalledTimes(1);
    expect(panel.isOpen).toBe(true);
  });

  it('renders the fetched listings on the Browse tab with no character/inventory involved', async () => {
    const client = fakeClient();
    const { panel } = panelWith(client);
    panel.open(document.getElementById('opener'));
    await flush();
    const root = document.getElementById('charselect-woc-market')!;
    expect(root.textContent).toContain(ITEM_NAME);
    expect(root.textContent).toContain('Sellsword');
    expect(client.browse).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0, itemIds: null, sort: 'ending' }),
    );
  });
});

describe('close', () => {
  it('hides the panel, restores the news dock, and returns focus to the opener', async () => {
    const { panel } = panelWith(fakeClient());
    const opener = document.getElementById('opener') as HTMLButtonElement;
    panel.open(opener);
    await flush();
    panel.close();
    expect(document.getElementById('charselect-woc-market')?.hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('charselect-news')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(panel.isOpen).toBe(false);
  });

  it('closes on Escape', async () => {
    const { panel } = panelWith(fakeClient());
    panel.open(document.getElementById('opener'));
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.isOpen).toBe(false);
  });
});

describe('tabs', () => {
  it('switches to Sales History and renders the fetched sales, still with no character context', async () => {
    const client = fakeClient();
    const { panel } = panelWith(client);
    panel.open(document.getElementById('opener'));
    await flush();
    const root = document.getElementById('charselect-woc-market')!;
    root.querySelector<HTMLElement>('[data-tab="history"]')?.click();
    await flush();
    expect(root.textContent).toContain('Buyerson');
    expect(client.recentSales).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0, itemIds: null }),
    );
  });
});

describe('filtering', () => {
  it('resolves the item-name filter to ids and re-asks both tabs', async () => {
    const client = fakeClient();
    const { panel } = panelWith(client);
    panel.open(document.getElementById('opener'));
    await flush();
    const root = document.getElementById('charselect-woc-market')!;
    const input = root.querySelector<HTMLInputElement>('[data-field="filter-item"]')!;
    input.value = ITEM_NAME;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(client.browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 0, itemIds: [ITEM_ID] }),
    );
    expect(client.recentSales).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 0, itemIds: [ITEM_ID] }),
    );
  });

  it('a query matching nothing shows the empty face without asking the server again', async () => {
    const client = fakeClient();
    const { panel } = panelWith(client);
    panel.open(document.getElementById('opener'));
    await flush();
    const root = document.getElementById('charselect-woc-market')!;
    const input = root.querySelector<HTMLInputElement>('[data-field="filter-item"]')!;
    const callsBefore = client.browse.mock.calls.length;
    input.value = 'no such item anywhere in the catalog';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(client.browse.mock.calls.length).toBe(callsBefore);
    expect(root.querySelector('.csm-list')).toBeNull();
  });
});

describe('paging', () => {
  it('Next asks for the following page; Prev is disabled on page 0', async () => {
    const client = fakeClient({
      browse: vi.fn(async (req: { page: number }) => ({
        ok: true,
        page: req.page,
        hasMore: req.page === 0,
        listings: [makeListing({ id: req.page + 1 })],
      })),
    });
    const { panel } = panelWith(client);
    panel.open(document.getElementById('opener'));
    await flush();
    const root = document.getElementById('charselect-woc-market')!;
    expect(root.querySelector<HTMLButtonElement>('[data-action="browse-prev"]')?.disabled).toBe(
      true,
    );
    root.querySelector<HTMLElement>('[data-action="browse-next"]')?.click();
    await flush();
    expect(client.browse).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
  });
});

describe('web hand-off', () => {
  it('links out to the browser-playable build for bid/buy/sell', async () => {
    const { panel } = panelWith(fakeClient());
    panel.open(document.getElementById('opener'));
    await flush();
    const root = document.getElementById('charselect-woc-market')!;
    const link = root.querySelector<HTMLAnchorElement>('.csm-web-link')!;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.getAttribute('href')).toBeTruthy();
  });
});
