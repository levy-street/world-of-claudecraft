// One-call composition of the $WOC Exchange attach (docs/prd/woc/marketplace.md):
// browser web, verified Seeker Solana dApp Store Android, plus the
// WEBSITE-distributed Electron desktop shell. Google Play Android, iOS, Steam,
// and Epic stay fail-closed, as does any shell that cannot prove its allowed
// distribution and device. The server additionally answers woc_market.disabled
// until WOC_MARKET_ENABLED=1. src/main.ts calls this once from its online entry
// (main.ts is a firewall, not a home), and the shell flags default to the
// live NATIVE_APP / DESKTOP_APP constants plus the live native and desktop
// bridges while staying injectable so the gate is unit-testable without a
// Capacitor or Electron host.
//
// A wrapped DESKTOP shell denied by that gate still gets a launcher:
// attachWocMarketBrowserOnlyNotice reveals the SAME menu icon wired to the
// browser hand-off (src/ui/woc_market_link.ts) instead of leaving it silently
// hidden, which used to read as a missing feature rather than an out-of-scope
// one. Capacitor NATIVE (iOS/Android) gets neither the real Exchange nor the
// hand-off notice and stays exactly as silent as before: steering a
// mobile-app-store build to an external real-money marketplace is the
// anti-steering shape those stores restrict, and the PRD's counsel-gated
// scope has not signed off on that. No Exchange UI, wallet code, or trading
// flow attaches on a denied wrapped-shell path.
import { DESKTOP_APP, NATIVE_APP } from '../client_origin';
import type {
  DesktopWalletBrowserAction,
  DesktopWalletBrowserResult,
} from '../net/desktop_wallet_handoff';
import { nativeSolanaMobileBridge } from '../net/native_solana_mobile';
import { resolveWalletCapability, type WalletCapabilityBridge } from '../net/wallet_capability';
import { WocMarketClient } from '../net/woc_market_sdk';
import { desktopBridge } from '../runtime';
import type { WocMarketHooks } from '../ui/woc_market_window';

/** The one desktop-bridge probe the gate reads (src/runtime.ts DesktopBridge). */
export interface WocMarketShellBridge {
  wocExchangeSupported?(): Promise<boolean>;
}

export interface WocMarketShell {
  nativeApp: boolean;
  desktopApp: boolean;
  /** The desktop shell bridge, or null outside the desktop shell. */
  bridge: WocMarketShellBridge | null;
  /** The Solana Mobile capability bridge, or null outside native Android. */
  mobileBridge?: WalletCapabilityBridge | null;
}

export interface WocMarketWiringDeps {
  hud: {
    attachWocMarket(hooks: WocMarketHooks): void;
    /** Reveal the launcher on a wrapped DESKTOP shell, wired to the browser hand-off. */
    attachWocMarketBrowserOnlyNotice?(): void;
  };
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
    /** The desktop shell's external-browser wallet signer (main.ts wires it
     *  from the live handoff bridge), or null outside the desktop shell. When
     *  present it REPLACES the in-renderer wallet for both Exchange signers:
     *  the desktop shell never has an in-renderer wallet selected, so the
     *  `load()` arm there would always throw at sign time. */
    desktopAuthorize:
      | ((action: DesktopWalletBrowserAction) => Promise<DesktopWalletBrowserResult>)
      | null;
  };
}

/** True for browser web, verified Seeker Solana-store Android, and a desktop
 *  shell whose main process proves the website distribution. Every other shell
 *  stays fail-closed. */
export async function wocMarketAttachAllowed(shell: WocMarketShell): Promise<boolean> {
  if (shell.nativeApp) {
    return resolveWalletCapability({
      disabled: false,
      nativeApp: true,
      desktopApp: false,
      bridge: shell.mobileBridge ?? null,
    });
  }
  if (!shell.desktopApp) return true;
  try {
    return (await shell.bridge?.wocExchangeSupported?.()) === true;
  } catch {
    return false;
  }
}

/** True for a wrapped DESKTOP shell only (Electron, Steam, the packaged
 *  website build): the platform the reported bug covers. Capacitor native
 *  (iOS/Android) gets neither the real Exchange NOR this hand-off launcher
 *  (see the module header); a shell that is somehow both stays on the
 *  conservative, fully-silent native side. */
export function wocMarketBrowserHandoffAllowed(shell: WocMarketShell): boolean {
  return shell.desktopApp && !shell.nativeApp;
}

/** Attach the $WOC Exchange hooks on browser web, verified Seeker Solana-store
 *  Android, and website-distributed desktop; reveal the browser-hand-off
 *  launcher on a denied wrapped desktop shell. Resolves to whether the real
 *  Exchange attached. */
export async function attachWocMarketExchange(
  deps: WocMarketWiringDeps,
  shell: WocMarketShell = {
    nativeApp: NATIVE_APP,
    desktopApp: DESKTOP_APP,
    bridge: desktopBridge(),
    mobileBridge: NATIVE_APP ? nativeSolanaMobileBridge : null,
  },
): Promise<boolean> {
  if (!(await wocMarketAttachAllowed(shell))) {
    if (wocMarketBrowserHandoffAllowed(shell)) deps.hud.attachWocMarketBrowserOnlyNotice?.();
    return false;
  }
  const { api, online, wallet } = deps;
  deps.hud.attachWocMarket({
    client: new WocMarketClient({ token: () => api.token, base: api.base }),
    characterId: () => online.characterId,
    walletLinked: () => wallet.linkedPubkey() !== null,
    // Both signers: the desktop shell rides the external-browser handoff (the
    // server resolves the signable bytes from its own registered quote or
    // step-up challenge, never from these arguments); browser web keeps the
    // in-renderer wallet, loaded lazily on first sign so attaching the
    // Exchange still costs no wallet code. The throw strings here are
    // classified by src/ui/wallet_bridge_reason_text.ts, keep them stable.
    signAndSendTransactionBase64: async (transactionBase64, reference) => {
      const authorize = wallet.desktopAuthorize;
      if (!authorize) return (await wallet.load()).signAndSendTransactionBase64(transactionBase64);
      const expectedAddress = wallet.linkedPubkey();
      if (!expectedAddress) throw new Error('connect a wallet first');
      if (!reference) throw new Error('server returned an invalid wallet authorization');
      const result = await authorize({ kind: 'transaction', reference, expectedAddress });
      if (result.kind !== 'transaction') {
        throw new Error('wallet returned an invalid transaction authorization');
      }
      return result.signature;
    },
    // The step-up prompt's signer (B6/R1): the desktop arm sends only the
    // challenge NONCE (the server resolves the stored message it issued).
    signMessageBase58: async (message, stepUpNonce) => {
      const authorize = wallet.desktopAuthorize;
      if (!authorize) return (await wallet.load()).signMessageBase58(message);
      const expectedAddress = wallet.linkedPubkey();
      if (!expectedAddress) throw new Error('connect a wallet first');
      if (!stepUpNonce) throw new Error('server returned an invalid wallet authorization');
      const result = await authorize({ kind: 'stepup', nonce: stepUpNonce, expectedAddress });
      if (result.kind !== 'stepup') {
        throw new Error('wallet returned an invalid step-up authorization');
      }
      return result.signature;
    },
  });
  return true;
}
