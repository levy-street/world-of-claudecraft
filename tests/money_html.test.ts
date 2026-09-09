import { describe, expect, it } from 'vitest';
import { moneyHtml } from '../src/ui/money_html';

// The coin-icon money readout, extracted from the Hud coordinator so every window
// shares one markup. The default output is the coordinator's former byte-for-byte
// (all three coins, locale-grouped digits); the options are what the social tab's
// roster confirm needs (formatMoney's compact coin set, bare digits).
const amount = (value: string, cls: 'g' | 's' | 'c', unit: string): string =>
  `<span class="coin-part"><span class="coin-amount">${value}</span><span class="coin ${cls}" aria-hidden="true"></span><span class="visually-hidden">${unit}</span></span>`;

describe('moneyHtml: the coin-icon money readout', () => {
  it('renders gold, silver and copper with grouped digits, a coin glyph and a spoken unit', () => {
    // Arrange: 1736g 45s 6c
    const copper = 1736 * 10_000 + 45 * 100 + 6;

    // Act
    const html = moneyHtml(copper);

    // Assert: the exact former Hud.moneyHtml markup
    expect(html).toBe(
      '<span class="money-inline" aria-label="1,736 gold 45 silver 6 copper">' +
        amount('1,736', 'g', 'gold') +
        amount('45', 's', 'silver') +
        amount('6', 'c', 'copper') +
        '</span>',
    );
  });

  it('keeps every zero coin by default: the bag readout always shows three coins', () => {
    const html = moneyHtml(1736 * 10_000);
    expect(html).toContain(amount('0', 's', 'silver'));
    expect(html).toContain(amount('0', 'c', 'copper'));
  });

  it('shows a lone zero copper coin for an empty purse', () => {
    const html = moneyHtml(0);
    expect(html).toContain(amount('0', 'c', 'copper'));
    expect(html).not.toContain('coin g');
    expect(html).not.toContain('coin s');
  });

  it('compact drops a zero copper coin once gold or silver shows, never the only coin', () => {
    // 1736g 0s 0c reads as two coins, like formatMoney's "1,736g 0s"
    const gold = moneyHtml(1736 * 10_000, { compact: true });
    expect(gold).toContain(amount('1,736', 'g', 'gold'));
    expect(gold).toContain(amount('0', 's', 'silver'));
    expect(gold).not.toContain('coin c');
    // a real copper part still shows
    expect(moneyHtml(1736 * 10_000 + 6, { compact: true })).toContain(amount('6', 'c', 'copper'));
    // an empty purse keeps its lone copper coin
    expect(moneyHtml(0, { compact: true })).toContain(amount('0', 'c', 'copper'));
  });

  it('grouping: false renders bare digits (the confirm-prompt reading)', () => {
    const html = moneyHtml(1736 * 10_000, { compact: true, grouping: false });
    expect(html).toContain(amount('1736', 'g', 'gold'));
    expect(html).not.toContain('1,736</span>');
    expect(moneyHtml(295_638 * 10_000, { grouping: false })).toContain(
      amount('295638', 'g', 'gold'),
    );
  });

  it('clamps non-finite or negative input to an empty purse', () => {
    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      const html = moneyHtml(bad);
      expect(html).toContain(amount('0', 'c', 'copper'));
      expect(html).not.toContain('coin g');
    }
  });
});
