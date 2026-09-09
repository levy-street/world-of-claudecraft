// The Exchange wallet card's dismissal pure core: which connection states may be
// hidden, the per-state persistence, and the tolerant parse that keeps a corrupt
// or stale localStorage row from ever hiding a card that asks for action.
// DOM-free, driven over a tiny fake Storage (the party_collapse.ts test shape).

import { describe, expect, it } from 'vitest';
import {
  loadWalletCardDismissal,
  saveWalletCardDismissal,
  WOC_WALLET_CARD_DISMISS_KEY,
  walletCardDismissible,
  walletCardHidden,
} from '../src/ui/woc_wallet_card_dismiss';

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    _map: map,
  };
}
const throwingStorage = {
  getItem: () => {
    throw new Error('unavailable');
  },
  setItem: () => {
    throw new Error('unavailable');
  },
  removeItem: () => {
    throw new Error('unavailable');
  },
};

describe('walletCardDismissible', () => {
  it('only the reconnect state is informational enough to hide', () => {
    expect(walletCardDismissible('linked_disconnected')).toBe(true);
  });
  it('a state that gates buying or selling stays on screen', () => {
    // Unlinked and connected-but-unlinked are the only path to linking, and a
    // mismatch needs the player to pick a wallet; hiding any of them would leave
    // disabled Buy / Sell buttons with no explanation.
    expect(walletCardDismissible('unlinked')).toBe(false);
    // Connected carries the verified balance and the Manage entry: keep it.
    expect(walletCardDismissible('linked_connected')).toBe(false);
    expect(walletCardDismissible('connected_unlinked')).toBe(false);
    expect(walletCardDismissible('mismatched')).toBe(false);
    expect(walletCardDismissible('disabled')).toBe(false);
  });
});

describe('walletCardHidden', () => {
  it('hides exactly the dismissed kind, and only while the wallet is still in it', () => {
    expect(walletCardHidden('linked_disconnected', 'linked_disconnected')).toBe(true);
    // The kind moved on (a reconnect landed, or a different wallet showed up):
    // the card comes back so the new state is never silently swallowed.
    expect(walletCardHidden('linked_connected', 'linked_disconnected')).toBe(false);
    expect(walletCardHidden('mismatched', 'linked_disconnected')).toBe(false);
    expect(walletCardHidden('linked_disconnected', null)).toBe(false);
  });
  it('never hides an actionable kind even if storage claims it was dismissed', () => {
    expect(walletCardHidden('unlinked', 'unlinked' as never)).toBe(false);
    expect(walletCardHidden('mismatched', 'mismatched' as never)).toBe(false);
  });
});

describe('wallet card dismissal persistence', () => {
  it('pins the exact localStorage key (a rename would silently un-dismiss every card)', () => {
    expect(WOC_WALLET_CARD_DISMISS_KEY).toBe('woc_exchange_wallet_card_dismissed');
  });
  it('round-trips the dismissible kind and clears on null', () => {
    const s = fakeStorage();
    saveWalletCardDismissal('linked_disconnected', s);
    expect(s._map.get(WOC_WALLET_CARD_DISMISS_KEY)).toBe('linked_disconnected');
    expect(loadWalletCardDismissal(s)).toBe('linked_disconnected');
    saveWalletCardDismissal(null, s);
    expect(s._map.has(WOC_WALLET_CARD_DISMISS_KEY)).toBe(false);
    expect(loadWalletCardDismissal(s)).toBeNull();
  });
  it('treats a missing, corrupt, or non-dismissible stored value as "not dismissed"', () => {
    expect(loadWalletCardDismissal(fakeStorage())).toBeNull();
    expect(loadWalletCardDismissal(fakeStorage({ [WOC_WALLET_CARD_DISMISS_KEY]: 'x' }))).toBeNull();
    expect(
      loadWalletCardDismissal(fakeStorage({ [WOC_WALLET_CARD_DISMISS_KEY]: 'mismatched' })),
    ).toBeNull();
    expect(
      loadWalletCardDismissal(fakeStorage({ [WOC_WALLET_CARD_DISMISS_KEY]: 'unlinked' })),
    ).toBeNull();
    // A row written by an earlier build that allowed the connected card.
    expect(
      loadWalletCardDismissal(fakeStorage({ [WOC_WALLET_CARD_DISMISS_KEY]: 'linked_connected' })),
    ).toBeNull();
  });
  it('survives an unavailable storage on both read and write', () => {
    expect(loadWalletCardDismissal(null)).toBeNull();
    expect(loadWalletCardDismissal(throwingStorage)).toBeNull();
    expect(() => saveWalletCardDismissal('linked_disconnected', throwingStorage)).not.toThrow();
    expect(() => saveWalletCardDismissal(null, null)).not.toThrow();
  });
});
