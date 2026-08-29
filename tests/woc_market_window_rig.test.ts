// @vitest-environment happy-dom
// The $WOC Exchange window, driven LIVE: the real WocMarketWindow over a
// happy-dom root, a recording fake of the market client, fake hooks, and the
// deps bag the Hud composes it with. tests/woc_market_window.test.ts is the
// source-scan twin (a regex proves discipline, not behavior); this rig is where
// the load-bearing claims live as behavior: what open() fetches and paints,
// what a row click loads, that a close() under a hung wallet signer neither
// re-enables a newer run's buttons nor sends a second createListing (busyGen),
// that the poll never fires under a mutation, that the terms checkbox and the
// focused control survive the slow-band rebuild, and that the sell combobox
// commits on mousedown.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WocActivityView,
  WocEstimateView,
  WocListingView,
  WocMarketClient,
  WocMarketStatus,
  WocSaleView,
  WocSellerView,
  WocStepUpChallenge,
} from '../src/net/woc_market_sdk';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import {
  onWalletUiChange,
  setWalletConnectionAddresses,
  setWalletUiEnabled,
  setWocBalance,
} from '../src/ui/wallet_balance';
import {
  type WocMarketHooks,
  WocMarketWindow,
  type WocMarketWindowDeps,
} from '../src/ui/woc_market_window';
import type { IWorld } from '../src/world_api';

// The icon path stays real for QUALITY_COLOR but composes no canvas: a
// fixture id without committed art would otherwise red the whole rig with a
// happy-dom canvas error unrelated to the window.
vi.mock('../src/ui/icons', async (orig) => ({
  ...(await orig<typeof import('../src/ui/icons')>()),
  iconDataUrl: () => 'data:,',
}));

const EPIC = 'deathlord_warplate';
const EPIC_TWO = 'wyrmshadow_harness';
const NAME_OF = (id: string): string => itemDisplayName(ITEMS[id]);
// The wall clock at load: listing timers are derived from server timestamps
// against Date.now(), so a fixed epoch would read every listing as ended.
const NOW = Date.now();

/** A promise whose settlement the test controls: the hung-wallet arms below
 *  park a round trip on one of these and close the window over it. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain the microtask queue far enough for an open()->reload() chain (status,
 *  then browse + me in parallel, then a render) to settle. */
async function flush(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function status(over: Partial<WocMarketStatus> = {}): WocMarketStatus {
  return {
    ok: true,
    enabled: true,
    price: { available: true, healthy: true, tokensPerUsd: 7812.5, asOfMs: NOW - 5_000 },
    maxActiveListings: 10,
    durationsHours: [12, 24, 48],
    minPriceCents: 100,
    maxPriceCents: 1_000_000,
    qualityFloor: 'epic',
    allowMounts: false,
    allowMechChromas: false,
    settlementWindowSeconds: 3600,
    directedHoldSeconds: 600,
    ...over,
  };
}

function listing(id: number, over: Partial<WocListingView> = {}): WocListingView {
  return {
    id,
    item: { itemId: EPIC, count: 1 },
    itemId: EPIC,
    quality: 'epic',
    format: 'auction',
    sellerName: 'Aurelia',
    mine: false,
    startCents: 2500,
    hasReserve: true,
    reserveMet: false,
    buyNowCents: null,
    offerNext: true,
    status: 'active',
    resolution: null,
    currentBidCents: null,
    minNextBidCents: 2500,
    minNextBidBondCents: 250,
    buyNowLocked: false,
    endsAtMs: NOW + 3_600_000,
    createdAtMs: NOW - 60_000,
    ...over,
  };
}

const EMPTY_ACTIVITY: WocActivityView = {
  listings: [],
  bids: [],
  settlements: [],
  strikes: null,
  termsAcceptedAtMs: null,
  walletLinked: true,
};

interface FakeClient {
  client: WocMarketClient;
  calls: string[];
  /** Staged answers; a test overwrites the ones its arm needs. */
  answers: {
    status: () => Promise<WocMarketStatus>;
    browse: () => Promise<
      | { ok: true; hasMore: boolean; page: number; listings: WocListingView[] }
      | { ok: false; code: string }
    >;
    detail: () => Promise<
      | { ok: true; listing: WocListingView; estimate: WocEstimateView | null }
      | { ok: false; code: string }
    >;
    estimate: () => Promise<WocEstimateView | null>;
    history: () => Promise<{ ok: true; sales: WocSaleView[] } | { ok: false; code: string }>;
    sellerHistory: () => Promise<
      { ok: true; sales: WocSaleView[]; seller: WocSellerView | null } | { ok: false; code: string }
    >;
    me: () => Promise<{ ok: true; activity: WocActivityView } | { ok: false; code: string }>;
    stepUpChallenge: () => Promise<
      { ok: true; challenge: WocStepUpChallenge } | { ok: false; code: string }
    >;
    createListing: () => Promise<
      { ok: true; listing: WocListingView } | { ok: false; code: string }
    >;
    cancelListing: () => Promise<
      { ok: true; cancelPending?: boolean } | { ok: false; code: string }
    >;
  };
}

function fakeClient(rows: WocListingView[] = [listing(1)]): FakeClient {
  const calls: string[] = [];
  const answers: FakeClient['answers'] = {
    status: async () => status(),
    browse: async () => ({ ok: true, hasMore: false, page: 0, listings: rows }),
    detail: async () => ({
      ok: true,
      listing: rows[0] ?? listing(1),
      estimate: {
        available: true,
        usdCents: 2500,
        amount: { base: '0', tokens: 195.3 },
        asOfMs: NOW,
      },
    }),
    estimate: async () => ({
      available: true,
      usdCents: 100,
      amount: { base: '0', tokens: 78.1 },
      asOfMs: NOW,
      // The seller's resolved fee rides the same estimate call. Present here so
      // a case can drive the sell form's fee line; an older service sends none,
      // which the window renders as no figure at all.
      split: { sellerCents: 90, burnCents: 3, treasuryCents: 7 },
    }),
    history: async () => ({ ok: true, sales: [] }),
    sellerHistory: async () => ({
      ok: true,
      sales: [
        {
          id: 1,
          itemId: EPIC,
          priceCents: 2500,
          sellerName: 'Aurelia',
          buyerName: 'Borin',
          atMs: NOW - 60_000,
        },
      ],
      seller: { guildName: 'Monarchs' },
    }),
    me: async () => ({ ok: true, activity: EMPTY_ACTIVITY }),
    stepUpChallenge: async () => ({
      ok: true,
      challenge: { nonce: 'n1', message: 'sign me', expiresAtMs: NOW + 60_000 },
    }),
    createListing: async () => ({ ok: true, listing: listing(9, { mine: true }) }),
    cancelListing: async () => ({ ok: true }),
  };
  const record =
    <K extends keyof FakeClient['answers']>(name: K) =>
    (...args: unknown[]) => {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return answers[name]();
    };
  const client = {
    status: record('status'),
    browse: record('browse'),
    detail: record('detail'),
    estimate: record('estimate'),
    history: record('history'),
    sellerHistory: record('sellerHistory'),
    me: record('me'),
    stepUpChallenge: record('stepUpChallenge'),
    createListing: record('createListing'),
    cancelListing: record('cancelListing'),
    // Reached only by arms this rig does not drive; a throw names the gap.
    placeBid: () => {
      throw new Error('placeBid is not staged in this rig');
    },
    buyNow: () => {
      throw new Error('buyNow is not staged in this rig');
    },
    bondQuote: () => {
      throw new Error('bondQuote is not staged in this rig');
    },
    confirmBond: () => {
      throw new Error('confirmBond is not staged in this rig');
    },
    settlementQuote: () => {
      throw new Error('settlementQuote is not staged in this rig');
    },
    confirmSettlement: () => {
      throw new Error('confirmSettlement is not staged in this rig');
    },
    abandonBid: () => {
      throw new Error('abandonBid is not staged in this rig');
    },
  } as unknown as WocMarketClient;
  return { client, calls, answers };
}

interface Rig {
  win: WocMarketWindow;
  root: HTMLElement;
  fake: FakeClient;
  hooks: WocMarketHooks;
  signMessage: ReturnType<typeof vi.fn>;
  signAndSend: ReturnType<typeof vi.fn>;
  world: { inventory: InvSlot[] };
  tooltips: Map<Element, () => string>;
  closeOthers: ReturnType<typeof vi.fn<() => void>>;
  restoreFocus: ReturnType<typeof vi.fn<(target: HTMLElement | null) => void>>;
  openWallet: ReturnType<typeof vi.fn<() => void>>;
  refreshWocBalance: ReturnType<typeof vi.fn<(force?: boolean) => void>>;
}

function rig(
  over: { inventory?: InvSlot[]; rows?: WocListingView[]; walletLinked?: boolean } = {},
): Rig {
  const fake = fakeClient(over.rows);
  const signMessage = vi.fn(async () => 'sig');
  const signAndSend = vi.fn(async () => 'txsig');
  const hooks: WocMarketHooks = {
    client: fake.client,
    characterId: () => 1,
    walletLinked: () => over.walletLinked ?? true,
    signAndSendTransactionBase64:
      signAndSend as unknown as WocMarketHooks['signAndSendTransactionBase64'],
    signMessageBase58: signMessage as unknown as WocMarketHooks['signMessageBase58'],
  };
  const root = document.createElement('div');
  root.id = 'woc-market-window';
  root.style.display = 'none';
  document.body.appendChild(root);
  const world = { inventory: over.inventory ?? [{ itemId: EPIC, count: 1 }] };
  const tooltips = new Map<Element, () => string>();
  const closeOthers = vi.fn<() => void>();
  const restoreFocus = vi.fn<(target: HTMLElement | null) => void>();
  const openWallet = vi.fn<() => void>();
  const refreshWocBalance = vi.fn<(force?: boolean) => void>();
  const deps: WocMarketWindowDeps = {
    root: () => root,
    world: () => world as unknown as IWorld,
    hooks: () => hooks,
    closeOthers,
    hideTooltip: () => {},
    attachTooltip: (el, html) => {
      tooltips.set(el, html);
    },
    itemTooltip: (item) => `<b>${item.id}</b>`,
    captureFocus: () => document.activeElement as HTMLElement | null,
    restoreFocus,
    openWallet,
    refreshWocBalance,
  };
  const win = new WocMarketWindow(deps);
  return {
    win,
    root,
    fake,
    hooks,
    signMessage,
    signAndSend,
    world,
    tooltips,
    closeOthers,
    restoreFocus,
    openWallet,
    refreshWocBalance,
  };
}

const q = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  setLanguage('en');
  onWalletUiChange(() => {});
  // The Solana wallet card reads the shared connection state (wallet_balance),
  // the same module the window's balance gate reads; each test starts from the
  // feature-off default so only the wallet arms below paint the card.
  setWalletUiEnabled(false);
  setWalletConnectionAddresses(null, null);
  setWocBalance(null);
});

