// The Exchange payment-quote face builder (moved out of woc_market_window.ts
// on the monolith ratchet): the title resolution per quote shape, the clock
// from the caller's clock, and the settlement deadline passthrough. DOM-free.

import { describe, expect, it } from 'vitest';
import { t } from '../src/ui/i18n';
import {
  type PendingQuote,
  type WocQuoteFaceView,
  type WocQuoteHtmlHost,
  wocQuoteHtml,
} from '../src/ui/woc_market_quote_html';

const host: WocQuoteHtmlHost = {
  busy: false,
  usd: (c) => `$${(c / 100).toFixed(2)}`,
  tokens: (v) => `${v} WOC`,
  itemName: (id) => `Item(${id})`,
};

function quote(over: Partial<WocQuoteFaceView> = {}): WocQuoteFaceView {
  return {
    amount: { base: 'a', tokens: 100 },
    seller: { base: 's', tokens: 90 },
    burn: { base: 'b', tokens: 5 },
    treasury: { base: 't', tokens: 5 },
    expiresAtMs: 60_000,
    ...over,
  };
}

describe('wocQuoteHtml', () => {
  it('names which auction a bond is for when the item is known, and the amount alone otherwise', () => {
    const forItem: PendingQuote = {
      kind: 'bond',
      bidId: 1,
      itemId: 'i1',
      usdCents: 1250,
      quote: quote(),
    };
    expect(wocQuoteHtml(forItem, host, 0)).toContain(
      t('hudChrome.wocMarket.quoteBondForItem', { item: 'Item(i1)', usd: '$12.50' }),
    );
    const bare: PendingQuote = { ...forItem, itemId: '' };
    expect(wocQuoteHtml(bare, host, 0)).toContain(
      t('hudChrome.wocMarket.quoteBondFor', { usd: '$12.50' }),
    );
  });

  it('falls back to the plain title with no cached USD label (never a fabricated $0.00)', () => {
    const p: PendingQuote = {
      kind: 'bond',
      bidId: 1,
      itemId: 'i1',
      usdCents: null,
      quote: quote(),
    };
    const html = wocQuoteHtml(p, host, 0);
    expect(html).toContain(t('hudChrome.wocMarket.quoteTitle'));
    expect(html).not.toContain('$0.00');
    // The token legs still carry the figures.
    expect(html).toContain('100 WOC');
  });

  it('spells a settlement with its item and passes the claim deadline through', () => {
    const p: PendingQuote = {
      kind: 'settlement',
      settlementId: 7,
      itemId: 'i2',
      usdCents: 500,
      deadlineAtMs: 999_000,
      quote: quote(),
    };
    const html = wocQuoteHtml(p, host, 0);
    expect(html).toContain(
      t('hudChrome.wocMarket.quoteSettlementFor', { item: 'Item(i2)', usd: '$5.00' }),
    );
    // Same inputs, same markup: the clock comes from the caller, never Date.now().
    expect(wocQuoteHtml(p, host, 0)).toBe(html);
    expect(wocQuoteHtml(p, host, 30_000)).not.toBe(html);
  });

  it('reads an expired or clockless quote as zero time left', () => {
    const p: PendingQuote = { kind: 'bond', bidId: 1, itemId: '', usdCents: null, quote: quote() };
    const expired = wocQuoteHtml(p, host, 120_000);
    const clockless = wocQuoteHtml({ ...p, quote: quote({ expiresAtMs: null }) }, host, 0);
    expect(expired).toBe(clockless);
    expect(expired).not.toBe(wocQuoteHtml(p, host, 0));
  });
});
