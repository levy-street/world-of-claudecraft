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
    expect(painter).toContain('gg * COPPER_PER_GOLD + ss * COPPER_PER_SILVER + cc');
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
    // buy/reclaim buttons get a programmatic name even though their face text is plain
    expect(painter).toContain("t(l.mine ? 'itemUi.market.reclaimAria' : 'itemUi.market.buyAria'");
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

  it('delegates filtering to market_view/market_filters, never re-deriving it', () => {
    expect(painter).toContain('buildMarketView');
    expect(painter, 'filtering must stay in the core').not.toContain('filterMarketListings');
    expect(painter, 'pagination must stay in the core').not.toContain('paginateMarketListings');
    // the core is the one that reuses the shared filter helper
    expect(core).toContain('filterMarketListings');
    expect(core).toContain('paginateMarketListings');
  });

  it('preserves the buy / list / cancel / collect dispatch and money formatting', () => {
    expect(painter).toContain('.marketBuy(l.id)');
    expect(painter).toContain('.marketCancel(l.id)');
    expect(painter).toContain('.marketList(view.form.itemId, qty, each * qty)');
    expect(painter).toContain('.marketCollect()');
    expect(painter).toContain('this.deps.moneyHtml(');
    expect(painter).toContain('formatLocalizedMoney(');
  });
});