describe('WocMarketWindow live rig: open, browse, select', () => {
  it('open() paints the loading state, fetches status + browse + me, then paints the table', async () => {
    const r = rig();
    r.win.open();
    // Synchronous first paint: the header and the loading line, before any
    // answer lands, and the other windows were told to close.
    expect(r.root.style.display).toBe('flex');
    expect(r.refreshWocBalance).toHaveBeenCalledTimes(1);
    expect(r.closeOthers).toHaveBeenCalledTimes(1);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.loading'));
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('status:')).length).toBe(1);
    expect(r.fake.calls.filter((c) => c.startsWith('browse:')).length).toBe(1);
    expect(r.fake.calls.filter((c) => c.startsWith('me:')).length).toBe(1);
    const rows = r.root.querySelectorAll('.wm-table tbody tr.wm-row');
    expect(rows.length).toBe(1);
    expect(q(r.root, '.wm-row-open').textContent).toContain(NAME_OF(EPIC));
    // The item cell carries the shared stat tooltip (bound after each rebuild).
    expect([...r.tooltips.keys()].some((el) => el.classList.contains('wm-name'))).toBe(true);
    // The rate note renders the server's price print through the formatters,
    // and says outright that the figure is per ONE dollar.
    expect(r.root.querySelector('.wm-rate')?.textContent).toContain('7,812.5');
    expect(r.root.querySelector('.wm-rate')?.textContent).toContain('per $1.00 USD');
  });

  it('a row click loads the detail (detail, estimate for buy-now, history) and paints the bid form', async () => {
    const r = rig({ rows: [listing(1, { buyNowCents: 9900 })] });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('detail:')).length).toBe(1);
    expect(r.fake.calls.filter((c) => c.startsWith('estimate:')).length).toBe(1);
    expect(r.fake.calls.filter((c) => c.startsWith('history:')).length).toBe(1);
    expect(r.root.querySelector('.wm-detail')).not.toBeNull();
    expect(r.root.querySelector('input[data-field="bid-usd"]')).not.toBeNull();
    expect(r.root.querySelector('button[data-action="buy-now"]')).not.toBeNull();
    // The disclosures precede the commit control in DOM order (node positions,
    // never indexOf: a renamed class must not pass as -1 < N), and so does the
    // toggle that reveals them: the reading order stays terms, then commit.
    const note = q(r.root, '.wm-bid-form .wm-disclosures p');
    const toggle = q(r.root, '.wm-bid-form .wm-terms-toggle');
    const btn = q(r.root, 'button[data-action="place-bid"]');
    expect(note.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the bid terms well starts collapsed, expands on its toggle, and survives a rebuild', async () => {
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    // Collapsed by default: the well is composed (its figures resolved) but
    // hidden, and the toggle says so, which is what keeps Place bid above the
    // fold. The well never leaves the DOM: H13's disclosures stay ahead of the
    // commit control in reading order whichever state the toggle is in.
    const well = q(r.root, '.wm-bid-form .wm-disclosures');
    const toggle = q<HTMLButtonElement>(r.root, '.wm-bid-form .wm-terms-toggle');
    expect(well.hasAttribute('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(well.id);
    toggle.focus();
    toggle.click();
    await flush();
    const openWell = q(r.root, '.wm-bid-form .wm-disclosures');
    expect(openWell.hasAttribute('hidden')).toBe(false);
    expect(q(r.root, '.wm-bid-form .wm-terms-toggle').getAttribute('aria-expanded')).toBe('true');
    // The rebuild kept the keyboard player's place on the toggle it re-made.
    expect(document.activeElement).toBe(q(r.root, '.wm-bid-form .wm-terms-toggle'));
    // An expanded well is painter state, not DOM state: a poll-band rebuild
    // repaints it open rather than silently re-collapsing it mid-read.
    r.win.render();
    expect(q(r.root, '.wm-bid-form .wm-disclosures').hasAttribute('hidden')).toBe(false);
    // Close resets the preference: the next visit starts compact again.
    r.win.close();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    expect(q(r.root, '.wm-bid-form .wm-disclosures').hasAttribute('hidden')).toBe(true);
  });

  it('the Solana wallet card stands above the Browse filters and carries the connect shortcut into the shared flow', async () => {
    setWalletUiEnabled(true);
    const r = rig({ walletLinked: false });
    r.win.open();
    await flush();
    const card = q<HTMLElement>(r.root, '.wm-strip .wm-banner-wallet');
    expect(card.getAttribute('data-wallet-kind')).toBe('unlinked');
    expect(card.querySelector('strong')?.textContent).toBe(t('hudChrome.wocStore.wallet.title'));
    expect(card.querySelector('p')?.textContent).toBe(t('hudChrome.wocStore.wallet.unlinked'));
    // Above the filters: the strip precedes the tab panel that holds the sort
    // and filter row, so the card is the first thing under the tabs.
    const strip = q<HTMLElement>(r.root, '.wm-strip');
    const panel = q<HTMLElement>(r.root, '#woc-market-panel');
    expect(strip.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.querySelector('.wm-browse select, .wm-browse input')).not.toBeNull();
    const button = q<HTMLButtonElement>(card, 'button[data-action="connect-wallet"]');
    expect(button.textContent).toBe(t('hudChrome.wocStore.wallet.connect'));
    button.click();
    expect(r.openWallet).toHaveBeenCalledTimes(1);
  });

  it("a linked wallet keeps the card with the Claudium panel's Manage / Reconnect button, and a wallet change repaints it", async () => {
    setWalletUiEnabled(true);
    setWalletConnectionAddresses('linked', 'linked');
    setWocBalance(15_625, true);
    const r = rig({ walletLinked: true });
    r.win.open();
    await flush();
    const manage = q<HTMLButtonElement>(
      r.root,
      '.wm-banner-wallet button[data-action="connect-wallet"]',
    );
    expect(manage.textContent).toBe(t('hudChrome.wocStore.wallet.manage'));
    expect(q(r.root, '.wm-banner-wallet p').textContent).toBe(
      t('hudChrome.wocMarket.walletLinkedConnected'),
    );
    expect(q(r.root, '.wm-wallet-balance').textContent).toContain('15,625 $WOC');
    expect(q(r.root, '.wm-wallet-balance').textContent).toContain('$2.00 USD');
    manage.focus();
    const unchangedCard = q(r.root, '.wm-banner-wallet');
    r.win.onWalletChanged();
    expect(q(r.root, '.wm-banner-wallet')).toBe(unchangedCard);
    // A balance-only update keeps the connection kind unchanged, but the
    // Exchange still repaints the amount beside the Manage button.
    onWalletUiChange(() => r.win.onWalletChanged());
    setWocBalance(7_812.5, true);
    expect(q(r.root, '.wm-wallet-balance').textContent).toContain('7,812.5 $WOC');
    expect(q(r.root, '.wm-wallet-balance').textContent).toContain('$1.00 USD');
    expect(document.activeElement).toBe(
      q(r.root, '.wm-banner-wallet button[data-action="connect-wallet"]'),
    );
    // The wallet app disconnects: the Hud's onWalletUiChange fan-out reaches
    // the window, which repaints the card (no digest moves for this) and keeps
    // the player's focus on the button they were on.
    setWalletConnectionAddresses('linked', null);
    r.win.onWalletChanged();
    const reconnect = q<HTMLButtonElement>(
      r.root,
      '.wm-banner-wallet button[data-action="connect-wallet"]',
    );
    expect(reconnect.textContent).toBe(t('hudChrome.wocStore.wallet.reconnect'));
    expect(q(r.root, '.wm-banner-wallet').getAttribute('data-wallet-kind')).toBe(
      'linked_disconnected',
    );
    expect(q(r.root, '.wm-banner-wallet p').textContent).toBe(
      t('hudChrome.wocMarket.walletLinkedDisconnected'),
    );
    expect(q(r.root, '.wm-wallet-balance').textContent).toContain('7,812.5 $WOC');
    expect(q(r.root, '.wm-wallet-balance').textContent).toContain('$1.00 USD');
    expect(document.activeElement).toBe(reconnect);
    reconnect.click();
    expect(r.openWallet).toHaveBeenCalledTimes(1);
  });

  it('paints no wallet card when the wallet feature is off in this build', async () => {
    const r = rig({ walletLinked: false });
    r.win.open();
    await flush();
    expect(r.root.querySelector('.wm-banner-wallet')).toBeNull();
    expect(r.root.querySelector('button[data-action="connect-wallet"]')).toBeNull();
  });

  it('a filter change restarts at page one and rides the browse request', async () => {
    const r = rig();
    r.win.open();
    await flush();
    const quality = q<HTMLSelectElement>(r.root, 'select[data-field="filter-quality"]');
    quality.value = 'legendary';
    quality.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
      r.fake.calls.some(
        (c) =>
          c.startsWith('browse:') && c.includes('"quality":"legendary"') && c.includes('"page":0'),
      ),
    ).toBe(true);
    const format = q<HTMLSelectElement>(r.root, 'select[data-field="filter-format"]');
    format.value = 'buy_now';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
      r.fake.calls.some((c) => c.startsWith('browse:') && c.includes('"format":"buy_now"')),
    ).toBe(true);
    // The rebuilt selects keep showing the applied filters (class state,
    // never DOM state, the poll-rebuild rule). Asserted on the selected
    // ATTRIBUTE the markup carries: happy-dom's select.value does not honor
    // parsed selected attributes, while real browsers do.
    expect(
      q(r.root, 'select[data-field="filter-quality"] option[value="legendary"]').hasAttribute(
        'selected',
      ),
    ).toBe(true);
    expect(
      q(r.root, 'select[data-field="filter-format"] option[value="buy_now"]').hasAttribute(
        'selected',
      ),
    ).toBe(true);
  });

  it('the item search resolves names to ids on change; a no-match query paints empty and never asks', async () => {
    const r = rig();
    r.win.open();
    await flush();
    const input = q<HTMLInputElement>(r.root, 'input[data-field="filter-item"]');
    input.value = NAME_OF(EPIC);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(r.fake.calls.some((c) => c.startsWith('browse:') && c.includes(`"${EPIC}"`))).toBe(true);
    // A query matching nothing paints the empty face locally: the SDK omits
    // an empty itemIds param (which would read as NO filter and show
    // everything), so the server is never asked.
    const asked = r.fake.calls.filter((c) => c.startsWith('browse:')).length;
    const rebuilt = q<HTMLInputElement>(r.root, 'input[data-field="filter-item"]');
    rebuilt.value = 'zzz no such item zzz';
    rebuilt.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('browse:')).length).toBe(asked);
    expect(r.root.querySelector('.wm-table')).toBeNull();
  });

  it('the seller cell opens their recent trades and Back restores the browse', async () => {
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, 'button[data-action="seller-view"]').click();
    await flush();
    expect(r.fake.calls.some((c) => c.startsWith('sellerHistory:') && c.includes('Aurelia'))).toBe(
      true,
    );
    const pane = q(r.root, '.wm-seller-pane');
    expect(pane.textContent).toContain('Aurelia');
    expect(pane.textContent).toContain(NAME_OF(EPIC));
    expect(pane.textContent).toContain('Borin');
    // The public profile line: the classic <Guild> tag beside the title, the
    // one fact the world already shows. The character-age line was dropped as
    // an unspecced disclosure, so the pane carries no wm-seller-meta.
    expect(q(r.root, '.wm-seller-guild').textContent).toBe('<Monarchs>');
    expect(r.root.querySelector('.wm-seller-meta')).toBeNull();
    // Back restores the table: page, sort and filters all live on the class.
    q<HTMLButtonElement>(r.root, 'button[data-action="seller-back"]').click();
    await flush();
    expect(r.root.querySelector('.wm-seller-pane')).toBeNull();
    expect(r.root.querySelector('.wm-table')).not.toBeNull();
  });

  it('a seller whose name no longer resolves renders no profile rows', async () => {
    const r = rig();
    r.fake.answers.sellerHistory = async () => ({ ok: true, sales: [], seller: null });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, 'button[data-action="seller-view"]').click();
    await flush();
    expect(r.root.querySelector('.wm-seller-guild')).toBeNull();
    expect(r.root.querySelector('.wm-seller-meta')).toBeNull();
    expect(q(r.root, '.wm-seller-pane').textContent).toContain(
      t('hudChrome.wocMarket.sellerEmpty'),
    );
  });

  it('the category filter rides the browse request and drops its subcategory on change', async () => {
    const r = rig();
    r.win.open();
    await flush();
    const category = q<HTMLSelectElement>(r.root, 'select[data-field="filter-category"]');
    category.value = 'weapon';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
      r.fake.calls.some((c) => c.startsWith('browse:') && c.includes('"category":"weapon"')),
    ).toBe(true);
    // The dependent Type select appears for weapons and carries the weapon
    // vocabulary; picking one rides the request.
    const sub = q<HTMLSelectElement>(r.root, 'select[data-field="filter-subcategory"]');
    sub.value = 'sword';
    sub.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
      r.fake.calls.some((c) => c.startsWith('browse:') && c.includes('"subcategory":"sword"')),
    ).toBe(true);
    // Switching category DROPS the finer axis: a sword filter under Armor
    // would silently show nothing.
    const again = q<HTMLSelectElement>(r.root, 'select[data-field="filter-category"]');
    again.value = 'armor';
    again.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(
      r.fake.calls.some(
        (c) =>
          c.startsWith('browse:') &&
          c.includes('"category":"armor"') &&
          c.includes('"subcategory":null'),
      ),
    ).toBe(true);
  });

  it('the quality vocabulary widens to uncommon while mounts are allowed', async () => {
    const r = rig();
    r.fake.answers.status = async () => status({ allowMounts: true });
    r.win.open();
    await flush();
    const quality = q<HTMLSelectElement>(r.root, 'select[data-field="filter-quality"]');
    expect(quality.querySelector('option[value="uncommon"]')).not.toBeNull();
    expect(quality.querySelector('option[value="rare"]')).not.toBeNull();
  });

  it('page-next asks the server for the next page and page-prev walks back', async () => {
    const r = rig();
    r.fake.answers.browse = async () => ({
      ok: true,
      hasMore: true,
      page: 0,
      listings: [listing(1)],
    });
    r.win.open();
    await flush();
    const next = q<HTMLButtonElement>(r.root, 'button[data-action="page-next"]');
    next.focus();
    next.click();
    await flush();
    expect(r.fake.calls.some((c) => c.startsWith('browse:') && c.includes('"page":1'))).toBe(true);
    // The rebuild kept the keyboard player's place on the pager: the rebuilt
    // Next button holds focus (or Prev, when the page it landed on is the last).
    const rebuiltNext = q<HTMLButtonElement>(r.root, 'button[data-action="page-next"]');
    expect(rebuiltNext).not.toBe(next);
    expect(document.activeElement).toBe(rebuiltNext);
    // Land on a last page: next rebuilds disabled, so the ladder falls to prev.
    r.fake.answers.browse = async () => ({
      ok: true,
      hasMore: false,
      page: 2,
      listings: [listing(1)],
    });
    rebuiltNext.click();
    await flush();
    expect(q<HTMLButtonElement>(r.root, 'button[data-action="page-next"]').disabled).toBe(true);
    expect(document.activeElement).toBe(q(r.root, 'button[data-action="page-prev"]'));
    q<HTMLButtonElement>(r.root, 'button[data-action="page-prev"]').click();
    await flush();
    const pages = r.fake.calls
      .filter((c) => c.startsWith('browse:'))
      .map((c) => Number(/"page":(\d+)/.exec(c)?.[1]));
    expect(pages).toEqual([0, 1, 2, 1]);
  });

  it('a silent poll blip keeps the old rows and shows no error line', async () => {
    const r = rig();
    r.win.open();
    await flush();
    expect(r.root.querySelectorAll('.wm-row').length).toBe(1);
    // The background poll: a blipped answer must not replace the list.
    r.fake.answers.browse = async () => ({ ok: false, code: 'unavailable' });
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 120_000);
    r.win.refreshIfChanged();
    await flush();
    expect(r.root.querySelectorAll('.wm-row').length).toBe(1);
    expect(r.root.textContent).not.toContain(t('hudChrome.wocMarket.browseError'));
    vi.restoreAllMocks();
  });
});

