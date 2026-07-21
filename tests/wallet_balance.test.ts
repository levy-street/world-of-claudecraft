import { describe, expect, it } from 'vitest';
import {
  resolveWocBalanceUpdate,
  setWalletDisplayAvailable,
  setWocBalance,
  shouldDisconnectUnverifiedWallet,
  verifiedWocBalance,
  walletDisplayAvailable,
  wocBalance,
  wocBalanceVerified,
} from '../src/ui/wallet_balance';

describe('wallet balance UI state', () => {
  it('treats connected-wallet balances as unverified previews by default', () => {
    setWocBalance(null);
    setWocBalance(125);

    expect(wocBalance()).toBe(125);
    expect(wocBalanceVerified()).toBe(false);
    expect(verifiedWocBalance()).toBeNull();
  });

  it('exposes a verified balance only after the account link is known', () => {
    setWocBalance(42, true);

    expect(wocBalance()).toBe(42);
    expect(wocBalanceVerified()).toBe(true);
    expect(verifiedWocBalance()).toBe(42);
  });

  it('clears verification when the balance is cleared', () => {
    setWocBalance(null, true);

    expect(wocBalance()).toBeNull();
    expect(wocBalanceVerified()).toBe(false);
    expect(verifiedWocBalance()).toBeNull();
  });

  it('tracks whether a wallet display surface can be toggled', () => {
    setWalletDisplayAvailable(false);
    expect(walletDisplayAvailable()).toBe(false);

    setWalletDisplayAvailable(true);
    expect(walletDisplayAvailable()).toBe(true);
  });
});

describe('resolveWocBalanceUpdate (refresh apply/skip decision)', () => {
  const CONNECTED = 'WALLET_connected';
  const LINKED = 'WALLET_linked';

  it('applies a connected-wallet read but does not touch the linked slot', () => {
    expect(
      resolveWocBalanceUpdate({
        address: CONNECTED,
        fresh: false,
        balance: 1000,
        currentAddress: CONNECTED,
        linkedAddress: null,
      }),
    ).toEqual({ apply: true, setLinked: false });
  });

  it('mirrors into the linked slot when the address is the linked wallet', () => {
    expect(
      resolveWocBalanceUpdate({
        address: LINKED,
        fresh: true,
        balance: 2000,
        currentAddress: LINKED,
        linkedAddress: LINKED,
      }),
    ).toEqual({ apply: true, setLinked: true });
    // Linked even when it is not the currently-connected wallet (e.g. background re-read).
    expect(
      resolveWocBalanceUpdate({
        address: LINKED,
        fresh: false,
        balance: 2000,
        currentAddress: CONNECTED,
        linkedAddress: LINKED,
      }),
    ).toEqual({ apply: true, setLinked: true });
  });

  it('skips a stale result for a wallet the user switched away from', () => {
    // The read was for an address that is now neither connected nor linked.
    expect(
      resolveWocBalanceUpdate({
        address: 'WALLET_old',
        fresh: true,
        balance: 9999,
        currentAddress: CONNECTED,
        linkedAddress: LINKED,
      }),
    ).toEqual({ apply: false, setLinked: false });
  });

  it('skips a FRESH read that came back null (transient transport blip) so the shown value survives', () => {
    expect(
      resolveWocBalanceUpdate({
        address: CONNECTED,
        fresh: true,
        balance: null,
        currentAddress: CONNECTED,
        linkedAddress: null,
      }),
    ).toEqual({ apply: false, setLinked: false });
  });

  it('lets a NON-fresh initial read settle on null (it cleared the slot first)', () => {
    expect(
      resolveWocBalanceUpdate({
        address: CONNECTED,
        fresh: false,
        balance: null,
        currentAddress: CONNECTED,
        linkedAddress: null,
      }),
    ).toEqual({ apply: true, setLinked: false });
  });
});

describe('shouldDisconnectUnverifiedWallet (auto-reconnect reap decision)', () => {
  const base = {
    connectedAddress: 'WALLET_A',
    linkedPubkey: null as string | null,
    verifyPending: false,
    verifyInProgress: false,
    linkStatusPending: false,
  };

  it('disconnects an idle, connected, non-linked wallet', () => {
    expect(shouldDisconnectUnverifiedWallet(base)).toBe(true);
  });

  it('keeps the wallet when nothing is connected', () => {
    expect(shouldDisconnectUnverifiedWallet({ ...base, connectedAddress: null })).toBe(false);
  });

  it('keeps the wallet that matches the account-linked pubkey', () => {
    expect(shouldDisconnectUnverifiedWallet({ ...base, linkedPubkey: 'WALLET_A' })).toBe(false);
  });

  it('keeps a wallet while a verify flow is mid-flight', () => {
    expect(shouldDisconnectUnverifiedWallet({ ...base, verifyPending: true })).toBe(false);
    expect(shouldDisconnectUnverifiedWallet({ ...base, verifyInProgress: true })).toBe(false);
  });

  // Regression: on a restored session the wallet auto-reconnects BEFORE the linked
  // status has loaded. Reaping it there forced a re-sign on every reload even though
  // the account-to-wallet link is durable server-side.
  it('keeps a connected wallet while the link status is still loading', () => {
    expect(shouldDisconnectUnverifiedWallet({ ...base, linkStatusPending: true })).toBe(false);
  });

  it('disconnects a wallet that differs from the linked one once status is known', () => {
    expect(
      shouldDisconnectUnverifiedWallet({
        ...base,
        connectedAddress: 'WALLET_B',
        linkedPubkey: 'WALLET_A',
      }),
    ).toBe(true);
  });
});
