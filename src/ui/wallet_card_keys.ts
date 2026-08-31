// The "Solana wallet" card's copy, chosen from the wallet connection kind: one
// body sentence and one action label per state, shared by the Claudium panel
// and the $WOC Exchange so the two cards never drift apart (the same
// "Reconnect wallet" / "Manage wallet" button on both). Pure over its input;
// the callers own the markup and the t() resolution.

import type { TranslationKey } from './i18n';
import type { WalletConnectionKind } from './wallet_connection_view';

export interface WalletCardKeys {
  bodyKey: TranslationKey;
  actionKey: TranslationKey;
}

export function walletCardKeys(kind: WalletConnectionKind): WalletCardKeys {
  switch (kind) {
    case 'connected_unlinked':
      return {
        bodyKey: 'hudChrome.wocStore.wallet.connectedUnlinked',
        actionKey: 'hudChrome.wocStore.wallet.verify',
      };
    case 'linked_disconnected':
      return {
        bodyKey: 'hudChrome.wocStore.wallet.linkedDisconnected',
        actionKey: 'hudChrome.wocStore.wallet.reconnect',
      };
    case 'linked_connected':
      return {
        bodyKey: 'hudChrome.wocStore.wallet.linkedConnected',
        actionKey: 'hudChrome.wocStore.wallet.manage',
      };
    case 'mismatched':
      return {
        bodyKey: 'hudChrome.wocStore.wallet.mismatched',
        actionKey: 'hudChrome.wocStore.wallet.verify',
      };
    default:
      return {
        bodyKey: 'hudChrome.wocStore.wallet.unlinked',
        actionKey: 'hudChrome.wocStore.wallet.connect',
      };
  }
}
