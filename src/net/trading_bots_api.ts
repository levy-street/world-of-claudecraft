// REST glue for the Trading Bots flow: the /api/tradingbots fetches plus the
// hooks-object builder main.ts hands to Hud.attachTradingBots.
//
// The dex swap feature inlined this layer in main.ts; this module extracts the
// same role ("main.ts is a firewall, not a home"), so main.ts contributes only
// closures over its private wallet state. It imports NOTHING from src/ui at
// runtime: the two imports below are type-only (erased at build, the same
// sanctioned pattern src/sim uses for world_api shapes), so the net layer
// stays free of any runtime UI dependency.

import type { TradingBotsConfig, TradingBotsStatus } from '../ui/trading_bots_view';
import type {
  TradingBotsSubscribeResult,
  TradingBotsWithdrawResult,
} from '../ui/trading_bots_window';

// A coded /api/tradingbots failure: carries the stable problem+json `code`
// (and the body as `params`) so userFacingApiError localizes it code-first in
// the window (read structurally off the thrown value; no ui import needed).
export class TradingBotsApiError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, unknown>,
    message: string,
  ) {
    super(message);
    this.name = 'TradingBotsApiError';
  }
}

/** The closures main.ts provides over its private wallet/session state. */
export interface TradingBotsGlueDeps {
  /** The bearer session token, or null before login. */
  token(): string | null;
  /** The account's verified linked wallet pubkey, or null. */
  linkedWallet(): string | null;
  /** The CONNECTED wallet address (the one that signs), or null. */
  walletAddress(): string | null;
  /** Wallet Standard signAndSendTransaction over the lazy wallet module. */
  signAndSend(txBase64: string): Promise<string>;
  /** True for the typed missing-wallet-feature error. */
  isWalletFeatureUnsupported(err: unknown): boolean;
  /** Refresh the wallet $WOC balance displays after vault funds moved. */
  onFundsMoved(): void;
}

async function request<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = body && typeof body.code === 'string' ? body.code : '';
    // The message is a diagnostic fallback (stays English by design); the
    // window renders the localized text for `code`.
    throw new TradingBotsApiError(code, body ?? {}, `request failed (${res.status})`);
  }
  return body as T;
}

// Boot-time config read, memoized. 404 IS the flag-off answer
// (trading_bots.disabled): the feature stays invisible, deliberately with no
// error surfaced to the player.
let config: TradingBotsConfig | null = null;
let configLoad: Promise<void> | null = null;

/** Fetch /api/tradingbots/config once (no-op when the wallet UI is off). */
export function loadTradingBotsConfig(walletEnabled: boolean): Promise<void> {
  if (!walletEnabled) return Promise.resolve();
  configLoad ??= (async () => {
    try {
      const res = await fetch('/api/tradingbots/config');
      if (!res.ok) return;
      const cfg = (await res.json()) as TradingBotsConfig;
      if (cfg && cfg.enabled === true && Array.isArray(cfg.skus) && cfg.skus.length > 0) {
        config = cfg;
      }
    } catch (err) {
      // Transport failure at boot: feature hidden this session, diagnostics kept.
      console.error('[tradingbots] config load failed', err);
    }
  })();
  return configLoad;
}

/** The loaded config, or null while unknown/disabled. */
export function tradingBotsConfig(): TradingBotsConfig | null {
  return config;
}

/** Drop the memoized config + in-flight load (test-only). */
export function resetTradingBotsApiForTests(): void {
  config = null;
  configLoad = null;
}

/**
 * Build the hooks object for Hud.attachTradingBots (shaped structurally like
 * ui/hud's TradingBotsHooks; a drift is a tsc error at the attach call site).
 */
export function buildTradingBotsHooks(deps: TradingBotsGlueDeps) {
  const post = <T>(path: string, body: Record<string, unknown>): Promise<T> =>
    request<T>(path, deps.token(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return {
    // Launcher gate: the feature is enabled AND this account has a linked wallet.
    available: (): boolean => config !== null && deps.linkedWallet() !== null,
    config: (): TradingBotsConfig | null => config,
    walletAddress: (): string | null => deps.walletAddress(),
    fetchStatus: (): Promise<TradingBotsStatus> =>
      request<TradingBotsStatus>('/api/tradingbots/status', deps.token()),
    subscribe: (
      skuId: string,
      payWith: 'woc' | 'claudium',
      userPublicKey: string | null,
    ): Promise<TradingBotsSubscribeResult> =>
      post<TradingBotsSubscribeResult>('/api/tradingbots/subscribe', {
        skuId,
        payWith,
        ...(userPublicKey ? { userPublicKey } : {}),
      }),
    confirmSubscribe: (paymentId: string, signature: string): Promise<unknown> =>
      post('/api/tradingbots/subscribe/confirm', { paymentId, signature }),
    deposit: (
      solAmount: string,
      wocAmount: string,
      userPublicKey: string,
    ): Promise<{ depositId: string; depositTransaction: string }> =>
      post('/api/tradingbots/deposit', { solAmount, wocAmount, userPublicKey }),
    confirmDeposit: (depositId: string, signature: string): Promise<unknown> =>
      post('/api/tradingbots/deposit/confirm', { depositId, signature }),
    withdraw: (userPublicKey: string): Promise<TradingBotsWithdrawResult> =>
      post<TradingBotsWithdrawResult>('/api/tradingbots/withdraw', { userPublicKey }),
    control: (
      action: 'start' | 'pause' | 'update_params',
      params?: Record<string, number>,
    ): Promise<unknown> =>
      post('/api/tradingbots/control', { action, ...(params ? { params } : {}) }),
    signAndSend: (txBase64: string): Promise<string> => deps.signAndSend(txBase64),
    isWalletFeatureUnsupported: (err: unknown): boolean => deps.isWalletFeatureUnsupported(err),
    onFundsMoved: (): void => deps.onFundsMoved(),
  };
}