describe('WocMarketWindow live rig: tabs, rebuild, focus and scroll', () => {
  it('switching tabs clears the notice and paints the sell picker; the tab strip keeps aria state', async () => {
    const r = rig();
    r.fake.answers.me = async () => ({
      ...({ ok: true } as const),
      activity: {
        ...EMPTY_ACTIVITY,
        listings: [listing(5, { mine: true, currentBidCents: null })],
      },
    });
    r.fake.answers.cancelListing = async () => ({ ok: false, code: 'woc_market.not_yours' });
    r.win.open();
    await flush();
    // Stage a real notice: a refused cancel on the Activity tab paints the
    // error toast in the footer bar.
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="activity"]').click();
    q<HTMLButtonElement>(r.root, 'button[data-action="cancel-listing"][data-listing="5"]').click();
    await flush();
    const notice = q(r.root, '.wm-notice');
    expect(notice.classList.contains('wm-notice-error')).toBe(true);
    // The tab switch clears it and paints the sell picker.
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    expect(r.root.querySelector('.wm-notice')).toBeNull();
    expect(q(r.root, '.wm-tab[data-tab="sell"]').getAttribute('aria-selected')).toBe('true');
    expect(r.root.querySelector('.wm-combo-input')).not.toBeNull();
    expect(r.root.querySelector('.wm-table')).toBeNull();
  });

  it('the terms checkbox and the focused control survive a slow-band rebuild', async () => {
    const r = rig({ rows: [listing(1, { format: 'buy_now', buyNowCents: 9900 })] });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    const box = q<HTMLInputElement>(r.root, 'input[data-field="accept-terms"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const buy = q<HTMLButtonElement>(r.root, 'button[data-action="buy-now"]');
    buy.focus();
    expect(document.activeElement).toBe(buy);
    // A rebuild replaces the whole subtree; the painter-held state repaints
    // the box checked, and the focus key lands back on the same control.
    r.win.render();
    const boxAfter = q<HTMLInputElement>(r.root, 'input[data-field="accept-terms"]');
    expect(boxAfter).not.toBe(box);
    expect(boxAfter.checked).toBe(true);
    const buyAfter = q<HTMLButtonElement>(r.root, 'button[data-action="buy-now"]');
    expect(buyAfter).not.toBe(buy);
    expect(document.activeElement).toBe(buyAfter);
  });

  it('carries a typed bid and its caret across a rebuild (the form draft)', async () => {
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    // A number input exposes no selection API, so the value and the focus are
    // the carry this arm can prove; the caret half rides the sell search box.
    const bid = q<HTMLInputElement>(r.root, 'input[data-field="bid-usd"]');
    bid.value = '12.5';
    bid.focus();
    r.win.render();
    const rebuilt = q<HTMLInputElement>(r.root, 'input[data-field="bid-usd"]');
    expect(rebuilt).not.toBe(bid);
    expect(rebuilt.value).toBe('12.5');
    expect(document.activeElement).toBe(rebuilt);
    // The text search box carries its caret too: the rebuilt input is handed
    // the captured range (happy-dom re-homes a caret on a repeated focus()
    // call where a browser does not, so the carry is proven at the call).
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const search = q<HTMLInputElement>(r.root, '.wm-combo-input');
    search.value = 'war';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const typedSearch = q<HTMLInputElement>(r.root, '.wm-combo-input');
    typedSearch.focus();
    typedSearch.setSelectionRange(1, 1);
    const ranges: [number, number][] = [];
    const spy = vi
      .spyOn(HTMLInputElement.prototype, 'setSelectionRange')
      .mockImplementation(function (this: HTMLInputElement, a, b) {
        ranges.push([Number(a), Number(b)]);
      });
    r.win.render();
    spy.mockRestore();
    const rebuiltSearch = q<HTMLInputElement>(r.root, '.wm-combo-input');
    expect(rebuiltSearch).not.toBe(typedSearch);
    expect(rebuiltSearch.value).toBe('war');
    expect(document.activeElement).toBe(rebuiltSearch);
    expect(ranges).toContainEqual([1, 1]);
  });

  it('keeps the detail pane scroll on the same listing and resets it on another', async () => {
    const r = rig({
      rows: [listing(1), listing(2, { itemId: EPIC_TWO, item: { itemId: EPIC_TWO, count: 1 } })],
    });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open[data-listing="1"]').click();
    await flush();
    q<HTMLElement>(r.root, '.wm-detail').scrollTop = 40;
    r.win.render();
    expect(q<HTMLElement>(r.root, '.wm-detail').scrollTop).toBe(40);
    r.fake.answers.detail = async () => ({
      ok: true,
      listing: listing(2, { itemId: EPIC_TWO, item: { itemId: EPIC_TWO, count: 1 } }),
      estimate: null,
    });
    q<HTMLButtonElement>(r.root, '.wm-row-open[data-listing="2"]').click();
    await flush();
    expect(q<HTMLElement>(r.root, '.wm-detail').scrollTop).toBe(0);
  });

  it('keeps the body scroll offset across a same-tab rebuild and resets it on a tab change', async () => {
    const r = rig();
    r.win.open();
    await flush();
    const body = q<HTMLElement>(r.root, '.wm-body');
    // happy-dom lays nothing out, so scrollTop is a plain settable property
    // here: the pin is about the read-before-rebuild / write-after-rebuild
    // pair, not about pixels.
    body.scrollTop = 120;
    r.win.render();
    expect(q<HTMLElement>(r.root, '.wm-body').scrollTop).toBe(120);
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="activity"]').click();
    expect(q<HTMLElement>(r.root, '.wm-body').scrollTop).toBe(0);
  });

  it('relocalize() repaints the window in the new language (a stored state, not a stored sentence)', async () => {
    const r = rig();
    r.fake.answers.browse = async () => ({
      ok: true,
      hasMore: true,
      page: 0,
      listings: [listing(1)],
    });
    r.win.open();
    await flush();
    // A browse the player asked for (page-next) that fails paints the error
    // line; the failure is stored as STATE and resolved at render, so a
    // language switch repaints it in the new language.
    r.fake.answers.browse = async () => ({ ok: false, code: 'unavailable' });
    q<HTMLButtonElement>(r.root, 'button[data-action="page-next"]').click();
    await flush();
    const english = t('hudChrome.wocMarket.browseError');
    expect(r.root.textContent).toContain(english);
    // The dense locale table is lazy: resident before the synchronous switch,
    // exactly the order the client's language fan-out awaits.
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const japanese = t('hudChrome.wocMarket.browseError');
    expect(japanese, 'the arm needs a locale whose value differs').not.toBe(english);
    r.win.relocalize();
    expect(r.root.textContent).toContain(japanese);
    expect(r.root.textContent).not.toContain(english);
    setLanguage('en');
  });
});

