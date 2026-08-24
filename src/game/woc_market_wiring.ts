// One-call composition of the $WOC Exchange attach (docs/prd/woc/marketplace.md):
// browser web ONLY. Electron desktop, Steam, and Capacitor native stay
// fail-closed, tighter than the wallet-link gate, per the PRD's browser-only
// scope; the server additionally answers woc_market.disabled until
// WOC_MARKET_ENABLED=1. src/main.ts calls this once from its online entry
// (main.ts is a firewall, not a home), and the shell flags default to the live
// NATIVE_APP / DESKTOP_APP constants while staying injectable so the gate is
// unit-testable without a Capacitor or Electron host.
import { DESKTOP_APP, NATIVE_APP } from '../client_origin';
import { WocMarketClient } from '../net/woc_market_sdk';
import type { WocMarketHooks } from '../ui/woc_market_window';

export interface WocMarketShell {
  nativeApp: boolean;
  desktopApp: boolean;
}

export interface WocMarketWiringDeps {
  hud: { attachWocMarket(hooks: WocMarketHooks): void };
  /** The live REST session: `token` is read at request time, `base` once. */
  api: { readonly token: string | null; readonly base: string };
  online: { readonly characterId: number };
  wallet: {
    linkedPubkey(): string | null;
    /** The lazily loaded wallet bridge (src/net/wallet.ts), loaded on first sign. */
    load(): Promise<{
      signAndSendTransactionBase64(transactionBase64: string): Promise<string>;
      signMessageBase58(message: string): Promise<string>;
    }>;
  };
}

/** True only for the plain browser web build; every wrapped shell stays fail-closed. */
export function wocMarketAttachAllowed(shell: WocMarketShell): boolean {
  return !shell.nativeApp && !shell.desktopApp;
}

/** Attach the $WOC Exchange hooks on browser web only. Returns whether it attached. */
export function attachWocMarketExchange(
  deps: WocMarketWiringDeps,
  shell: WocMarketShell = { nativeApp: NATIVE_APP, desktopApp: DESKTOP_APP },
): boolean {
  if (!wocMarketAttachAllowed(shell)) return false;
  const { api, online, wallet } = deps;
  deps.hud.attachWocMarket({
    client: new WocMarketClient({ token: () => api.token, base: api.base }),
    characterId: () => online.characterId,
    walletLinked: () => wallet.linkedPubkey() !== null,
    signAndSendTransactionBase64: async (transactionBase64) =>
      (await wallet.load()).signAndSendTransactionBase64(transactionBase64),
    // The step-up prompt's signer (B6/R1): same lazy bridge, loaded on first
    // sign, so attaching the Exchange still costs no wallet code.
    signMessageBase58: async (message) => (await wallet.load()).signMessageBase58(message),
  });
  return true;
}
