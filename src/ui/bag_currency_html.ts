// The two currency chips in the bag header: the connected wallet's $WOC balance and the
// CLAUDIUM launcher.
//
// Lifted out of hud.ts because neither needs the coordinator: each is a pure function from
// a handful of already-resolved values to one markup string. The HUD keeps the thin methods
// that gather those values, which is the part that genuinely does need `this`.
//
// Both escape every interpolated value. That is not defensive habit: a character name and a
// locale-formatted number both reach these strings, and this markup is assigned through
// innerHTML.

import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** Which affordance the unlinked/disconnected wallet chip should offer. */
export type WalletChipAction = 'reconnect' | 'link' | 'connect';

/**
 * The wallet chip when there is no balance to show yet: a button that starts the flow.
 *
 * Separate from the balance arm below because the two are different ELEMENTS (a button that
 * acts versus a span that reports), and collapsing them behind a ternary on the tag name is
 * what made the original hard to read.
 */
export function walletActionChipHtml(action: WalletChipAction): string {
  const label =
    action === 'reconnect'
      ? t('wallet.bagReconnect')
      : action === 'link'
        ? t('wallet.bagLink')
        : t('wallet.bagConnect');
  return `<button type="button" class="woc-balance woc-wallet-action" data-wallet-action aria-label="${esc(label)}"><span class="woc-coin" aria-hidden="true"></span>${esc(label)}</button>`;
}

/**
 * The wallet chip with a balance.
 *
 * A VERIFIED balance renders as a span (it is a fact about the linked account, nothing to
 * click); an unverified one stays a button, because it is a local preview and the action it
 * offers is "link this wallet so it counts".
 */
export function walletBalanceChipHtml(balance: number, verified: boolean): string {
  const amount = formatNumber(balance, { maximumFractionDigits: 2 });
  const shown = t('wallet.balanceAmount', { amount });
  const title = verified ? t('wallet.balanceTitle') : t('wallet.balancePreviewTitle');
  const aria = verified
    ? t('wallet.balanceAria', { balance: shown })
    : t('wallet.balancePreviewAria', { balance: shown });
  const cls = verified ? 'is-verified' : 'is-preview';
  const open = verified ? 'span' : 'button type="button" data-wallet-action';
  const close = verified ? 'span' : 'button';
  return `<${open} class="woc-balance ${cls}" title="${esc(title)}" aria-label="${esc(aria)}"><span class="woc-coin" aria-hidden="true"></span>${esc(shown)}</${close}>`;
}

/** The CLAUDIUM launcher chip. A null balance shows the placeholder, never a bare 0. */
export function claudiumLauncherHtml(balance: number | null): string {
  const label = balance === null ? '--' : formatNumber(balance, { maximumFractionDigits: 0 });
  const aria = t('hudChrome.claudium.open');
  return `<button type="button" class="claudium-launcher" data-claudium-launcher title="${esc(aria)}" aria-label="${esc(aria)}"><img class="claudium-coin" src="/claudium/icons/claudium_coin_64.webp" alt=""><span class="claudium-launcher-balance">${esc(label)}</span></button>`;
}