describe('WocMarketWindow live rig: the sell combobox', () => {
  it('opens on focus, filters as you type, commits on mousedown, and Clear returns to search', async () => {
    const r = rig({
      inventory: [
        { itemId: EPIC, count: 1 },
        { itemId: EPIC_TWO, count: 1 },
      ],
    });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(q(r.root, '.wm-combo-list').hasAttribute('hidden')).toBe(false);
    expect(r.root.querySelectorAll('.wm-combo-item').length).toBe(2);
    const typed = q<HTMLInputElement>(r.root, '.wm-combo-input');
    typed.value = NAME_OF(EPIC_TWO).slice(0, 6).toLowerCase();
    typed.dispatchEvent(new Event('input', { bubbles: true }));
    expect(r.root.querySelectorAll('.wm-combo-item').length).toBe(1);
    expect(q(r.root, '.wm-combo-item').textContent).toContain(NAME_OF(EPIC_TWO));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // Committed: the chosen cell replaces the input and the form appears.
    expect(r.root.querySelector('.wm-combo-chosen')).not.toBeNull();
    expect(r.root.querySelector('.wm-sell-form')).not.toBeNull();
    expect(q(r.root, '.wm-combo-chosen').textContent).toContain(NAME_OF(EPIC_TWO));
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-clear"]').click();
    expect(r.root.querySelector('.wm-combo-input')).not.toBeNull();
    expect(r.root.querySelector('.wm-sell-form')).toBeNull();
  });
});

