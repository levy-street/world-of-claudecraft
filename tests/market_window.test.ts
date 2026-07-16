import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The market window painter is a DOM module; driving the live DOM + events is the
// opt-in browser suite. This is the no-DOM-suite equivalent: it
// asserts the painter source carries the a11y attributes, the
// token/named-constant discipline, and that filtering is delegated to
// the pure core (no duplicated market_filters logic).
const painter = readFileSync(new URL('../src/ui/market_window.ts', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/ui/market_view.ts', import.meta.url), 'utf8');

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
