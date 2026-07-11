// Pure flow orchestration for the Trading Bots window: rent (WOC on-chain or
// Claudium single-call), fund the vault, withdraw (both custody shapes), and
// bot control, each as one seq-guarded async operation.
//
// DOM/Three/i18n-free (UI_PURE_CORES-registered): extracted from
// trading_bots_window.ts so every button flow is directly unit-testable with
// fake async ops and a fake host, no DOM required. The core mutates state only
// through the injected TradingBotsFlowHost (get/set op state, notice TAGS the
// window localizes, paint signals, the status re-read) and calls endpoints
// only through the injected TradingBotsFlowOps. Time is INJECTED (host.now());
// this module never reads a clock. The thin DOM consumer is
// trading_bots_window.ts, which contributes field reads + painting only.

import {
  beginOp,
  isCoolingDown,
  isOpInFlight,
  opConfirming,
  opDone,
  opFailed,
  opRateLimited,
  opSigning,
  type TradingBotSku,
  type TradingBotsConfig,
  type TradingBotsOpState,
  validateDeposit,
} from './trading_bots_view';

// Coarse error tags the pure op state carries; the window maps each to a
// localized message (the original thrown value is kept window-side for the
// code-first API localizer).
export const ERR_API = 'api';
export const ERR_WALLET_FEATURE = 'wallet_feature';
export const ERR_SIGN_FAILED = 'sign_failed';
export const ERR_NO_WALLET = 'no_wallet';

/** The subscribe answer: a WOC payment leg, or a one-call Claudium rental. */
export interface TradingBotsSubscribeResult {
  paymentId?: string;
  paymentTransaction?: string;
  subscription?: unknown;
}

/** The withdraw answer: an owner transaction to sign, or a pending payout. */
export interface TradingBotsWithdrawResult {
  withdrawTransaction?: string;
}

/** Success-notice tags the window localizes (the core never touches t()). */
export type TradingBotsNoticeTag = 'subscribed' | 'withdrawPending';

/** The window-side state and paint surface a flow drives. */
export interface TradingBotsFlowHost {
  getOp(): TradingBotsOpState;
  setOp(op: TradingBotsOpState): void;
  /** Set (or clear) the localized success notice by tag. */
  setNotice(tag: TradingBotsNoticeTag | null): void;
  /** Keep the thrown value for the code-first API localizer. */
  setLastApiError(err: unknown): void;
  paintPanel(): void;
  /** The deposit inputs failed client-side validation (field error paint). */
  onFieldInvalid(): void;
  /** Re-read the status aggregate and repaint (after a completed op). */
  refreshStatus(): Promise<void>;
  /** The connected wallet address money ops bind to, or null. */
  walletAddress(): string | null;
  /** True for the typed missing-wallet-feature error. */
  isWalletFeatureUnsupported(err: unknown): boolean;
  /** Called after funds moved (deposit/withdraw sent) so balances refresh. */
  onFundsMoved(): void;
  /** Injected clock; the core never reads time itself. */
  now(): number;
}

/** The proxied endpoints + the wallet signer a flow calls. A structural
 *  subset of TradingBotsWindowDeps, so the window passes its deps verbatim. */
export interface TradingBotsFlowOps {
  subscribe(
    skuId: string,
    payWith: 'woc' | 'claudium',
    userPublicKey: string | null,
  ): Promise<TradingBotsSubscribeResult>;
  confirmSubscribe(paymentId: string, signature: string): Promise<unknown>;
  deposit(
    solAmount: string,
    wocAmount: string,
    userPublicKey: string,
  ): Promise<{ depositId: string; depositTransaction: string }>;
  confirmDeposit(depositId: string, signature: string): Promise<unknown>;
  withdraw(userPublicKey: string): Promise<TradingBotsWithdrawResult>;
  control(
    action: 'start' | 'pause' | 'update_params',
    params?: Record<string, number>,
  ): Promise<unknown>;
  signAndSend(txBase64: string): Promise<string>;
}

/** True while another op is in flight or a rate-limit cooldown is live. */
function refused(host: TradingBotsFlowHost): boolean {
  const op = host.getOp();
  return isOpInFlight(op) || isCoolingDown(op, host.now());
}

/** Enter the no-wallet error state for a kind that needs a signer. */
function refuseNoWallet(
  host: TradingBotsFlowHost,
  kind: 'subscribe' | 'deposit' | 'withdraw',
): void {
  host.setOp({ ...beginOp(host.getOp(), kind), phase: 'error', errorCode: ERR_NO_WALLET });
  host.paintPanel();
}

/**
 * Rent a bot. payWith 'woc': subscribe -> wallet sign -> confirm (a malformed
 * payment leg from the service is an error, never signed); payWith 'claudium':
 * one service-side call. A completed rental sets the 'subscribed' notice and
 * re-reads status (which flips the window to the funding screen).
 */
export async function rentFlow(
  host: TradingBotsFlowHost,
  ops: TradingBotsFlowOps,
  skuId: string,
  payWith: 'woc' | 'claudium',
): Promise<void> {
  if (refused(host)) return;
  const owner = host.walletAddress();
  if (payWith === 'woc' && !owner) {
    refuseNoWallet(host, 'subscribe');
    return;
  }
  host.setNotice(null);
  host.setOp(beginOp(host.getOp(), 'subscribe'));
  const seq = host.getOp().seq;
  host.paintPanel();
  try {
    const result = await ops.subscribe(skuId, payWith, owner);
    if (payWith === 'woc') {
      if (typeof result.paymentId !== 'string' || typeof result.paymentTransaction !== 'string') {
        throw new Error('malformed subscribe answer');
      }
      host.setOp(opSigning(host.getOp(), seq));
      host.paintPanel();
      const signature = await ops.signAndSend(result.paymentTransaction);
      host.setOp(opConfirming(host.getOp(), seq));
      host.paintPanel();
      await ops.confirmSubscribe(result.paymentId, signature);
    }
    host.setOp(opDone(host.getOp(), seq));
    host.setNotice('subscribed');
    await host.refreshStatus();
  } catch (err) {
    applyOpFailure(host, seq, err);
  }
}