describe('WocMarketWindow live rig: the sell form draft', () => {
  it('carries the typed sell prices and the focus across the fee rebuild', async () => {
    // The fee round trip calls render(), so the SELL fields are the ones that
    // rebuild under the seller's hands now. The generic form-draft carry keys
    // on data-field and covers them, which is exactly the sort of thing that
    // stays true until someone renames a field.
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const start = q<HTMLInputElement>(r.root, '[data-field="sell-start"]');
    start.value = '42.25';
    start.focus();
    const buyNow = q<HTMLInputElement>(r.root, '[data-field="sell-buy-now"]');
    buyNow.value = '99';
    // The fee lands and rebuilds the form under both fields.
    start.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    const startAfter = q<HTMLInputElement>(r.root, '[data-field="sell-start"]');
    const buyNowAfter = q<HTMLInputElement>(r.root, '[data-field="sell-buy-now"]');
    expect(startAfter, 'the form really was rebuilt').not.toBe(start);
    expect(startAfter.value).toBe('42.25');
    expect(buyNowAfter.value).toBe('99');
    expect(document.activeElement, 'the seller keeps their place').toBe(startAfter);
  });
});

describe('WocMarketWindow live rig: the seller fee figure', () => {
  it('re-derives the fee when the format changes, instead of leaving the old one up', async () => {
    // The fee is resolved by the SERVER for the price typed, and the format
    // select rebuilds the form under it (an auction keeps an optional buy-now
    // beside its reserve; a pure buy-now forbids the reserve). The contract
    // pinned here: after a format change the figure on screen was asked for
    // again, never carried over from the previous form. Leaving it up is how a
    // stale money figure would sit in the one spot the copy promises the fee
    // for the price entered.
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const format = q<HTMLSelectElement>(r.root, '[data-field="sell-format"]');
    format.value = 'buy_now';
    format.dispatchEvent(new Event('change', { bubbles: true }));
    const price = q<HTMLInputElement>(r.root, '[data-field="sell-buy-now"]');
    price.value = '100';
    // Typing alone must NOT ask the server: the estimate shares a per-minute
    // bucket with the bond quote, the settlement quote and the refresh, so a
    // seller trying prices could spend what the payment path needs.
    price.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('estimate:')).length).toBe(0);
    price.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(r.root.querySelectorAll('.wm-sell-fee').length).toBe(2);
    const before = r.fake.calls.filter((c) => c.startsWith('estimate:')).length;
    // Swap the format. The typed price rides the form draft, so the fee is
    // still true, but it must be RE-ASKED rather than left standing.
    const swap = q<HTMLSelectElement>(r.root, '[data-field="sell-format"]');
    swap.value = 'auction';
    swap.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(q<HTMLInputElement>(r.root, '[data-field="sell-buy-now"]').value).toBe('100');
    expect(r.fake.calls.filter((c) => c.startsWith('estimate:')).length).toBeGreaterThan(before);
    expect(r.root.querySelectorAll('.wm-sell-fee').length).toBe(2);
  });

  it('takes the fee line away when the price the form carried is emptied', async () => {
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const price = q<HTMLInputElement>(r.root, '[data-field="sell-start"]');
    price.value = '25';
    price.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(r.root.querySelectorAll('.wm-sell-fee').length).toBe(2);
    const cleared = q<HTMLInputElement>(r.root, '[data-field="sell-start"]');
    cleared.value = '';
    cleared.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(r.root.querySelectorAll('.wm-sell-fee').length).toBe(0);
  });
});

