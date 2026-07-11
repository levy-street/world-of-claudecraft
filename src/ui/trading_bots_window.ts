// Thin DOM window for the Trading Bots flow (rent -> fund -> run -> withdraw).
//
// The consumer half of the pure-core + thin-consumer split, now with TWO pure
// cores: trading_bots_view owns the screen derivation, the seq-guarded op
// state machine, the exact deposit-bounds math, and the cooldown;
// trading_bots_flows_core owns the async flow orchestration (rent WOC or
// Claudium, fund, withdraw, control), driven through the TradingBotsFlowHost
// this window implements. This module only paints #tradingbots-window, reads
// its form fields, wires clicks, and localizes every state through t(). It
// owns no policy: the service owns the catalog, pricing, custody, and
// validation; the wallet signs and sends; SKUs without client strings are
// hidden.
//
// All HTML interpolation goes through esc(); focus is captured/restored via
// the Hud windowFocus pair (the shared FocusManager trap); Esc stays with the
// hud.closeAll dispatcher (closeManagedWindow routes here).

import { userFacingApiError } from './api_error_i18n';
import { formatBaseUnits } from './dex_swap_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatDateTime, formatNumber, type TranslationKey, t } from './i18n';
import {
  ERR_API,
  ERR_NO_WALLET,
  ERR_WALLET_FEATURE,
  controlFlow as runControlFlow,
  depositFlow as runDepositFlow,
  rentFlow as runRentFlow,
  withdrawFlow as runWithdrawFlow,
  type TradingBotsFlowHost,
  type TradingBotsNoticeTag,
  type TradingBotsSubscribeResult,
  type TradingBotsWithdrawResult,
} from './trading_bots_flows_core';
import {
  clearElapsedCooldown,
  cooldownRemainingSeconds,
  createTradingBotsOpState,
  depositBoundsText,
  ERR_RATE_LIMITED,
  effectiveParams,
  isCoolingDown,
  isRentalExpired,
  mintDecimals,
  rentalDaysLeft,
  resetOp,
  screenForStatus,
  signedPercentText,
  signedWocText,
  skuForId,
  type TradingBotSku,
  type TradingBotsConfig,
  type TradingBotsOpState,
  type TradingBotsStatus,
  visibleSkus,
} from './trading_bots_view';
import { svgIcon } from './ui_icons';

// The wire result shapes live in the flows core; re-exported so the hud and
// the net glue keep one import site.
export type { TradingBotsSubscribeResult, TradingBotsWithdrawResult };

/** Success-notice tag -> the localized line the panel shows. */
const NOTICE_KEYS: Record<TradingBotsNoticeTag, TranslationKey> = {
  subscribed: 'hudChrome.tradingBots.subscribedBody',
  withdrawPending: 'hudChrome.tradingBots.withdrawPending',
};

export interface TradingBotsWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  /** The /api/tradingbots/config payload, or null while unknown/disabled. */
  config(): TradingBotsConfig | null;
  /** The connected/linked wallet address money ops bind to, or null. */
  walletAddress(): string | null;
  /** GET /api/tradingbots/status: the aggregate the window paints from. */
  fetchStatus(): Promise<TradingBotsStatus>;
  /** POST /api/tradingbots/subscribe. */
  subscribe(
    skuId: string,
    payWith: 'woc' | 'claudium',
    userPublicKey: string | null,
  ): Promise<TradingBotsSubscribeResult>;
  /** POST /api/tradingbots/subscribe/confirm. */
  confirmSubscribe(paymentId: string, signature: string): Promise<unknown>;
  /** POST /api/tradingbots/deposit: resolves the unsigned deposit tx. */
  deposit(
    solAmount: string,
    wocAmount: string,
    userPublicKey: string,
  ): Promise<{ depositId: string; depositTransaction: string }>;
  /** POST /api/tradingbots/deposit/confirm. */
  confirmDeposit(depositId: string, signature: string): Promise<unknown>;
  /** POST /api/tradingbots/withdraw. */
  withdraw(userPublicKey: string): Promise<TradingBotsWithdrawResult>;
  /** POST /api/tradingbots/control. */
  control(
    action: 'start' | 'pause' | 'update_params',
    params?: Record<string, number>,
  ): Promise<unknown>;
  /** Wallet Standard signAndSendTransaction; resolves the base58 signature. */
  signAndSend(txBase64: string): Promise<string>;
  /** True for the typed missing-wallet-feature error (localized separately). */
  isWalletFeatureUnsupported(err: unknown): boolean;
  /** Called after funds moved (deposit/withdraw sent) so balances refresh. */
  onFundsMoved(): void;
  /** Injected clock (cooldowns, rental countdown); the core never reads time. */
  now(): number;
}

