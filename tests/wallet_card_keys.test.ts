// The Solana wallet card's copy table is shared by the Claudium panel and the
// $WOC Exchange (src/ui/wallet_card_keys.ts); this pins the state -> copy map
// directly so neither card can drift from the other or from the connection
// view's own action vocabulary (wallet_connection_view.ts).

import { describe, expect, it } from 'vitest';
import { walletCardKeys } from '../src/ui/wallet_card_keys';
import {
  buildWalletConnectionView,
  type WalletConnectionKind,
} from '../src/ui/wallet_connection_view';

describe('wallet_card_keys', () => {
  it('maps every connection kind to its sentence and its one action', () => {
    const cases: Array<[WalletConnectionKind, string, string]> = [
      ['unlinked', 'unlinked', 'connect'],
      ['connected_unlinked', 'connectedUnlinked', 'verify'],
      ['linked_disconnected', 'linkedDisconnected', 'reconnect'],
      ['linked_connected', 'linkedConnected', 'manage'],
      ['mismatched', 'mismatched', 'verify'],
    ];
    for (const [kind, body, action] of cases) {
      expect(walletCardKeys(kind)).toEqual({
        bodyKey: `hudChrome.wocStore.wallet.${body}`,
        actionKey: `hudChrome.wocStore.wallet.${action}`,
      });
    }
  });

  it('agrees with the connection view about which action each state offers', () => {
    // The view decides the action; the card only spells it. A disagreement here
    // would put a "Manage wallet" button on a state the view calls reconnect.
    const linked = buildWalletConnectionView({
      enabled: true,
      linkedAddress: 'L',
      connectedAddress: null,
      linkedBalance: 1,
      connectedBalance: null,
    });
    expect(linked.action).toBe('reconnect');
    expect(walletCardKeys(linked.kind).actionKey).toBe('hudChrome.wocStore.wallet.reconnect');
    const connected = buildWalletConnectionView({
      enabled: true,
      linkedAddress: 'L',
      connectedAddress: 'L',
      linkedBalance: 1,
      connectedBalance: null,
    });
    expect(connected.action).toBe('manage');
    expect(walletCardKeys(connected.kind).actionKey).toBe('hudChrome.wocStore.wallet.manage');
  });

  it('falls back to the connect copy for the disabled kind, which callers hide', () => {
    expect(walletCardKeys('disabled').actionKey).toBe('hudChrome.wocStore.wallet.connect');
  });
});
