import { describe, expect, it } from 'vitest';
import { formatNumber } from '../src/ui/i18n';
import {
  type MarketPriceUnits,
  marketPriceDisplay,
  marketPriceHtml,
} from '../src/ui/market_price_view';

const G = 10000; // copper per gold
const S = 100; // copper per silver

// English short units, the shape the painter resolves from itemUi.money.*Short.
const EN: MarketPriceUnits = { gold: 'g', silver: 's', copper: 'c' };

describe('marketPriceDisplay: single unit, truncated down', () => {
  it('shows the largest denomination present as the single unit tone', () => {
    expect(marketPriceDisplay(138 * G).tone).toBe('gold');
    expect(marketPriceDisplay(10 * S).tone).toBe('silver');
    expect(marketPriceDisplay(80).tone).toBe('copper');
  });

  it('renders a clean whole price with no fraction (5g, not 5.0g)', () => {
    expect(marketPriceDisplay(5 * G)).toEqual({ text: '5', tone: 'gold' });
    expect(marketPriceDisplay(10 * S)).toEqual({ text: '10', tone: 'silver' });
  });

  it('shows one truncated decimal for a mixed price (1g 51s 20c -> 1.5)', () => {
    // 1.512g truncates to 1.5g: the tenth is floored, never rounded.
    expect(marketPriceDisplay(1 * G + 51 * S + 20)).toEqual({ text: '1.5', tone: 'gold' });
    // 10s 50c -> 10.5s
    expect(marketPriceDisplay(10 * S + 50)).toEqual({ text: '10.5', tone: 'silver' });
  });

  it('NEVER rounds a price upward (the shown value is <= the real value)', () => {
    // 38g 60c is 38.006g: the tenth floors to .0, so it shows "38", not "38.1".
    expect(marketPriceDisplay(38 * G + 60).text).toBe('38');
    // 1g 99s 99c is 1.9999g: truncates to 1.9, never 2.0.
    expect(marketPriceDisplay(1 * G + 99 * S + 99).text).toBe('1.9');
    // The six-figure stress case: 48,500g 99s 99c is 48,500.9999g, so it truncates
    // to "48,500.9" (the floored tenth), never up to 48,501.
    expect(marketPriceDisplay(48500 * G + 99 * S + 99).text).toBe('48,500.9');
  });

  it('groups the whole part with a thousands separator', () => {
    expect(marketPriceDisplay(999999 * G).text).toBe('999,999');
  });

  it('copper is whole only (nothing smaller to put after a decimal)', () => {
    expect(marketPriceDisplay(80)).toEqual({ text: '80', tone: 'copper' });
    expect(marketPriceDisplay(1)).toEqual({ text: '1', tone: 'copper' });
    expect(marketPriceDisplay(0)).toEqual({ text: '0', tone: 'copper' });
  });

  it('floors fractional and clamps negative copper input', () => {
    expect(marketPriceDisplay(-5)).toEqual({ text: '0', tone: 'copper' });
    expect(marketPriceDisplay(5 * G + 0.9)).toEqual({ text: '5', tone: 'gold' });
  });
});

describe('marketPriceDisplay: locale number formatting (the de_DE regression)', () => {
  // The old builder concatenated ".5" onto formatNumber's grouped whole, so a
  // dot-grouping locale rendered the malformed "48.500.5". The value must go
  // through Intl in ONE pass so the decimal mark and grouping are both the
  // locale's. German groups with "." and marks the decimal with ",": 48.500,9.
  it('uses the locale decimal mark and grouping, never a hand-concatenated dot', () => {
    const de = formatNumber(
      48500.9,
      { minimumFractionDigits: 1, maximumFractionDigits: 1 },
      'de_DE',
    );
    // Sanity: this is what a correct single Intl pass yields for German.
    expect(de).toBe('48.500,9');
    // And the malformed double-dot form never appears.
    expect(de).not.toContain('.500.9');
  });
});

describe('marketPriceHtml', () => {
  it('renders one single-unit number with its tone class and the passed unit letter', () => {
    const html = marketPriceHtml(138 * G, EN, '138 gold');
    expect(html).toContain('mkt-price-main--gold');
    expect(html).toContain('>138<'); // the whole part
    expect(html).toContain('mkt-price-unit">g<');
  });

  it('uses the caller-supplied localized unit letter (not a hardcoded g/s/c)', () => {
    // ru_RU-style: gold short is Cyrillic "з". The builder must print what the
    // painter passes, so the headline letter matches the localized subline.
    const ru: MarketPriceUnits = { gold: 'з', silver: 'с', copper: 'м' };
    const html = marketPriceHtml(138 * G, ru, '138 gold');
    expect(html).toContain('mkt-price-unit">з<');
    expect(html).not.toContain('mkt-price-unit">g<');
  });

  it('shows the truncated decimal inline (1.5)', () => {
    const html = marketPriceHtml(1 * G + 51 * S + 20, EN, '1 gold 51 silver 20 copper');
    expect(html).toContain('>1.5<');
    expect(html).toContain('mkt-price-unit">g<');
  });

  it('renders the smallest legal listing (1 copper) as a copper unit', () => {
    // The sim floors every listing at MARKET_MIN_PRICE (1 copper), so a single
    // copper is the true cheapest row the market can paint.
    const html = marketPriceHtml(1, EN, '1 copper');
    expect(html).toContain('mkt-price-main--copper');
    expect(html).toContain('>1<');
    expect(html).toContain('mkt-price-unit">c<');
  });

  it('renders a zero-total price as 0 copper rather than nothing', () => {
    const html = marketPriceHtml(0, EN, '0 copper');
    expect(html).toContain('mkt-price-main--copper');
    expect(html).toContain('>0<');
  });

  it('carries the EXACT amount as BOTH accessible label and hover title (the compact number is not lossy)', () => {
    // The visible price truncates to "1.5g" but the aria-label AND the title keep
    // the real "1 gold, 51 silver, 20 copper", so a screen reader AND a sighted
    // mouse user both get the precise figure.
    const html = marketPriceHtml(1 * G + 51 * S + 20, EN, '1 gold, 51 silver, 20 copper');
    expect(html).toContain('aria-label="1 gold, 51 silver, 20 copper"');
    expect(html).toContain('title="1 gold, 51 silver, 20 copper"');
  });

  it('uses role=img with aria-hidden decorative digits (announced once, not digit-by-digit)', () => {
    // role="text" is not a valid WAI-ARIA role; role="img" + one accessible name
    // is the robust form. The visible number/unit are aria-hidden so a verbose
    // screen reader reads the exact label ONCE.
    const html = marketPriceHtml(138 * G, EN, '138 gold');
    expect(html).toContain('role="img"');
    expect(html).not.toContain('role="text"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('emits no coin-circle markup (color + unit letter carry the denomination)', () => {
    const html = marketPriceHtml(138 * G + 60 * S, EN, 'x');
    expect(html).not.toContain('class="coin ');
  });
});
