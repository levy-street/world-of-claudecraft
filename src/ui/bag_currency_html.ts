// The CLAUDIUM launcher chip in the bag header.
//
// Lifted out of hud.ts because it does not need the coordinator: a pure function from an
// already-resolved balance to one markup string. The HUD keeps the thin method that gathers
// that value, which is the part that genuinely does need `this`.
//
// It escapes every interpolated value. That is not defensive habit: a locale-formatted
// number reaches this string, and the markup is assigned through innerHTML.
//
// The wallet's own $WOC chip used to live here too. It now comes from the shared
// woc_balance_chip.ts primitive, so only the launcher is left.

import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** The CLAUDIUM launcher chip. A null balance shows the placeholder, never a bare 0. */
export function claudiumLauncherHtml(balance: number | null): string {
  const label = balance === null ? '--' : formatNumber(balance, { maximumFractionDigits: 0 });
  const aria = t('hudChrome.claudium.open');
  return `<button type="button" class="claudium-launcher" data-claudium-launcher title="${esc(aria)}" aria-label="${esc(aria)}"><img class="claudium-coin" src="/claudium/icons/claudium_coin_64.webp" alt=""><span class="claudium-launcher-balance">${esc(label)}</span></button>`;
}
