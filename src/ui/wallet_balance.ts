// Client-side wallet balance surfaced in the HUD (the bag footer).
//
// The connected wallet's $WOC balance is external (read from a Solana RPC by
// src/net/wallet) and is NOT world state, so it doesn't belong on IWorld. To
// keep src/ui free of any src/net import, main.ts — the one layer that knows
// both — pushes the value in here, and the HUD reads it out. A single listener
// lets the bag re-render when the value changes.
let enabled = false;
let balance: number | null = null;
let listener: (() => void) | null = null;

/** Whether the wallet feature is configured (VITE_REOWN_PROJECT_ID set). */
export function walletUiEnabled(): boolean {
  return enabled;
}

/** The connected wallet's $WOC balance, or null when no wallet is connected. */
export function wocBalance(): number | null {
  return balance;
}

export function setWalletUiEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  listener?.();
}

export function setWocBalance(value: number | null): void {
  if (balance === value) return;
  balance = value;
  listener?.();
}

/** Register the HUD's re-render hook (one consumer: the bag). */
export function onWalletUiChange(cb: () => void): void {
  listener = cb;
}
