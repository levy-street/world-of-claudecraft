// Client-side wallet balance surfaced in the HUD (the bag footer).
//
// The connected wallet's $WOC balance is external (read from a Solana RPC by
// src/net/wallet) and is NOT world state, so it doesn't belong on IWorld. To
// keep src/ui free of any src/net import, main.ts (the one layer that knows
// both) pushes the value in here, and the HUD reads it out. A single listener
// lets the bag re-render when the value changes. The balance may be an
// unverified connected-wallet preview, so callers that make public claims must
// check the verified flag or read verifiedWocBalance().
import { buildWalletConnectionView, type WalletConnectionView } from './wallet_connection_view';

let enabled = false;
let balance: number | null = null;
let verified = false;
let displayAvailable = false;
let linkedAddress: string | null = null;
let connectedAddress: string | null = null;
let externalSignerAvailable = false;
let listener: (() => void) | null = null;

/** Whether the wallet feature is enabled in this client build. */
export function walletUiEnabled(): boolean {
  return enabled;
}

/** The connected wallet's $WOC balance, or null when no wallet is connected. */
export function wocBalance(): number | null {
  return balance;
}

/** Whether the current balance belongs to the account-linked wallet. */
export function wocBalanceVerified(): boolean {
  return balance !== null && verified;
}

/** The verified account-linked wallet balance, or null when unlinked. */
export function verifiedWocBalance(): number | null {
  return wocBalanceVerified() ? balance : null;
}

/** Whether any wallet is connected in this browser or linked to the account. */
export function walletDisplayAvailable(): boolean {
  return displayAvailable;
}

export function walletConnectionView(): WalletConnectionView {
  return buildWalletConnectionView({
    enabled,
    linkedAddress,
    connectedAddress,
    linkedBalance: verified ? balance : null,
    connectedBalance: !verified ? balance : null,
    externalSignerAvailable,
  });
}

export function setWalletConnectionAddresses(
  linked: string | null,
  connected: string | null,
  externalSigner = false,
): void {
  if (
    linkedAddress === linked &&
    connectedAddress === connected &&
    externalSignerAvailable === externalSigner
  )
    return;
  linkedAddress = linked;
  connectedAddress = connected;
  externalSignerAvailable = externalSigner;
  listener?.();
}

export function setWalletUiEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  listener?.();
}

export function setWocBalance(value: number | null, isVerified = false): void {
  const nextVerified = value !== null && isVerified;
  if (balance === value && verified === nextVerified) return;
  balance = value;
  verified = nextVerified;
  listener?.();
}

export function setWalletDisplayAvailable(value: boolean): void {
  if (displayAvailable === value) return;
  displayAvailable = value;
  listener?.();
}

/** Register the HUD's re-render hook (one consumer: the bag). */
export function onWalletUiChange(cb: () => void): void {
  listener = cb;
}

export interface WocBalanceUpdate {
  /** Apply the fetched balance to the connected-wallet slot, or leave it untouched. */
  apply: boolean;
  /** Also mirror it into the account-linked slot (this address is the linked one). */
  setLinked: boolean;
}

/**
 * Decide whether a just-fetched balance should update the displayed value, given
 * what the wallet state looks like NOW (a read is async, so the wallet can change
 * under it). Pure so main.ts's refresh orchestration is unit-testable without a DOM.
 *
 * Two skips: (1) the result is stale — the user switched or unlinked the wallet
 * mid-flight, so this address is neither the connected nor the linked one; (2) a
 * FRESH on-demand read came back null, which is a transient client transport
 * failure (the server falls back to the last-known balance on an RPC failure), so
 * we must not wipe a value the user was already shown. A non-fresh initial read is
 * allowed to settle on null (it cleared the slot first).
 */
export function resolveWocBalanceUpdate(opts: {
  address: string;
  fresh: boolean;
  balance: number | null;
  currentAddress: string | null;
  linkedAddress: string | null;
}): WocBalanceUpdate {
  const { address, fresh, balance, currentAddress, linkedAddress } = opts;
  if (currentAddress !== address && linkedAddress !== address)
    return { apply: false, setLinked: false };
  if (fresh && balance === null) return { apply: false, setLinked: false };
  return { apply: true, setLinked: linkedAddress === address };
}

/**
 * Decide whether a merely-connected browser wallet should be disconnected as
 * "unverified" when the app is idle. Pure so main.ts's auto-reconnect handling is
 * unit-testable without a DOM.
 *
 * A connected wallet is KEPT (not disconnected) when:
 *  - nothing is connected (nothing to do);
 *  - a verify flow is mid-flight (`verifyPending`/`verifyInProgress`), since it is
 *    about to be linked;
 *  - the account's link status hasn't loaded yet (`linkStatusPending`): this is
 *    the boot/reload window. Disconnecting here is the bug that forced a re-sign on
 *    every reload even though the link is durable server-side: the wallet
 *    auto-reconnects before we've learned it is the linked one;
 *  - it already matches the account-linked pubkey (it IS verified).
 * Otherwise it is an unverified, idle, non-linked wallet and should be dropped.
 */
export function shouldDisconnectUnverifiedWallet(opts: {
  connectedAddress: string | null;
  linkedPubkey: string | null;
  verifyPending: boolean;
  verifyInProgress: boolean;
  linkStatusPending: boolean;
}): boolean {
  const { connectedAddress, linkedPubkey, verifyPending, verifyInProgress, linkStatusPending } =
    opts;
  if (!connectedAddress) return false;
  if (verifyPending || verifyInProgress || linkStatusPending) return false;
  if (connectedAddress === linkedPubkey) return false;
  return true;
}
