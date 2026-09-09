// The $WOC Exchange wallet card's dismissal pure core (the reconnect-wallet
// prompt on a phone). Wallet CONNECTION is per-browser state: a phone browser
// has no injected wallet and no desktop handoff signer, so an account that is
// linked and connected on the desktop lands in `linked_disconnected` on mobile
// every time, and the card that state paints ate the landscape sheet's height
// while asking for something the player did not need to do (buying still goes
// through the wallet step-up on demand). This module decides which states are
// informational enough to hide, remembers the choice per state, and brings the
// card back the moment the state changes, so a mismatch or an unlinked account
// is never silently swallowed by an old dismissal.
//
// State half only (DOM-free, Node-tested): the persistence key + load/save and
// the two resolvers. The markup lives in woc_market_chrome.ts and the click arm
// in woc_market_window.ts. Same storage shape as party_collapse.ts.

import { safeLocalStorage } from './safe_local_storage';
import type { WalletConnectionKind } from './wallet_connection_view';

/** The persisted dismissal's localStorage key: the dismissed connection kind. */
export const WOC_WALLET_CARD_DISMISS_KEY = 'woc_exchange_wallet_card_dismissed';

export type DismissibleWalletCardKind = 'linked_disconnected';

/** Only the reconnect state may be hidden: the address is on the account, so
 *  both buying (the on-demand wallet step-up) and selling already work, and the
 *  card is a status line, not a gate. Unlinked, connected-unlinked and mismatched
 *  are the player's only path to a working wallet and stay on screen; the
 *  connected card stays too, because it carries the verified balance readout
 *  and this window's only Manage wallet entry, and there is no re-show control. */
export function walletCardDismissible(
  kind: WalletConnectionKind,
): kind is DismissibleWalletCardKind {
  return kind === 'linked_disconnected';
}

/** Hide the card only while the wallet is still in the exact kind the player
 *  dismissed; any change of state repaints it. */
export function walletCardHidden(
  kind: WalletConnectionKind,
  dismissed: DismissibleWalletCardKind | null,
): boolean {
  return dismissed !== null && walletCardDismissible(kind) && kind === dismissed;
}

/** Read the persisted dismissed kind. Null (nothing hidden) when storage is
 *  unavailable, the key is unset, a read throws, or the value is not one of the
 *  dismissible kind (a corrupt row must never hide an actionable card). */
export function loadWalletCardDismissal(
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): DismissibleWalletCardKind | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WOC_WALLET_CARD_DISMISS_KEY);
    return raw !== null && walletCardDismissible(raw as WalletConnectionKind)
      ? (raw as DismissibleWalletCardKind)
      : null;
  } catch {
    return null;
  }
}

/** Persist the dismissed kind, or remove the row on null. Silently no-ops when
 *  storage is unavailable or a write throws. */
export function saveWalletCardDismissal(
  kind: DismissibleWalletCardKind | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeLocalStorage(),
): void {
  try {
    if (kind === null) storage?.removeItem(WOC_WALLET_CARD_DISMISS_KEY);
    else storage?.setItem(WOC_WALLET_CARD_DISMISS_KEY, kind);
  } catch {
    /* storage unavailable */
  }
}
