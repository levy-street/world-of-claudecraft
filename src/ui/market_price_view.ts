// Pure builder for the World Market row price: a single-unit, coinless price
// block built for fast price COMPARISON down a column. DOM-free and i18n-free
// (the `marketArmorPips` pattern): the painter passes in the already-localized
// unit letter and the caller owns every string. Returns an HTML string the
// painter drops into the row.
//
// Why the market paints its own price instead of the shared moneyHtml:
//  - single-unit     ONE number in the largest denomination present, to one
//                    decimal: "1.5g", "10.5s", "80c". A shopper compares one
//                    magnitude per row instead of parsing "1 51 20", and the
//                    price lane stays narrow so the item NAME keeps its width.
//  - truncate-down   the decimal is TRUNCATED, never rounded up, so the shown
//                    price is never larger than the real one (48,500g 99s 99c
//                    reads "48,500g", 1g 51s 20c reads "1.5g"). The exact,
//                    fully localized amount rides the block's aria-label / title
//                    (and the row tooltip), so nothing is hidden from a buyer or
//                    from assistive tech: the compact number is a scan aid, the
//                    precise figure is one hover/read away.
//  - coinless        the denomination is carried by the number's COLOR class
//                    (gold/silver/copper) plus a small unit letter, not an 11px
//                    coin circle.
// This is market-scoped ON PURPOSE: it does not touch moneyHtml, so bags, bank,
// vendor, loot and trade keep the shipped coin display.
//
// Localization: the value is formatted through `formatNumber` (Intl) so the
// decimal mark and digit grouping follow the locale (de_DE "48.500,5", not the
// malformed "48.500.5"), and the unit LETTER is not this module's business: the
// painter resolves `itemUi.money.{gold,silver,copper}Short` and passes it in.
import { formatNumber } from './i18n';

const COPPER_PER_GOLD = 10000;
const COPPER_PER_SILVER = 100;

export type MarketPriceTone = 'gold' | 'silver' | 'copper';

export interface MarketPriceDisplay {
  /** The single-unit number, already localized and TRUNCATED to one decimal
   *  ("48,500", "1.5", "10.5", "80") in the current locale's number format. */
  text: string;
  /** Color tone / denomination the number is shown in; also selects which unit
   *  letter the painter passes in. */
  tone: MarketPriceTone;
}

// Format an already-truncated tenths count (value * 10) as a localized decimal,
// dropping a trailing ".0". Intl rounds, so the caller truncates to tenths FIRST
// and hands the exact tenths here; this only chooses the display digits.
function fromTenths(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const f = tenths % 10;
  if (f === 0) return formatNumber(whole, { maximumFractionDigits: 0 });
  // One value, one Intl pass: grouping on the whole part and the locale decimal
  // mark both come from the formatter, so no separator is ever concatenated by
  // hand (the de_DE "48.500.5" bug).
  return formatNumber(whole + f / 10, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Reduce a copper total to the single-unit display value: the largest
 * denomination present, truncated to one decimal so the shown price is NEVER
 * greater than the real price.
 *   >= 1 gold   -> gold, one decimal ("1.5", "48,500")
 *   >= 1 silver -> silver, one decimal ("10.5")
 *   else        -> copper, whole ("80", "0"): copper is the smallest unit, so
 *                  there is nothing to put after a decimal point.
 */
export function marketPriceDisplay(copper: number): MarketPriceDisplay {
  const total = Math.max(0, Math.floor(copper));
  if (total >= COPPER_PER_GOLD) {
    // tenths of a gold, TRUNCATED (floor), so we never round a price upward.
    return { text: fromTenths(Math.floor((total * 10) / COPPER_PER_GOLD)), tone: 'gold' };
  }
  if (total >= COPPER_PER_SILVER) {
    return { text: fromTenths(Math.floor((total * 10) / COPPER_PER_SILVER)), tone: 'silver' };
  }
  return { text: formatNumber(total, { maximumFractionDigits: 0 }), tone: 'copper' };
}

/** The localized short unit letters the painter resolves once and passes in, one
 *  per tone: `{ gold: t('itemUi.money.goldShort'), ... }`. Kept out of this pure
 *  module so it stays i18n-free like marketArmorPips. */
export interface MarketPriceUnits {
  gold: string;
  silver: string;
  copper: string;
}

/**
 * Build the market row's price HTML: one single-unit, truncated-down number.
 * @param copper total price in copper
 * @param units the caller's already-localized short unit letters (goldShort etc.)
 * @param exact the caller's already-localized FULL, exact money string (e.g.
 *   formatMoney(copper, 'long')), already escaped by the caller. Becomes BOTH the
 *   block's accessible name (aria-label) AND its hover tooltip (title), so the
 *   compact truncated number never hides the real value from a buyer (hover) or a
 *   screen reader.
 */
export function marketPriceHtml(copper: number, units: MarketPriceUnits, exact: string): string {
  const { text, tone } = marketPriceDisplay(copper);
  const unit = units[tone];
  // role="img" + one accessible name: the digits and unit letter are decorative
  // (aria-hidden) so a screen reader announces the exact `exact` string ONCE
  // instead of re-reading "4 8 5 0 0 g" after it. title gives sighted mouse
  // users the same exact figure on hover.
  return (
    `<span class="mkt-price-stack" role="img" aria-label="${exact}" title="${exact}">` +
    `<span class="mkt-price-main mkt-price-main--${tone}" aria-hidden="true">` +
    `<b class="mkt-price-num">${text}</b><i class="mkt-price-unit">${unit}</i>` +
    `</span></span>`
  );
}
