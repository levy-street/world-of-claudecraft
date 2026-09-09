// The coin-icon money readout: an amount beside a gold / silver / copper coin
// glyph per denomination, with the long spoken form on the wrapper's aria-label.
// Extracted from the Hud coordinator so every window (bags, bank, vault, mailbox,
// guild bank, dungeon finder, the social tab's roster confirm) composes the same
// markup; the default output is byte-identical to the coordinator method it
// replaced. Host-agnostic: strings only, no DOM.
import { esc } from './esc';
import { formatMoney, formatNumber, moneyParts, type TranslationKey, t } from './i18n';

export interface MoneyHtmlOptions {
  /** Drop a zero copper part once gold or silver is shown (formatMoney's compact
   *  rule, so "1736g 0s" reads as two coins). Default false: the bag readout always
   *  shows all three coins. */
  compact?: boolean;
  /** Locale digit grouping on each amount ("1,736"). Default true; false renders the
   *  bare digits ("1736"), the confirm-prompt reading. */
  grouping?: boolean;
}

type CoinClass = 'g' | 's' | 'c';

const COIN_UNIT_KEYS: Record<CoinClass, TranslationKey> = {
  g: 'itemUi.money.gold',
  s: 'itemUi.money.silver',
  c: 'itemUi.money.copper',
};

// Grouping stays the locale's own "auto" rule unless the caller turns it off, so the
// default output never drifts from what the windows rendered before the extraction
// (an explicit useGrouping: true is "always", which differs from "auto" in locales
// with a minimum grouping width).
function coinAmountOptions(grouping: boolean): Intl.NumberFormatOptions {
  return grouping ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 0, useGrouping: false };
}

export function moneyHtml(copper: number, options: MoneyHtmlOptions = {}): string {
  const parts = moneyParts(copper);
  const numberOptions = coinAmountOptions(options.grouping ?? true);
  const coin = (value: number, cls: CoinClass): string =>
    `<span class="coin-part"><span class="coin-amount">${esc(formatNumber(value, numberOptions))}</span><span class="coin ${cls}" aria-hidden="true"></span><span class="visually-hidden">${esc(t(COIN_UNIT_KEYS[cls]))}</span></span>`;
  let html = '';
  if (parts.gold > 0) html += coin(parts.gold, 'g');
  if (parts.silver > 0 || parts.gold > 0) html += coin(parts.silver, 's');
  if (!options.compact || parts.copper > 0 || html === '') html += coin(parts.copper, 'c');
  return `<span class="money-inline" aria-label="${esc(formatMoney(copper, 'long'))}">${html}</span>`;
}
