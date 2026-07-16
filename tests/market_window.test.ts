import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type MarketRefreshState, marketRefreshSignature } from '../src/ui/market_view';
import type { MarketInfo, MarketListingView } from '../src/world_api';

// The market window painter is a DOM module; driving the live DOM + events is the
// opt-in browser suite. This is the no-DOM-suite equivalent: it
// asserts the painter source carries the a11y attributes, the
// token/named-constant discipline, and that filtering is delegated to
// the pure core (no duplicated market_filters logic).
const painter = readFileSync(new URL('../src/ui/market_window.ts', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/ui/market_view.ts', import.meta.url), 'utf8');
// The $WOC payment panel is SHARED with the trade window (r7#2): the wallet
// link + copy controls live in payment_panel.ts, called by both painters.
const paymentPanel = readFileSync(new URL('../src/ui/payment_panel.ts', import.meta.url), 'utf8');

describe('market_window: no magic values', () => {
  it('carries no literal color in TS (colors live in the extracted stylesheet/tokens)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
    expect(painter, 'rgb()/hsl() color literal must move to tokens/CSS').not.toMatch(
      /\b(?:rgba?|hsla?)\(/,
    );
  });

  it('routes the unranked quality fallback through a CSS token, not a hex literal', () => {
    expect(painter).toContain("const QUALITY_DEFAULT_COLOR = 'var(--color-quality-default)'");
  });

  it('names the coin-conversion constants instead of bare 10000 / 100', () => {
    expect(painter).toContain("inputVal('mkt-g') * COPPER_PER_GOLD");
    expect(painter).toContain("inputVal('mkt-s') * COPPER_PER_SILVER");
    expect(painter).toContain("inputVal('mkt-c')");
    expect(painter.match(/\b10000\b/g) ?? [], 'no bare 10000 copper-per-gold literal').toEqual([]);
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

// The one bug this PR must fix: a per-second countdown tick rebuilt the whole Browse
// list, wiping a mid-typed bid or buy-quantity. The dirty-check signature must ignore
// each listing's live secondsLeft (which flips every second) while still reacting to a
// real change. The signature is the pure marketRefreshSignature the painter calls.
describe('market_window: browse refresh signature (typing-guard regression)', () => {
  function browseListing(over: Partial<MarketListingView> = {}): MarketListingView {
    return {
      id: 1,
      sellerName: 'Seller',
      itemId: 'wolf_fang',
      count: 3,
      price: 100,
      mine: false,
      house: false,
      secondsLeft: 3600,
      kind: 'fixed',
      myBid: false,
      denom: 'copper',
      ...over,
    };
  }

  function snapshot(listings: MarketListingView[]): MarketInfo {
    return {
      listings,
      totalCount: listings.length,
      filter: '',
      page: 0,
      pageCount: 1,
      collectionCopper: 0,
      collectionItems: [],
      cutPct: 5,
      maxListings: 10,
      myListingCount: 0,
      durationsHours: [12, 24, 48],
      rails: { claudium: false, woc: false },
    };
  }

  const BROWSE_STATE: MarketRefreshState = {
    tab: 'browse',
    itemType: 'all',
    subtype: 'all',
    rarity: 'all',
    sort: 'newest',
    page: 0,
  };

  it('is stable across two snapshots that differ ONLY in secondsLeft', () => {
    const a = marketRefreshSignature(
      BROWSE_STATE,
      snapshot([browseListing({ secondsLeft: 3600 })]),
    );
    const b = marketRefreshSignature(BROWSE_STATE, snapshot([browseListing({ secondsLeft: 1 })]));
    expect(a).toBe(b);
  });

  it('still flips when a listing price / count / bid changes (real rebuild preserved)', () => {
    const base = marketRefreshSignature(BROWSE_STATE, snapshot([browseListing()]));
    expect(
      marketRefreshSignature(BROWSE_STATE, snapshot([browseListing({ price: 250 })])),
    ).not.toBe(base);
    expect(marketRefreshSignature(BROWSE_STATE, snapshot([browseListing({ count: 4 })]))).not.toBe(
      base,
    );
    expect(
      marketRefreshSignature(
        BROWSE_STATE,
        snapshot([browseListing({ kind: 'auction', currentBid: 120 })]),
      ),
    ).not.toBe(base);
  });

  it('still flips when a listing is added or removed', () => {
    const one = marketRefreshSignature(BROWSE_STATE, snapshot([browseListing({ id: 1 })]));
    const two = marketRefreshSignature(
      BROWSE_STATE,
      snapshot([browseListing({ id: 1 }), browseListing({ id: 2 })]),
    );
    expect(one).not.toBe(two);
  });
});

describe('market_window: WCAG 2.2 AA', () => {
  it('returns focus to the opener on close', () => {
    expect(painter).toContain('captureFocus');
    expect(painter).toContain('restoreFocus');
    const close = painter.slice(painter.indexOf('close(): void {'));
    expect(close).toContain('this.deps.restoreFocus(this.openerFocus)');
  });

  it('labels its controls and exposes listbox roles on the filter menus', () => {
    expect(painter).toContain('itemUi.market.close'); // close button aria-label key
    expect(painter).toContain('aria-pressed='); // the tab buttons
    expect(painter).toContain('role="listbox"');
    expect(painter).toContain('role="option"');
    expect(painter).toContain('aria-haspopup="listbox"');
    expect(painter).toContain('aria-selected=');
    expect(painter).toContain("search.setAttribute('aria-label', t('itemUi.market.searchAria'))");
    // buy/reclaim/bid/buyout controls all get a programmatic name even though
    // their face text is plain
    expect(painter).toContain("t('itemUi.market.reclaimAria', { item: itemName })");
    expect(painter).toContain('itemUi.market.buyAria');
    expect(painter).toContain('itemUi.market.bidAria');
    expect(painter).toContain('itemUi.market.buyoutAria');
    expect(painter).toContain('itemUi.market.buyQuantityAria');
    // the listing-type and duration toggles are labeled groups, not bare buttons
    expect(painter).toContain("kindToggle.setAttribute('role', 'group')");
    expect(painter).toContain("durationToggle.setAttribute('role', 'group')");
  });

  it('makes the filter listboxes keyboard-operable via the shared dropdownKeyNav core', () => {
    // The role=listbox the menus advertise is now actually keyboard-operable. The
    // options are programmatically focusable but out of the Tab order (the roving pattern),
    // and the wiring reuses the existing pure core rather than a bespoke re-implementation,
    // so this guard fails if the keyboard nav is dropped.
    expect(painter).toContain('role="option" tabindex="-1"');
    expect(painter).toContain("import { dropdownKeyNav } from './dropdown_nav'");
    expect(painter).toContain('dropdownKeyNav(');
  });
});

describe('market_window: behavior preserved through the core', () => {
  it('renders every state of the view union (no-data + the three tabs)', () => {
    expect(painter).toContain("view.kind === 'no-data'");
    expect(painter).toContain('itemUi.market.noMerchant'); // the loading / no-merchant copy
    expect(painter).toContain("view.kind === 'browse'");
    expect(painter).toContain("view.kind === 'sell'");
    // the three browse empty reasons
    expect(painter).toContain('itemUi.market.emptySearch');
    expect(painter).toContain('itemUi.market.emptyFiltered');
    expect(painter).toContain('itemUi.market.emptyBrowse');
  });

  it('delegates browse rendering to the pure view core, with filtering done server-side', () => {
    expect(painter).toContain('buildMarketView');
    // Neither the painter nor the client view re-derives filtering/pagination: the
    // server filters + paginates the WHOLE market (so a player can page through it all),
    // and the view just renders the page the snapshot carries.
    expect(painter, 'filtering is server-side now').not.toContain('filterMarketListings');
    expect(painter, 'pagination is server-side now').not.toContain('paginateMarketListings');
    expect(core, 'the view renders the server page directly').not.toContain('filterMarketListings');
    const market = readFileSync(new URL('../src/sim/market.ts', import.meta.url), 'utf8');
    expect(market, 'the server is the single source of browse filtering').toContain(
      'marketItemMatches',
    );
  });

  it('preserves the buy / list / cancel / collect dispatch and money formatting', () => {
    expect(painter).toContain('.marketBuy(l.id)');
    expect(painter).toContain('.marketCancel(l.id)');
    expect(painter).toContain('.marketList(view.form.itemId, qty, each, opts)');
    expect(painter).toContain('.marketCollect()');
    expect(painter).toContain('this.deps.moneyHtml(');
    expect(painter).toContain('formatLocalizedMoney(');
  });

  it('wires the new auction-house dispatch: quantity buys, bids, buyouts, and sort', () => {
    // per-unit fixed rows buy a chosen quantity, not always the whole stack
    expect(painter).toContain('.marketBuy(l.id, clampedQty())');
    // auction rows bid and (optionally) buy out instantly
    expect(painter).toContain('.marketBid(l.id, amount)');
    // the sort dropdown is a real filter-menu key, driving MarketQuery.sort
    expect(painter).toContain("key === 'sort'");
    expect(painter).toContain('this.sortOrder = value as MarketSortOrder');
    expect(painter).toContain('sort: this.sortOrder');
  });

  it('shows a deposit-aware confirmation before reclaiming a listing', () => {
    // Reclaim no longer dispatches unconditionally: the shared confirmDialog gates
    // it, and the body copy branches on whether a deposit would be forfeited.
    expect(painter).toContain('this.deps.confirmDialog(');
    expect(painter).toContain('itemUi.market.cancelConfirmBody');
    expect(painter).toContain('itemUi.market.cancelConfirmBodyNoDeposit');
    expect(painter).toContain('l.depositTotal ?? 0');
  });

  it('previews the listing deposit via the pure sim helper, never inventing its own formula', () => {
    expect(painter).toContain('marketDepositPerUnit');
    expect(painter).toContain("from '../sim/market'");
    expect(painter).toContain('marketDepositPerUnit(item, this.sellDurationHours)');
  });
});

describe('market_window: multi-currency denominations (AH-P4)', () => {
  it('renders the denomination selector ONLY for rails the viewer has (meta.rails gating)', () => {
    // the selector options are built from meta.rails, never unconditionally
    expect(painter).toContain('meta.rails.claudium');
    expect(painter).toContain('meta.rails.woc');
    expect(painter).toContain('data-sell-denom');
    // with both rails off exactly one option exists, so no selector renders
    expect(painter).toContain('denomOptions.length > 1');
    // a rail turning off mid-session can never leave a phantom selection
    expect(painter).toContain(
      "if (!denomOptions.some((o) => o.denom === this.sellDenom)) this.sellDenom = 'copper';",
    );
  });

  it('disables the auction toggle for an external denomination with the gold-only tooltip', () => {
    expect(painter).toContain("kind === 'auction' && this.sellDenom !== 'copper'");
    expect(painter).toContain('itemUi.market.auctionGoldOnly');
    // switching to an external denom force-exits an in-progress auction choice
    expect(painter).toContain(
      "if (next !== 'copper' && this.sellKind === 'auction') this.sellKind = 'fixed';",
    );
  });

  it('dispatches denom + priceWoc on list, with the WOC ask as an opaque string', () => {
    expect(painter).toContain("opts.denom = 'woc'");
    expect(painter).toContain('opts.priceWoc = raw');
    expect(painter).toContain("opts.denom = 'claudium'");
    expect(painter).toContain('.marketList(view.form.itemId, qty, unit, opts)');
    // the WOC input is a TEXT decimal field whose raw string rides the wire
    // untouched (no Number()/parse of the ask anywhere on the woc path)
    expect(painter).toContain('id="mkt-woc" type="text" inputmode="decimal"');
    expect(painter).toContain('?.value.trim()');
    expect(painter, 'the woc ask is never coerced to a number').not.toContain('Number(raw)');
  });

  it('renders denomination badges in the price cell (coin icons per currency)', () => {
    expect(painter).toContain("l.denom === 'claudium'");
    expect(painter).toContain("l.denom === 'woc'");
    expect(painter).toContain('claudium-coin');
    expect(painter).toContain('woc-coin');
    expect(painter).toContain('itemUi.market.claudiumEach');
  });

  it('locks a pending row for everyone and confirms external buys before dispatch', () => {
    expect(painter).toContain('l.pendingPayment');
    expect(painter).toContain('itemUi.market.awaitingPayment');
    // both external flows route through the shared confirm dialog
    expect(painter).toContain('itemUi.market.buyClaudiumConfirmBody');
    expect(painter).toContain('itemUi.market.buyWocConfirmBody');
  });

  it('renders the pending panel through the SHARED payment panel (trade classes, wallet + copy actions)', () => {
    expect(painter).toContain('buildPendingPanel');
    expect(painter).toContain('trade-woc-pay');
    expect(painter).toContain('itemUi.market.wocPayPrompt');
    // the wallet link + copy controls come from the one shared builder both
    // the market and trade windows call (payment_panel.ts, r7#2)
    expect(painter).toContain('buildWocPayPanel');
    expect(paymentPanel).toContain('trade-woc-pay-link');
    expect(paymentPanel).toContain('trade-woc-pay-copy');
    expect(paymentPanel).toContain('hud.trade.openInWallet');
    expect(paymentPanel).toContain('hud.trade.copyLink');
    expect(paymentPanel).toContain('deps.copyToClipboard(uri)');
    // the sig-driven refresh reacts to the pending purchase appearing/clearing: the
    // painter diffs the pure marketRefreshSignature, which folds info?.myPendingPurchase
    // into the signature (the builder moved to the DOM-free core, market_view.ts).
    expect(painter).toContain('marketRefreshSignature(');
    expect(core).toContain('info?.myPendingPurchase');
  });
});