/** The localized name/blurb keys for a known SKU id (hidden otherwise). */
const SKU_TEXT: Record<string, { name: TranslationKey; blurb: TranslationKey }> = {
  grid: { name: 'hudChrome.tradingBots.skuGridName', blurb: 'hudChrome.tradingBots.skuGridBlurb' },
  dca: { name: 'hudChrome.tradingBots.skuDcaName', blurb: 'hudChrome.tradingBots.skuDcaBlurb' },
  momentum: {
    name: 'hudChrome.tradingBots.skuMomentumName',
    blurb: 'hudChrome.tradingBots.skuMomentumBlurb',
  },
};

/** The localized label key for a known strategy-param key (raw id otherwise). */
const PARAM_TEXT: Record<string, TranslationKey> = {
  gridSpacingBps: 'hudChrome.tradingBots.paramGridSpacingBps',
  orderSizeBps: 'hudChrome.tradingBots.paramOrderSizeBps',
  dcaIntervalMinutes: 'hudChrome.tradingBots.paramDcaIntervalMinutes',
  momentumLookbackMinutes: 'hudChrome.tradingBots.paramMomentumLookbackMinutes',
};

export class TradingBotsWindow {
  private status: TradingBotsStatus | null = null;
  private op: TradingBotsOpState = createTradingBotsOpState();
  private openerFocus: HTMLElement | null = null;
  private lastApiError: unknown = null;
  private notice: string | null = null;
  private cooldownTimer: number | null = null;

  // The window-side surface the pure flow core drives (trading_bots_flows_core):
  // op state get/set, localized notices by tag, paint signals, and the status
  // re-read. The core owns the orchestration; this window only paints.
  private readonly flowHost: TradingBotsFlowHost = {
    getOp: () => this.op,
    setOp: (op) => {
      this.op = op;
    },
    setNotice: (tag) => {
      this.notice = tag === null ? null : t(NOTICE_KEYS[tag]);
    },
    setLastApiError: (err) => {
      this.lastApiError = err;
    },
    paintPanel: () => this.paintPanel(),
    onFieldInvalid: () => this.paintFieldError(t('hudChrome.tradingBots.amountInvalid')),
    refreshStatus: () => this.refreshStatus(),
    walletAddress: () => this.deps.walletAddress(),
    isWalletFeatureUnsupported: (err) => this.deps.isWalletFeatureUnsupported(err),
    onFundsMoved: () => this.deps.onFundsMoved(),
    now: () => this.deps.now(),
  };