/**
 * Fund the vault. The typed amounts are validated client-side against the
 * SKU's exact bigint bounds (a UX gate; the service re-validates), then
 * deposit -> wallet sign -> confirm, ending in a balance refresh.
 */
export async function depositFlow(
  host: TradingBotsFlowHost,
  ops: TradingBotsFlowOps,
  sku: TradingBotSku,
  config: TradingBotsConfig,
  solText: string,
  wocText: string,
): Promise<void> {
  if (refused(host)) return;
  const validated = validateDeposit(sku, config, solText, wocText);
  if (!validated.ok) {
    host.onFieldInvalid();
    return;
  }
  const owner = host.walletAddress();
  if (!owner) {
    refuseNoWallet(host, 'deposit');
    return;
  }
  host.setNotice(null);
  host.setOp(beginOp(host.getOp(), 'deposit'));
  const seq = host.getOp().seq;
  host.paintPanel();
  try {
    const { depositId, depositTransaction } = await ops.deposit(
      validated.solBaseUnits,
      validated.wocBaseUnits,
      owner,
    );
    host.setOp(opSigning(host.getOp(), seq));
    host.paintPanel();
    const signature = await ops.signAndSend(depositTransaction);
    host.setOp(opConfirming(host.getOp(), seq));
    host.paintPanel();
    await ops.confirmDeposit(depositId, signature);
    host.setOp(opDone(host.getOp(), seq));
    host.onFundsMoved();
    await host.refreshStatus();
  } catch (err) {
    applyOpFailure(host, seq, err);
  }
}

/**
 * Withdraw the vault. Supports both custody shapes in the PRD contract: an
 * unsigned owner transaction to sign, or a service-signed payout (no
 * transaction in the answer). Either way the bot pauses service-side, the
 * 'withdrawPending' notice shows, and balances refresh.
 */
export async function withdrawFlow(
  host: TradingBotsFlowHost,
  ops: TradingBotsFlowOps,
): Promise<void> {
  if (refused(host)) return;
  const owner = host.walletAddress();
  if (!owner) {
    refuseNoWallet(host, 'withdraw');
    return;
  }
  host.setNotice(null);
  host.setOp(beginOp(host.getOp(), 'withdraw'));
  const seq = host.getOp().seq;
  host.paintPanel();
  try {
    const result = await ops.withdraw(owner);
    if (typeof result.withdrawTransaction === 'string') {
      host.setOp(opSigning(host.getOp(), seq));
      host.paintPanel();
      await ops.signAndSend(result.withdrawTransaction);
    }
    host.setOp(opDone(host.getOp(), seq));
    host.setNotice('withdrawPending');
    host.onFundsMoved();
    await host.refreshStatus();
  } catch (err) {
    applyOpFailure(host, seq, err);
  }
}

/** Start/pause the bot or save its strategy params: one service call. */
export async function controlFlow(
  host: TradingBotsFlowHost,
  ops: TradingBotsFlowOps,
  action: 'start' | 'pause' | 'update_params',
  params?: Record<string, number>,
): Promise<void> {
  if (refused(host)) return;
  host.setNotice(null);
  host.setOp(beginOp(host.getOp(), 'control'));
  const seq = host.getOp().seq;
  host.paintPanel();
  try {
    await ops.control(action, params);
    host.setOp(opDone(host.getOp(), seq));
    await host.refreshStatus();
  } catch (err) {
    applyOpFailure(host, seq, err);
  }
}

/**
 * Map a thrown flow failure onto the op state: a coded rate limit becomes the
 * cooldown, the typed wallet-feature error and coded API errors keep their
 * tags, anything else is a sign/send decline. Stale seqs no-op inside the
 * state transitions themselves.
 */
export function applyOpFailure(host: TradingBotsFlowHost, seq: number, err: unknown): void {
  host.setLastApiError(err);
  const retryAfterMs = rateLimitRetryMs(err);
  if (retryAfterMs !== null) {
    host.setOp(opRateLimited(host.getOp(), seq, retryAfterMs, host.now()));
  } else {
    const tag = host.isWalletFeatureUnsupported(err)
      ? ERR_WALLET_FEATURE
      : isCodedError(err)
        ? ERR_API
        : ERR_SIGN_FAILED;
    host.setOp(opFailed(host.getOp(), seq, tag));
  }
  host.paintPanel();
}

/** True for a thrown value carrying a non-empty stable `code` string. */
export function isCodedError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as { code?: unknown }).code === 'string' &&
    (err as { code: string }).code.length > 0
  );
}

/** retryAfterMs for a coded trading_bots.rate_limited failure, else null. */
export function rateLimitRetryMs(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const coded = err as { code?: unknown; params?: { retryAfterMs?: unknown } };
  if (coded.code !== 'trading_bots.rate_limited') return null;
  const ms = coded.params?.retryAfterMs;
  return typeof ms === 'number' && ms > 0 ? ms : 60_000;
}
