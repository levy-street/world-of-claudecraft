// The bag's $WOC balance chip: the connected wallet's balance beside the coins,
// or the connect / link / reconnect call to action when there is none to show.
//
// A pure HTML builder over the wallet_balance reads (no DOM, no host state of
// its own), extracted from the Hud coordinator so the chip spells its token
// figure through the shared woc_tokens_text.ts spelling every other $WOC
// readout uses, without the coordinator growing an import for it. Unlinked
// balances are a local preview; verified balances belong to the account-linked
// wallet and may drive public holder claims elsewhere. The bags window's
// deps bag calls this and never imports it directly (Hud composes it).

import { esc } from './esc';
import { t } from './i18n';
import {
  walletConnectionView,
  walletUiEnabled,
  wocBalance,
  wocBalanceVerified,
} from './wallet_balance';
import { wocTokensText } from './woc_tokens_text';

export function wocBalanceChipHtml(): string {
  if (!walletUiEnabled()) return '';
  const state = walletConnectionView();
  const bal = wocBalance();
  if (bal === null) {
    const label =
      state.kind === 'linked_disconnected'
        ? t('wallet.bagReconnect')
        : state.kind === 'connected_unlinked' || state.kind === 'mismatched'
          ? t('wallet.bagLink')
          : t('wallet.bagConnect');
    return `<button type="button" class="woc-balance woc-wallet-action" data-wallet-action aria-label="${esc(label)}"><span class="woc-coin" aria-hidden="true"></span>${esc(label)}</button>`;
  }
  const amount = wocTokensText(bal);
  const balance = t('wallet.balanceAmount', { amount });
  const verified = wocBalanceVerified();
  const title = verified ? t('wallet.balanceTitle') : t('wallet.balancePreviewTitle');
  const aria = verified
    ? t('wallet.balanceAria', { balance })
    : t('wallet.balancePreviewAria', { balance });
  const tag = verified ? 'span' : 'button type="button" data-wallet-action';
  return `<${tag} class="woc-balance ${verified ? 'is-verified' : 'is-preview'}" title="${esc(title)}" aria-label="${esc(aria)}"><span class="woc-coin" aria-hidden="true"></span>${esc(balance)}</${verified ? 'span' : 'button'}>`;
}