describe('WocMarketWindow live rig: the sell combobox keyboard', () => {
  it("Escape closes the open listbox and the rebuild's own focusin does not reopen it", async () => {
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(q(r.root, '.wm-combo-list').hasAttribute('hidden')).toBe(false);
    q<HTMLInputElement>(r.root, '.wm-combo-input').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    // Closed, focus restored onto the rebuilt input (the restore fires a
    // focusin the painter must ignore, or Escape could never close).
    expect(q(r.root, '.wm-combo-list').hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(q(r.root, '.wm-combo-input'));
  });
});

describe('WocMarketWindow live rig: focus return', () => {
  it('close() hands focus back to the ORIGINAL opener, captured before closeOthers moved it', async () => {
    const r = rig();
    const opener = document.createElement('button');
    const other = document.createElement('button');
    document.body.append(opener, other);
    opener.focus();
    // closeOthers (the Hud closing sibling windows) moves focus first; the
    // capture must already have happened.
    r.closeOthers.mockImplementation(() => other.focus());
    r.win.open();
    await flush();
    r.win.close();
    expect(r.restoreFocus).toHaveBeenCalledTimes(1);
    expect(r.restoreFocus).toHaveBeenCalledWith(opener);
  });
});

describe('WocMarketWindow live rig: Activity settlement faces', () => {
  it('names each settlement state in its own words and offers Pay only on offered / failed rows', async () => {
    const r = rig();
    const settlement = (id: number, state: string) => ({
      id,
      listingId: 1,
      itemId: EPIC,
      attempt: 1,
      amountCents: 2500,
      state,
      quoteReference: null,
      quoteExpiresAtMs: null,
      failReason: state === 'failed' ? 'burn_mismatch' : null,
      deadlineAtMs: NOW + 600_000,
      createdAtMs: NOW - 1000,
    });
    r.fake.answers.me = async () => ({
      ok: true,
      activity: {
        ...EMPTY_ACTIVITY,
        settlements: [
          settlement(1, 'offered'),
          settlement(2, 'confirming'),
          settlement(3, 'review'),
          settlement(4, 'delivered'),
          settlement(5, 'failed'),
        ],
      },
    });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="activity"]').click();
    const rows = [...r.root.querySelectorAll('.wm-activity li')];
    expect(rows.length).toBe(5);
    const textOf = (i: number) => rows[i]?.textContent ?? '';
    expect(textOf(0)).toContain(t('hudChrome.wocMarket.settlementOffered'));
    expect(textOf(1)).toContain(t('hudChrome.wocMarket.settlementConfirming'));
    expect(textOf(2)).toContain(t('hudChrome.wocMarket.settlementReview'));
    expect(textOf(3)).toContain(t('hudChrome.wocMarket.settlementDelivered'));
    expect(textOf(4)).toContain(t('hudChrome.wocMarket.settlementFailed'));
    // Pay: offered and failed only; the failed row carries its WHY sentence.
    const payRows = rows.map((row) => row.querySelector('[data-action="pay-settlement"]') !== null);
    expect(payRows).toEqual([true, false, false, false, true]);
    expect(rows[4]?.querySelector('.wm-fail-why')?.textContent).toBe(
      t('hudChrome.wocMarket.settlementFailBurnMismatch'),
    );
    // The countdown carries the exact deadline as its tooltip.
    const due = rows[0]?.querySelector<HTMLElement>('[data-tip-key]');
    expect(due).not.toBeNull();
    expect(r.tooltips.get(due as Element)?.()).toContain('UTC');
  });
});