  constructor(private readonly deps: TradingBotsWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    const config = this.deps.config();
    if (!config || !config.enabled || visibleSkus(config).length === 0) return;
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.op = resetOp(this.op);
    this.status = null;
    this.notice = null;
    this.lastApiError = null;
    const root = this.deps.root();
    root.style.display = 'block';
    this.buildShell();
    this.paintBody();
    this.deps.onVisibilityChange?.();
    void this.refreshStatus();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    this.clearCooldownTimer();
    root.style.display = 'none';
    this.op = resetOp(this.op);
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  // -------------------------------------------------------------------------
  // Shell: title bar + the standing custody/risk disclosures + the body slot.
  // -------------------------------------------------------------------------

  private buildShell(): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'tradingbots-title' });
    root.innerHTML =
      `<div class="panel-title"><span id="tradingbots-title">${esc(t('hudChrome.tradingBots.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.tradingBots.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="tradingbots-body">` +
      `<p class="tradingbots-note">${esc(t('hudChrome.tradingBots.custody'))}</p>` +
      `<p class="tradingbots-note tradingbots-risk">${esc(t('hudChrome.tradingBots.riskNote'))}</p>` +
      `<div class="tradingbots-screen" data-tb-body></div>` +
      `<div class="tradingbots-panel" data-tb-panel></div>` +
      `</div>`;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  private body(): HTMLElement | null {
    return this.deps.root().querySelector<HTMLElement>('[data-tb-body]');
  }

  private panel(): HTMLElement | null {
    return this.deps.root().querySelector<HTMLElement>('[data-tb-panel]');
  }

  /** Re-read the status aggregate and repaint the whole body. */
  private async refreshStatus(): Promise<void> {
    const body = this.body();
    if (body && this.status === null) {
      body.innerHTML = `<div class="tradingbots-status" role="status">${esc(t('hudChrome.tradingBots.loading'))}</div>`;
    }
    try {
      this.status = await this.deps.fetchStatus();
    } catch (err) {
      // A failed read keeps the last known status; the catalog still renders.
      this.lastApiError = err;
      this.notice = userFacingApiError(err);
    }
    if (this.isOpen) {
      this.paintBody();
      this.paintPanel();
    }
  }

  // -------------------------------------------------------------------------
  // Body paint: one of the three primary screens.
  // -------------------------------------------------------------------------

  private paintBody(): void {
    const body = this.body();
    const config = this.deps.config();
    if (!body || !config) return;
    switch (screenForStatus(this.status)) {
      case 'catalog':
        this.paintCatalog(body, config);
        return;
      case 'fund':
        this.paintFund(body, config);
        return;
      case 'dashboard':
        this.paintDashboard(body, config);
        return;
    }
  }

  private payWithOptionsHtml(config: TradingBotsConfig): string {
    const claudium = config.claudiumEnabled
      ? `<option value="claudium">${esc(t('hudChrome.tradingBots.payClaudium'))}</option>`
      : '';
    return `<option value="woc">${esc(t('hudChrome.tradingBots.payWoc'))}</option>${claudium}`;
  }

  private paintCatalog(body: HTMLElement, config: TradingBotsConfig): void {
    const cards = visibleSkus(config)
      .map((sku) => {
        const text = SKU_TEXT[sku.id];
        const priceWoc = formatBaseUnits(sku.priceWocBaseUnits, config.wocDecimals, this.groupInt);
        const claudiumLine = config.claudiumEnabled
          ? `<div class="tradingbots-line">${esc(
              t('hudChrome.tradingBots.priceClaudium', {
                amount: formatNumber(sku.priceClaudium, { maximumFractionDigits: 0 }),
              }),
            )}</div>`
          : '';
        return (
          `<div class="tradingbots-card">` +
          `<div class="tradingbots-card-name">${esc(t(text.name))}</div>` +
          `<div class="tradingbots-card-blurb">${esc(t(text.blurb))}</div>` +
          `<div class="tradingbots-line">${esc(t('hudChrome.tradingBots.priceWoc', { amount: priceWoc ?? sku.priceWocBaseUnits }))}</div>` +
          claudiumLine +
          `<button type="button" class="btn tradingbots-rent-btn" data-tb-rent="${esc(sku.id)}">${esc(t('hudChrome.tradingBots.rentButton'))}</button>` +
          `</div>`
        );
      })
      .join('');
    body.innerHTML =
      `<p class="tradingbots-intro">${esc(t('hudChrome.tradingBots.catalogIntro'))}</p>` +
      `<div class="tradingbots-payrow"><label for="tradingbots-paywith">${esc(t('hudChrome.tradingBots.payWithLabel'))}</label>` +
      `<select id="tradingbots-paywith" data-tb-paywith>${this.payWithOptionsHtml(config)}</select>` +
      this.claudiumBalanceHtml() +
      `</div>` +
      `<div class="tradingbots-cards">${cards}</div>`;
    for (const btn of body.querySelectorAll<HTMLButtonElement>('[data-tb-rent]')) {
      btn.addEventListener('click', () => {
        void this.rent(btn.dataset.tbRent ?? '');
      });
    }
  }

  private claudiumBalanceHtml(): string {
    if (!this.status || !this.deps.config()?.claudiumEnabled) return '';
    return `<span class="tradingbots-claudium">${esc(
      t('hudChrome.tradingBots.claudiumBalance', {
        amount: formatNumber(this.status.claudiumBalance, { maximumFractionDigits: 0 }),
      }),
    )}</span>`;
  }

  private paintFund(body: HTMLElement, config: TradingBotsConfig): void {
    const sku = this.rentedSku(config);
    if (!sku) return;
    const solBounds = depositBoundsText(
      sku.minDepositSol,
      sku.maxDepositSol,
      config.solDecimals,
      this.groupInt,
    );
    const wocBounds = depositBoundsText(
      sku.minDepositWoc,
      sku.maxDepositWoc,
      config.wocDecimals,
      this.groupInt,
    );
    const boundsLine = (bounds: { min: string; max: string } | null): string =>
      bounds
        ? `<div class="tradingbots-bounds">${esc(t('hudChrome.tradingBots.depositBounds', bounds))}</div>`
        : '';
    body.innerHTML =
      `<div class="tradingbots-subtitle">${esc(t('hudChrome.tradingBots.fundTitle'))}</div>` +
      this.rentalLineHtml() +
      `<div class="tradingbots-form">` +
      `<label for="tradingbots-sol">${esc(t('hudChrome.tradingBots.solAmountLabel'))}</label>` +
      `<input id="tradingbots-sol" data-tb-sol type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0">` +
      boundsLine(solBounds) +
      `<label for="tradingbots-woc">${esc(t('hudChrome.tradingBots.wocAmountLabel'))}</label>` +
      `<input id="tradingbots-woc" data-tb-woc type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0">` +
      boundsLine(wocBounds) +
      `<button type="button" class="btn tradingbots-deposit-btn" data-tb-deposit>${esc(t('hudChrome.tradingBots.depositButton'))}</button>` +
      `</div>`;
    body.querySelector('[data-tb-deposit]')?.addEventListener('click', () => {
      void this.depositFlow();
    });
    (body.querySelector('[data-tb-sol]') as HTMLElement | null)?.focus();
  }

  private paintDashboard(body: HTMLElement, config: TradingBotsConfig): void {
    const status = this.status;
    const sku = this.rentedSku(config);
    if (!status || !sku) return;
    const vault = status.vault;
    const vaultLine = vault
      ? `<div class="tradingbots-line tradingbots-vault">${esc(
          t('hudChrome.tradingBots.vaultLine', {
            sol: formatBaseUnits(vault.sol, config.solDecimals, this.groupInt) ?? vault.sol,
            woc: formatBaseUnits(vault.woc, config.wocDecimals, this.groupInt) ?? vault.woc,
          }),
        )}</div>`
      : '';
    const running = status.bot?.state === 'running';
    const stateLine =
      `<div class="tradingbots-line">${esc(t(running ? 'hudChrome.tradingBots.stateRunning' : 'hudChrome.tradingBots.statePaused'))} ` +
      `<button type="button" class="btn tradingbots-run-btn" data-tb-run="${running ? 'pause' : 'start'}">${esc(
        t(running ? 'hudChrome.tradingBots.pauseButton' : 'hudChrome.tradingBots.startButton'),
      )}</button></div>`;
    const params = effectiveParams(sku, status.bot);
    const paramRows = sku.params
      .map((spec) => {
        const key = PARAM_TEXT[spec.key];
        const label = key
          ? spec.key.endsWith('Bps')
            ? t(key, {
                percent: formatNumber(params[spec.key] / 100, { maximumFractionDigits: 2 }),
              })
            : t(key)
          : spec.key;
        // Number() coercion on the spec fields: they arrive from the service
        // config relayed verbatim, so a non-numeric value must never reach an
        // attribute position as markup (a number, NaN included, is inert).
        return (
          `<label class="tradingbots-param"><span>${esc(label)}</span>` +
          `<input type="number" data-tb-param="${esc(spec.key)}" min="${Number(spec.min)}" max="${Number(spec.max)}" step="${Number(spec.step)}" value="${Number(params[spec.key])}">` +
          `</label>`
        );
      })
      .join('');
    const pnl = status.pnl;
    const pnlAmount = pnl
      ? signedWocText(pnl.wocBaseUnits, config.wocDecimals, this.groupInt)
      : null;
    const pnlPercent = pnl ? signedPercentText(pnl.bps) : null;
    const pnlLine =
      pnl && pnlAmount !== null && pnlPercent !== null
        ? `<div class="tradingbots-line tradingbots-pnl${pnl.bps < 0 ? ' tradingbots-loss' : ''}">${esc(
            t('hudChrome.tradingBots.pnlLine', {
              days: formatNumber(pnl.periodDays, { maximumFractionDigits: 0 }),
              amount: pnlAmount,
              percent: pnlPercent,
            }),
          )}</div>`
        : '';
    const trades = status.trades
      .slice(0, 5)
      .map((trade) => {
        const buy = trade.side === 'buy';
        const inDecimals = mintDecimals(config, trade.inMint);
        const outDecimals = mintDecimals(config, trade.outMint);
        const inText = formatBaseUnits(trade.inAmount, inDecimals, this.groupInt) ?? trade.inAmount;
        const outText =
          formatBaseUnits(trade.outAmount, outDecimals, this.groupInt) ?? trade.outAmount;
        return (
          `<li class="tradingbots-trade">` +
          `<span class="tradingbots-trade-side">${esc(t(buy ? 'hudChrome.tradingBots.tradeBuy' : 'hudChrome.tradingBots.tradeSell'))}</span> ` +
          `<span>${esc(`${inText} -> ${outText}`)}</span> ` +
          `<span class="tradingbots-trade-time">${esc(formatDateTime(new Date(trade.tsMs)))}</span>` +
          `</li>`
        );
      })
      .join('');
    const tradesHtml =
      `<div class="tradingbots-subtitle">${esc(t('hudChrome.tradingBots.recentTrades'))}</div>` +
      (trades
        ? `<ul class="tradingbots-trades">${trades}</ul>`
        : `<div class="tradingbots-line">${esc(t('hudChrome.tradingBots.noTrades'))}</div>`);
    body.innerHTML =
      this.rentalLineHtml() +
      vaultLine +
      stateLine +
      pnlLine +
      `<div class="tradingbots-subtitle">${esc(t('hudChrome.tradingBots.paramsTitle'))}</div>` +
      `<div class="tradingbots-params">${paramRows}` +
      `<button type="button" class="btn" data-tb-save>${esc(t('hudChrome.tradingBots.saveParams'))}</button></div>` +
      tradesHtml +
      `<button type="button" class="btn tradingbots-withdraw-btn" data-tb-withdraw>${esc(t('hudChrome.tradingBots.withdrawButton'))}</button>`;
    body.querySelector('[data-tb-run]')?.addEventListener('click', (e) => {
      const action = (e.currentTarget as HTMLElement).dataset.tbRun === 'pause' ? 'pause' : 'start';
      void this.controlFlow(action);
    });
    body.querySelector('[data-tb-save]')?.addEventListener('click', () => {
      const values: Record<string, number> = {};
      for (const input of body.querySelectorAll<HTMLInputElement>('[data-tb-param]')) {
        values[input.dataset.tbParam ?? ''] = Number(input.value);
      }
      void this.controlFlow('update_params', values);
    });
    body.querySelector('[data-tb-withdraw]')?.addEventListener('click', () => {
      void this.withdrawFlow();
    });
  }

  private rentedSku(config: TradingBotsConfig): TradingBotSku | null {
    const skuId = this.status?.subscription?.skuId;
    return skuId ? skuForId(config, skuId) : null;
  }

  private rentalLineHtml(): string {
    const subscription = this.status?.subscription;
    if (!subscription) return '';
    const expired = isRentalExpired(subscription, this.deps.now());
    const dateText = formatDateTime(new Date(subscription.activeUntilMs));
    const days = rentalDaysLeft(subscription, this.deps.now());
    return `<div class="tradingbots-line tradingbots-rental${expired ? ' tradingbots-expired' : ''}">${esc(
      t('hudChrome.tradingBots.activeUntil', {
        date: `${dateText} (${formatNumber(days, { maximumFractionDigits: 0 })}d)`,
      }),
    )}</div>`;
  }

  // -------------------------------------------------------------------------
  // Flows. Each is one seq-guarded op; money legs go unsigned-tx -> wallet ->
  // confirm; a completed op re-reads the status aggregate.
  // -------------------------------------------------------------------------

  private selectedPayWith(): 'woc' | 'claudium' {
    const select = this.deps.root().querySelector<HTMLSelectElement>('[data-tb-paywith]');
    return select?.value === 'claudium' ? 'claudium' : 'woc';
  }

  // Each flow: read the form fields this window owns, then hand the pure core
  // the orchestration (trading_bots_flows_core owns the seq guards, the
  // wallet-sign legs, and the error mapping; this.deps satisfies its ops
  // surface structurally).

  private async rent(skuId: string): Promise<void> {
    await runRentFlow(this.flowHost, this.deps, skuId, this.selectedPayWith());
  }

  private async depositFlow(): Promise<void> {
    const config = this.deps.config();
    const sku = config ? this.rentedSku(config) : null;
    if (!config || !sku) return;
    const root = this.deps.root();
    const solText = root.querySelector<HTMLInputElement>('[data-tb-sol]')?.value ?? '';
    const wocText = root.querySelector<HTMLInputElement>('[data-tb-woc]')?.value ?? '';
    await runDepositFlow(this.flowHost, this.deps, sku, config, solText, wocText);
  }

  private async withdrawFlow(): Promise<void> {
    await runWithdrawFlow(this.flowHost, this.deps);
  }

  private async controlFlow(
    action: 'start' | 'pause' | 'update_params',
    params?: Record<string, number>,
  ): Promise<void> {
    await runControlFlow(this.flowHost, this.deps, action, params);
  }

  // -------------------------------------------------------------------------
  // Panel paint: the op status/error strip under the current screen.
  // -------------------------------------------------------------------------

  private paintFieldError(message: string): void {
    const panel = this.panel();
    if (!panel) return;
    panel.innerHTML = `<div class="tradingbots-error" role="alert">${esc(message)}</div>`;
  }

  private opStatusText(): string | null {
    if (this.op.phase === 'requesting') return t('hudChrome.tradingBots.loading');
    if (this.op.phase === 'signing') {
      switch (this.op.kind) {
        case 'subscribe':
          return t('hudChrome.tradingBots.approvePayment');
        case 'withdraw':
          return t('hudChrome.tradingBots.approveWithdraw');
        default:
          return t('hudChrome.tradingBots.approveDeposit');
      }
    }
    if (this.op.phase === 'confirming') {
      return this.op.kind === 'subscribe'
        ? t('hudChrome.tradingBots.confirmingPayment')
        : t('hudChrome.tradingBots.confirmingDeposit');
    }
    return null;
  }

  private errorMessage(): string {
    switch (this.op.errorCode) {
      case ERR_RATE_LIMITED:
        return userFacingApiError(this.lastApiError);
      case ERR_WALLET_FEATURE:
        return t('hudChrome.tradingBots.errWalletFeature');
      case ERR_NO_WALLET:
        return t('hudChrome.tradingBots.errNoWallet');
      case ERR_API:
        return userFacingApiError(this.lastApiError);
      default:
        return t('hudChrome.tradingBots.errSignFailed');
    }
  }

  // Localized grouping for the integer digits of an exact amount. Digit counts
  // beyond Number safety are left ungrouped (still exact) rather than rounded.
  private groupInt = (digits: string): string =>
    digits.length <= 15 ? formatNumber(Number(digits), { maximumFractionDigits: 0 }) : digits;

  private paintPanel(): void {
    const panel = this.panel();
    if (!panel) return;
    this.clearCooldownTimer();
    const noticeHtml = this.notice
      ? `<div class="tradingbots-notice" role="status">${esc(this.notice)}</div>`
      : '';
    const statusText = this.opStatusText();
    if (statusText !== null) {
      panel.innerHTML = `<div class="tradingbots-status" role="status">${esc(statusText)}</div>`;
      return;
    }
    if (this.op.phase === 'error') {
      if (this.op.errorCode === ERR_RATE_LIMITED && isCoolingDown(this.op, this.deps.now())) {
        this.paintCooldown();
        return;
      }
      panel.innerHTML = `<div class="tradingbots-error" role="alert">${esc(this.errorMessage())}</div>`;
      return;
    }
    panel.innerHTML = noticeHtml;
  }

  // Rate-limit cooldown: a localized countdown that keeps op buttons refused
  // until retryAfterMs elapses, then re-enables by clearing the elapsed state.
  private paintCooldown(): void {
    const panel = this.panel();
    if (!panel) return;
    const seconds = cooldownRemainingSeconds(this.op, this.deps.now());
    panel.innerHTML =
      `<div class="tradingbots-error tradingbots-cooldown" role="alert" data-tb-cooldown>` +
      `${esc(t('hudChrome.tradingBots.cooldown', { seconds: formatNumber(seconds, { maximumFractionDigits: 0 }) }))}</div>`;
    this.armCooldownTimer();
  }

  private armCooldownTimer(): void {
    this.clearCooldownTimer();
    this.cooldownTimer = window.setInterval(() => {
      if (!this.isOpen || this.op.errorCode !== ERR_RATE_LIMITED) {
        this.clearCooldownTimer();
        return;
      }
      const nowMs = this.deps.now();
      if (isCoolingDown(this.op, nowMs)) {
        const hint = this.panel()?.querySelector<HTMLElement>('[data-tb-cooldown]');
        if (hint) {
          const seconds = cooldownRemainingSeconds(this.op, nowMs);
          hint.textContent = t('hudChrome.tradingBots.cooldown', {
            seconds: formatNumber(seconds, { maximumFractionDigits: 0 }),
          });
        }
        return;
      }
      // Cooldown elapsed: back to idle, actions re-enabled.
      this.op = clearElapsedCooldown(this.op, nowMs);
      this.paintPanel();
    }, 1000);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer !== null) {
      window.clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }
}