describe('WocMarketWindow live rig: the busyGen close guard', () => {
  async function stageSell(r: Rig): Promise<void> {
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    q<HTMLInputElement>(r.root, 'input[data-field="sell-start"]').value = '25';
  }

  it('a close() under a hung wallet signer abandons the run: no createListing, and the reopened window is not busy', async () => {
    const r = rig();
    const hung = deferred<string>();
    r.signMessage.mockImplementation(() => hung.promise);
    await stageSell(r);
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    // The mint went out and the busy face is up with the wallet label.
    expect(r.fake.calls.filter((c) => c.startsWith('stepUpChallenge:')).length).toBe(1);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.signing'));
    expect(q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').disabled).toBe(true);
    // The player closes the window over the popup, then reopens it.
    r.win.close();
    expect(r.root.style.display).toBe('none');
    r.win.open();
    await flush();
    expect(r.root.textContent).not.toContain(t('hudChrome.wocMarket.signing'));
    // The signature resolves LATE: the abandoned run must send nothing and
    // must not repaint over the reopened window's state.
    hung.resolve('late-sig');
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('createListing:')).length).toBe(0);
    expect(r.root.textContent).not.toContain(t('hudChrome.wocMarket.listingCreated'));
    // A fresh attempt on the reopened window sends exactly one create. The
    // Exchange keeps its picked item across a close (documented in close()),
    // so the reopened Sell tab is still staged: only the price is re-typed.
    r.signMessage.mockImplementation(async () => 'sig');
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    expect(r.root.querySelector('.wm-combo-chosen')).not.toBeNull();
    q<HTMLInputElement>(r.root, 'input[data-field="sell-start"]').value = '25';
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('createListing:')).length).toBe(1);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.listingCreated'));
  });

  it('a 25c pure buy-now sends startCents equal to the price, not price minus one', async () => {
    // The synthesized start for a pure buy-now is the price itself, not
    // price - 1: at the 25c floor, price - 1 = 24 fell under the minimum and
    // the server refused with an unactionable bad_start AFTER the wallet
    // step-up. Assert the exact figures the client puts on the wire.
    const r = rig();
    r.signMessage.mockImplementation(async () => 'sig');
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    q<HTMLSelectElement>(r.root, '[data-field="sell-format"]').value = 'buy_now';
    q<HTMLSelectElement>(r.root, '[data-field="sell-format"]').dispatchEvent(
      new Event('change', { bubbles: true }),
    );
    q<HTMLInputElement>(r.root, '[data-field="sell-buy-now"]').value = '0.25';
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    const create = r.fake.calls.find((c) => c.startsWith('createListing:'));
    expect(create, 'the buy-now listing reached createListing').toBeDefined();
    expect(create).toContain('"startCents":25');
    expect(create).toContain('"buyNowCents":25');
    expect(create).not.toContain('"startCents":24');
  });

  it("an abandoned run resolving late never clears a NEWER run's guard (the generation guard)", async () => {
    // Run A parks on a hung signer, the window closes and reopens, run B
    // starts on its own signer. A resolves first: without the busyGen check in
    // withBusy's finally, A's finally would clear B's busy state and repaint an
    // idle window while B is still at the wallet.
    const r = rig();
    const hungA = deferred<string>();
    r.signMessage.mockImplementation(() => hungA.promise);
    await stageSell(r);
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    r.win.close();
    r.win.open();
    await flush();
    const hungB = deferred<string>();
    r.signMessage.mockImplementation(() => hungB.promise);
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    q<HTMLInputElement>(r.root, 'input[data-field="sell-start"]').value = '25';
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('stepUpChallenge:')).length).toBe(2);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.signing'));
    // A resolves late, under B.
    hungA.resolve('late-a');
    await flush();
    expect(q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').disabled).toBe(true);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.signing'));
    expect(r.fake.calls.filter((c) => c.startsWith('createListing:')).length).toBe(0);
    // B lands: exactly one create, and the success notice.
    hungB.resolve('sig-b');
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('createListing:')).length).toBe(1);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.listingCreated'));
  });

  it('a second submit while the first is in flight is refused (one click, one request)', async () => {
    const r = rig();
    const hung = deferred<string>();
    r.signMessage.mockImplementation(() => hung.promise);
    await stageSell(r);
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    // The button is disabled on the busy face; a programmatic second click
    // (a stale focused button, a double tap that beat the repaint) still
    // routes through onClick, which refuses under busy.
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    hung.resolve('sig');
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('stepUpChallenge:')).length).toBe(1);
    expect(r.fake.calls.filter((c) => c.startsWith('createListing:')).length).toBe(1);
  });

  it('the background poll never fetches under a mutation in flight', async () => {
    const r = rig();
    const hung = deferred<string>();
    r.signMessage.mockImplementation(() => hung.promise);
    await stageSell(r);
    const before = r.fake.calls.filter((c) => c.startsWith('browse:')).length;
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    // Well past the poll interval: a poll would fire here if busy did not gate it.
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 600_000);
    r.win.refreshIfChanged();
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('browse:')).length).toBe(before);
    vi.restoreAllMocks();
    hung.resolve('sig');
    await flush();
  });

  it('a wallet decline lands as a classified notice, and the run settles (buttons live again)', async () => {
    const r = rig();
    r.signMessage.mockImplementation(async () => {
      throw new Error('User rejected the request');
    });
    await stageSell(r);
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('createListing:')).length).toBe(0);
    const notice = q(r.root, '.wm-notice');
    expect(notice.classList.contains('wm-notice-error')).toBe(true);
    // The message signature moves no funds: the sign flavor, never 'payment'.
    expect(notice.textContent).not.toContain('payment');
    expect(q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').disabled).toBe(false);
  });
});

describe('WocMarketWindow live rig: payment balance refresh', () => {
  it.each(['bond', 'settlement'] as const)(
    'refreshes the verified balance after a successful %s confirmation',
    async (kind) => {
      const r = rig();
      r.win.open();
      await flush();
      r.refreshWocBalance.mockClear();

      r.hooks.client.confirmBond = vi.fn(async () => ({ ok: true as const, standing: true }));
      r.hooks.client.confirmSettlement = vi.fn(async () => ({
        ok: true as const,
        state: 'delivered',
      }));
      const quote = {
        signatureRequired: false as const,
        reference: 'refresh-balance',
        transactionBase64: 'dev-transaction',
        amount: null,
        seller: null,
        burn: null,
        treasury: null,
        expiresAtMs: NOW + 60_000,
      };
      Reflect.set(
        r.win,
        'pendingQuote',
        kind === 'bond'
          ? { kind, bidId: 7, itemId: EPIC, usdCents: 250, quote }
          : {
              kind,
              settlementId: 8,
              itemId: EPIC,
              usdCents: 2_500,
              deadlineAtMs: NOW + 60_000,
              quote,
            },
      );

      await (r.win as unknown as { signPendingQuote(): Promise<void> }).signPendingQuote();

      expect(r.refreshWocBalance).toHaveBeenCalledOnce();
      expect(r.refreshWocBalance).toHaveBeenCalledWith(true);
    },
  );
});

describe('WocMarketWindow live rig: desktop signer arguments', () => {
  it('the step-up signer receives the SERVER message AND the challenge nonce', async () => {
    // The desktop arm resolves the server-stored message by the nonce, so a
    // dropped or transposed second argument silently strands every desktop
    // listing; both parameters are strings, so only a runtime assertion
    // catches it (the source pins cannot: the stepUp proof line carries the
    // same substring).
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    const input = q<HTMLInputElement>(r.root, '.wm-combo-input');
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    q(r.root, '.wm-combo-item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    q<HTMLInputElement>(r.root, 'input[data-field="sell-start"]').value = '25';
    q<HTMLButtonElement>(r.root, 'button[data-action="sell-submit"]').click();
    await flush();
    expect(r.signMessage).toHaveBeenCalledWith('sign me', 'n1');
  });

  it('the payment signer receives the transaction bytes AND the quote reference', async () => {
    // Same shape for payments: the desktop arm resolves the registered quote
    // by reference; a null second argument makes every desktop payment throw.
    const r = rig();
    r.win.open();
    await flush();
    r.hooks.client.confirmBond = vi.fn(async () => ({ ok: true as const, standing: true }));
    Reflect.set(r.win, 'pendingQuote', {
      kind: 'bond',
      bidId: 7,
      itemId: EPIC,
      usdCents: 250,
      quote: {
        signatureRequired: true,
        reference: 'WOC_pay_ref_1',
        transactionBase64: 'payable-transaction',
        amount: null,
        seller: null,
        burn: null,
        treasury: null,
        expiresAtMs: NOW + 60_000,
      },
    });
    await (r.win as unknown as { signPendingQuote(): Promise<void> }).signPendingQuote();
    expect(r.signAndSend).toHaveBeenCalledWith('payable-transaction', 'WOC_pay_ref_1');
  });
});

describe('WocMarketWindow live rig: the platform gate', () => {
  it('never opens without hooks (the config-off build)', () => {
    const r = rig();
    const gated = new WocMarketWindow({
      root: () => r.root,
      world: () => r.world as unknown as IWorld,
      hooks: () => null,
      closeOthers: r.closeOthers,
      hideTooltip: () => {},
      attachTooltip: () => {},
      itemTooltip: () => '',
      captureFocus: () => null,
      restoreFocus: () => {},
      openWallet: () => {},
      refreshWocBalance: r.refreshWocBalance,
    });
    gated.open();
    expect(r.root.style.display).toBe('none');
    expect(gated.isOpen).toBe(false);
  });
});

describe('WocMarketWindow live rig: Activity cancel', () => {
  it("the seller's cancel on the Activity tab sends exactly one cancelListing for that row", async () => {
    const r = rig();
    r.fake.answers.me = async () => ({
      ok: true,
      activity: {
        ...EMPTY_ACTIVITY,
        listings: [listing(5, { mine: true, currentBidCents: null })],
      },
    });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="activity"]').click();
    const cancel = q<HTMLButtonElement>(
      r.root,
      'button[data-action="cancel-listing"][data-listing="5"]',
    );
    cancel.click();
    await flush();
    expect(r.fake.calls.filter((c) => c.startsWith('cancelListing:')).length).toBe(1);
    expect(r.fake.calls.some((c) => c === 'cancelListing:[5]')).toBe(true);
    expect(r.root.textContent).toContain(t('hudChrome.wocMarket.listingCancelled'));
  });
});

describe('WocMarketWindow live rig: resolved disclosure figures and the select scroll', () => {
  it('a row tap commands the detail pane into view (the one-column sheet cure)', async () => {
    // happy-dom ships Element.scrollIntoView but lays nothing out, so the pin
    // is the COMMAND and its target, not pixels (the jump-window suites' spy
    // shape).
    const seen: { className: string; arg: unknown }[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      arg?: unknown,
    ) {
      seen.push({ className: (this as HTMLElement).className, arg });
    });
    try {
      const r = rig();
      r.win.open();
      await flush();
      seen.length = 0;
      q<HTMLButtonElement>(r.root, '.wm-row-open').click();
      await flush();
      const detailScrolls = seen.filter((s) => s.className.includes('wm-detail'));
      // EXACTLY one: a re-command on every render inside the tap's flush
      // would fight the player's own scrolling.
      expect(detailScrolls.length).toBe(1);
      // block nearest: a no-op on the desktop's sticky pane, the scroll cure
      // on the stacked phone sheet.
      expect(detailScrolls[0]?.arg).toEqual({ block: 'nearest' });
    } finally {
      spy.mockRestore();
    }
  });

  it('a background poll re-render never re-commands the scroll', async () => {
    const seen: string[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
    ) {
      seen.push((this as HTMLElement).className);
    });
    try {
      const r = rig();
      r.win.open();
      await flush();
      q<HTMLButtonElement>(r.root, '.wm-row-open').click();
      await flush();
      seen.length = 0;
      // The positive control: the poll's answer CHANGES the table, so the
      // absence below is a real re-render declining to scroll, never a
      // short-circuited poll passing vacuously.
      r.fake.answers.browse = async () => ({
        ok: true,
        hasMore: false,
        page: 0,
        listings: [listing(1), listing(2)],
      });
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 120_000);
      // Two ticks: the poll only MUTATES on the first (it never paints); the
      // second tick's signature compare is the render path that shows it.
      r.win.refreshIfChanged();
      await flush();
      r.win.refreshIfChanged();
      await flush();
      expect(r.root.querySelectorAll('.wm-row').length).toBe(2);
      expect(seen.filter((c) => c.includes('wm-detail'))).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      spy.mockRestore();
    }
  });

  it('the bid form resolves the bond schedule and pay window from the status figures', async () => {
    const r = rig();
    r.fake.answers.status = async () =>
      status({ bond: { rateBps: 500, minCents: 100, maxCents: 5000, pendingTtlSeconds: 300 } });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    const disclosures = q(r.root, '.wm-bid-form .wm-disclosures').textContent ?? '';
    // The resolved schedule: rate off the wire (5 percent), both clamps as
    // money, and the payment window as a duration. Figures, not prose.
    expect(disclosures).toContain('5 percent of your bid');
    expect(disclosures).toContain('$1.00');
    expect(disclosures).toContain('$50.00');
    expect(disclosures).toContain('Pay the bond within');
  });

  it('an older server without the figures keeps the figure-free disclosures', async () => {
    const r = rig();
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-row-open').click();
    await flush();
    const disclosures = q(r.root, '.wm-bid-form .wm-disclosures').textContent ?? '';
    expect(disclosures).not.toContain('percent of your bid');
    expect(disclosures).not.toContain('Pay the bond within');
    // The listing-specific note still stands either way.
    expect(disclosures).toContain(
      t('hudChrome.wocMarket.bidBondNote', { bond: '$2.50', bid: '$25.00' }),
    );
  });

  it('the empty sell tab names the realm floor and its collectible categories', async () => {
    const r = rig({ inventory: [] });
    r.fake.answers.status = async () => status({ allowMounts: true, allowMechChromas: false });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    await flush();
    const caption = q(r.root, '.wm-sell .wm-status').textContent ?? '';
    // The live floor, localized, in the sentence; and exactly the switched-on
    // collectible sentence, never the other two.
    expect(caption).toContain(t('hudChrome.wocMarket.sellEmptyFloor', { floor: 'Epic' }));
    expect(caption).toContain(t('hudChrome.wocMarket.sellCollectiblesMounts'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesBoth'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesChromas'));
  });

  it('with both switches on the caption takes the combined sentence, never the singles', async () => {
    const r = rig({ inventory: [] });
    r.fake.answers.status = async () => status({ allowMounts: true, allowMechChromas: true });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    await flush();
    const caption = q(r.root, '.wm-sell .wm-status').textContent ?? '';
    expect(caption).toContain(t('hudChrome.wocMarket.sellCollectiblesBoth'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesMounts'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesChromas'));
  });

  it('with only chroma plates on the caption names exactly them', async () => {
    const r = rig({ inventory: [] });
    r.fake.answers.status = async () => status({ allowMounts: false, allowMechChromas: true });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    await flush();
    const caption = q(r.root, '.wm-sell .wm-status').textContent ?? '';
    expect(caption).toContain(t('hudChrome.wocMarket.sellCollectiblesChromas'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesBoth'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesMounts'));
  });

  it('with both collectible switches off the caption names only the floor', async () => {
    const r = rig({ inventory: [] });
    r.win.open();
    await flush();
    q<HTMLButtonElement>(r.root, '.wm-tab[data-tab="sell"]').click();
    await flush();
    const caption = q(r.root, '.wm-sell .wm-status').textContent ?? '';
    expect(caption).toContain(t('hudChrome.wocMarket.sellEmptyFloor', { floor: 'Epic' }));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesMounts'));
    expect(caption).not.toContain(t('hudChrome.wocMarket.sellCollectiblesChromas'));
  });
});
