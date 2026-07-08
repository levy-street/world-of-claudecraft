// Thin DOM window for the in-game "Buy $WOC" DEX swap flow.
//
// The consumer half of the pure-core + thin-consumer split: dex_swap_view.ts
// owns the state machine, exact display math, and quote staleness; this module
// paints #dexswap-window, wires the quote -> swap -> signAndSend flow through
// injected deps, and localizes every state through t(). It owns no policy: the
// server pins the output mint, the wallet signs and sends, and a stale quote
// is auto re-quoted (beginSign refuses it) rather than ever signed.
//
// All HTML interpolation goes through esc(); focus is captured/restored via the
// Hud windowFocus pair (the shared FocusManager trap); Esc stays with the
// hud.closeAll dispatcher (closeManagedWindow routes here).

import { userFacingApiError } from './api_error_i18n';
import {
  beginQuote,
  beginSign,
  buildQuoteModel,
  canSign,
  clearElapsedCooldown,
  cooldownRemainingSeconds,
  createDebouncer,
  createDexSwapState,
  type Debouncer,
  type DexSwapConfig,
  type DexSwapInputToken,
  type DexSwapQuote,
  type DexSwapState,
  ERR_RATE_LIMITED,
  effectiveSlippageBps,
  feePercentText,
  isCoolingDown,
  parseAmountToBaseUnits,
  quoteFailed,
  quoteReceived,
  REQUOTE_DEBOUNCE_MS,
  rateLimited,
  resetDexSwap,
  signFailed,
  signSent,
} from './dex_swap_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

// Solana Explorer transaction URL (mainnet). A plain https link opened with
// rel=noopener so the explorer tab can never script back into the game.
const EXPLORER_TX_BASE = 'https://explorer.solana.com/tx/';

// Coarse error tags the pure state machine carries; the paint maps each to a
// localized message (the original thrown value is kept painter-side for the
// code-first API localizer).
const ERR_API = 'api';
const ERR_WALLET_FEATURE = 'wallet_feature';
const ERR_SIGN_FAILED = 'sign_failed';
const ERR_NO_WALLET = 'no_wallet';

export interface DexSwapWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  /** The /api/dexswap/config payload, or null while unknown/disabled. */
  config(): DexSwapConfig | null;
  /** The connected/linked wallet address the swap binds to, or null. */
  walletAddress(): string | null;
  /**
   * GET /api/dexswap/quote; resolves the quote plus the platform fee (bps) it
   * was built with; rejects with a coded error the localizer maps.
   */
  fetchQuote(
    inputMint: string,
    amount: string,
    slippageBps: number,
  ): Promise<{ quote: DexSwapQuote; feeBps: number }>;
  /** POST /api/dexswap/swap; resolves the base64 swap transaction. */
  buildSwap(quote: DexSwapQuote, userPublicKey: string): Promise<string>;
  /** Wallet Standard signAndSendTransaction; resolves the base58 signature. */
  signAndSend(txBase64: string): Promise<string>;
  /** True for the typed missing-wallet-feature error (localized separately). */
  isWalletFeatureUnsupported(err: unknown): boolean;
  /** Called once after a swap is sent so the bag balance + flair refresh. */
  onSwapSent(): void;
  /** Injected clock (quote staleness); the pure core never reads time. */
  now(): number;
}

export class DexSwapWindow {
  private state: DexSwapState = createDexSwapState();
  private openerFocus: HTMLElement | null = null;
  private selectedMint: string | null = null;
  private lastApiError: unknown = null;
  private notice: string | null = null;
  private staleTimer: number | null = null;
  private cooldownTimer: number | null = null;
  // Typing in the amount field re-quotes at most once per quiet period, so a
  // fast typist never burns the per-player quote budget.
  private readonly requoteDebounce: Debouncer = createDebouncer(REQUOTE_DEBOUNCE_MS);

  constructor(private readonly deps: DexSwapWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    const config = this.deps.config();
    if (!config || !config.enabled || config.inputs.length === 0) return;
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    this.state = resetDexSwap(this.state);
    this.notice = null;
    this.lastApiError = null;
    if (this.selectedMint === null) this.selectedMint = config.inputs[0].mint;
    const root = this.deps.root();
    root.style.display = 'block';
    this.buildShell(config);
    this.paint();
    this.deps.onVisibilityChange?.();
    (root.querySelector('[data-dexswap-amount]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    this.clearStaleTimer();
    this.clearCooldownTimer();
    this.requoteDebounce.cancel();
    root.style.display = 'none';
    this.state = resetDexSwap(this.state);
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  // -------------------------------------------------------------------------
  // Shell: built once per open (the amount input must keep its focus/value
  // across paints, so only the dynamic panel below the form is repainted).
  // -------------------------------------------------------------------------

  private buildShell(config: DexSwapConfig): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'dexswap-title' });
    const slippagePercent = formatNumber(effectiveSlippageBps(config.maxSlippageBps) / 100, {
      maximumFractionDigits: 2,
    });
    const options = config.inputs
      .map(
        (input) =>
          `<option value="${esc(input.mint)}"${input.mint === this.selectedMint ? ' selected' : ''}>${esc(input.symbol)}</option>`,
      )
      .join('');
    root.innerHTML =
      `<div class="panel-title"><span id="dexswap-title">${esc(t('hudChrome.dexSwap.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.dexSwap.close'))}">${svgIcon('close')}</button></div>` +
      `<div class="dexswap-body">` +
      `<p class="dexswap-note">${esc(t('hudChrome.dexSwap.nonCustodial'))}</p>` +
      `<div class="dexswap-form">` +
      `<label class="dexswap-amount-label" for="dexswap-amount">${esc(t('hudChrome.dexSwap.amountLabel'))}</label>` +
      `<div class="dexswap-input-row">` +
      `<input id="dexswap-amount" data-dexswap-amount type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.0">` +
      `<select data-dexswap-token aria-label="${esc(t('hudChrome.dexSwap.tokenAria'))}">${options}</select>` +
      `</div>` +
      `<div class="dexswap-slippage">${esc(t('hudChrome.dexSwap.slippage', { percent: slippagePercent }))}</div>` +
      `<button type="button" class="btn dexswap-quote-btn" data-dexswap-quote>${esc(t('hudChrome.dexSwap.quoteButton'))}</button>` +
      `</div>` +
      `<div class="dexswap-panel" data-dexswap-panel></div>` +
      `</div>`;

    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelector('[data-dexswap-quote]')?.addEventListener('click', () => {
      void this.quote();
    });
    const amount = root.querySelector<HTMLInputElement>('[data-dexswap-amount]');
    amount?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void this.quote();
    });
    // Editing the amount while a quote is on screen re-quotes automatically,
    // debounced to the trailing edge so typing costs one request, not many.
    amount?.addEventListener('input', () => {
      this.requoteDebounce.touch(() => {
        if (!this.isOpen || this.state.phase !== 'quoted') return;
        void this.quote();
      });
    });
    root
      .querySelector<HTMLSelectElement>('[data-dexswap-token]')
      ?.addEventListener('change', (e) => {
        this.selectedMint = (e.target as HTMLSelectElement).value;
        // A held quote is for the previous token: drop it rather than mislabel it.
        this.state = resetDexSwap(this.state);
        this.notice = null;
        this.paint();
      });
  }

  private selectedToken(config: DexSwapConfig): DexSwapInputToken {
    return config.inputs.find((input) => input.mint === this.selectedMint) ?? config.inputs[0];
  }

  // -------------------------------------------------------------------------
  // Flow: quote -> (buy) swap build -> wallet signAndSend.
  // -------------------------------------------------------------------------

  private async quote(): Promise<void> {
    const config = this.deps.config();
    if (!config || this.state.phase === 'quoting' || this.state.phase === 'signing') return;
    if (isCoolingDown(this.state, this.deps.now())) return;
    const token = this.selectedToken(config);
    const input = this.deps.root().querySelector<HTMLInputElement>('[data-dexswap-amount]');
    const baseUnits = parseAmountToBaseUnits(input?.value ?? '', token.decimals);
    if (baseUnits === null) {
      this.notice = null;
      this.paintFieldError(t('hudChrome.dexSwap.amountInvalid'));
      return;
    }
    this.notice = null;
    this.state = beginQuote(this.state);
    const seq = this.state.seq;
    this.paint();
    try {
      const { quote, feeBps } = await this.deps.fetchQuote(
        token.mint,
        baseUnits,
        effectiveSlippageBps(config.maxSlippageBps),
      );
      this.state = quoteReceived(this.state, seq, quote, this.deps.now(), feeBps);
    } catch (err) {
      this.lastApiError = err;
      const retryAfterMs = this.rateLimitRetryMs(err);
      this.state =
        retryAfterMs !== null
          ? rateLimited(this.state, seq, retryAfterMs, this.deps.now())
          : quoteFailed(this.state, seq, ERR_API);
    }
    this.paint();
  }

  private async buy(): Promise<void> {
    if (isCoolingDown(this.state, this.deps.now())) return;
    const attempt = beginSign(this.state, this.deps.now());
    if (!attempt.ok) {
      // Stale quotes are never signed: transparently fetch a fresh one and ask
      // the player to confirm the new numbers.
      if (attempt.reason === 'stale') {
        this.notice = t('hudChrome.dexSwap.requoted');
        await this.quote();
      }
      return;
    }
    const owner = this.deps.walletAddress();
    if (!owner) {
      this.state = { ...this.state, phase: 'error', errorCode: ERR_NO_WALLET };
      this.paint();
      return;
    }
    this.state = attempt.state;
    const seq = this.state.seq;
    this.paint();
    try {
      const txBase64 = await this.deps.buildSwap(attempt.quote, owner);
      const signature = await this.deps.signAndSend(txBase64);
      this.state = signSent(this.state, seq, signature);
      this.paint();
      this.deps.onSwapSent();
    } catch (err) {
      this.lastApiError = err;
      const retryAfterMs = this.rateLimitRetryMs(err);
      if (retryAfterMs !== null) {
        this.state = rateLimited(this.state, seq, retryAfterMs, this.deps.now());
      } else {
        const tag = this.deps.isWalletFeatureUnsupported(err)
          ? ERR_WALLET_FEATURE
          : this.isCodedError(err)
            ? ERR_API
            : ERR_SIGN_FAILED;
        this.state = signFailed(this.state, seq, tag);
      }
      this.paint();
    }
  }

  private isCodedError(err: unknown): boolean {
    return (
      !!err &&
      typeof err === 'object' &&
      typeof (err as { code?: unknown }).code === 'string' &&
      (err as { code: string }).code.length > 0
    );
  }

  /** retryAfterMs for a coded dex_swap.rate_limited failure, else null. */
  private rateLimitRetryMs(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const coded = err as { code?: unknown; params?: { retryAfterMs?: unknown } };
    if (coded.code !== 'dex_swap.rate_limited') return null;
    const ms = coded.params?.retryAfterMs;
    return typeof ms === 'number' && ms > 0 ? ms : 60_000;
  }

  // -------------------------------------------------------------------------
  // Paint: the dynamic panel under the form. The shell (title, form, input)
  // persists so typing focus survives repaints.
  // -------------------------------------------------------------------------

  private panel(): HTMLElement | null {
    return this.deps.root().querySelector<HTMLElement>('[data-dexswap-panel]');
  }

  private paintFieldError(message: string): void {
    const panel = this.panel();
    if (!panel) return;
    panel.innerHTML = `<div class="dexswap-error" role="alert">${esc(message)}</div>`;
  }

  private errorMessage(): string {
    switch (this.state.errorCode) {
      case ERR_RATE_LIMITED:
        return userFacingApiError(this.lastApiError);
      case ERR_WALLET_FEATURE:
        return t('hudChrome.dexSwap.errWalletFeature');
      case ERR_NO_WALLET:
        return t('hudChrome.dexSwap.errNoWallet');
      case ERR_API:
        return userFacingApiError(this.lastApiError);
      default:
        return t('hudChrome.dexSwap.errSignFailed');
    }
  }

  // Localized grouping for the integer digits of an exact amount. Digit counts
  // beyond Number safety are left ungrouped (still exact) rather than rounded.
  private groupInt = (digits: string): string =>
    digits.length <= 15 ? formatNumber(Number(digits), { maximumFractionDigits: 0 }) : digits;

  private paint(): void {
    const panel = this.panel();
    const config = this.deps.config();
    if (!panel || !config) return;
    this.clearStaleTimer();
    this.clearCooldownTimer();
    const cooling = isCoolingDown(this.state, this.deps.now());
    const quoteBtn = this.deps.root().querySelector<HTMLButtonElement>('[data-dexswap-quote]');
    if (quoteBtn) {
      quoteBtn.disabled =
        this.state.phase === 'quoting' || this.state.phase === 'signing' || cooling;
    }

    const noticeHtml = this.notice
      ? `<div class="dexswap-notice" role="status">${esc(this.notice)}</div>`
      : '';

    switch (this.state.phase) {
      case 'idle':
        panel.innerHTML = noticeHtml;
        return;
      case 'quoting':
        panel.innerHTML = `${noticeHtml}<div class="dexswap-status" role="status">${esc(t('hudChrome.dexSwap.quoting'))}</div>`;
        return;
      case 'quoted': {
        const quote = this.state.quote;
        const model = quote ? buildQuoteModel(quote, config, this.groupInt) : null;
        if (!model) {
          panel.innerHTML = `<div class="dexswap-error" role="alert">${esc(t('hudChrome.dexSwap.errSignFailed'))}</div>`;
          return;
        }
        const impact =
          model.priceImpactPct !== null
            ? `<div class="dexswap-line">${esc(t('hudChrome.dexSwap.priceImpact', { percent: model.priceImpactPct }))}</div>`
            : '';
        // Fee disclosure BEFORE signing: the fee the quote was built with
        // (falling back to the config's), omitted entirely at zero fee.
        const feePercent = feePercentText(this.state.quoteFeeBps || (config.feeBps ?? 0));
        const feeLine =
          feePercent !== null
            ? `<div class="dexswap-line dexswap-fee">${esc(t('hudChrome.dexSwap.feeLine', { percent: feePercent }))}</div>`
            : '';
        panel.innerHTML =
          `${noticeHtml}<div class="dexswap-quote">` +
          `<div class="dexswap-line">${esc(t('hudChrome.dexSwap.payLine', { amount: model.payAmount, symbol: model.paySymbol }))}</div>` +
          `<div class="dexswap-line dexswap-receive">${esc(t('hudChrome.dexSwap.receiveLine', { amount: model.receiveAmount }))}</div>` +
          impact +
          `<div class="dexswap-line">${esc(t('hudChrome.dexSwap.minReceived', { amount: model.minReceived }))}</div>` +
          feeLine +
          `<button type="button" class="btn dexswap-buy-btn" data-dexswap-buy>${esc(t('hudChrome.dexSwap.buyButton'))}</button>` +
          `<div class="dexswap-stale" data-dexswap-stale hidden>${esc(t('hudChrome.dexSwap.quoteStale'))}</div>` +
          `</div>`;
        panel.querySelector('[data-dexswap-buy]')?.addEventListener('click', () => {
          void this.buy();
        });
        this.armStaleTimer();
        return;
      }
      case 'signing':
        panel.innerHTML = `<div class="dexswap-status" role="status">${esc(t('hudChrome.dexSwap.signing'))}</div>`;
        return;
      case 'sent': {
        const signature = this.state.signature ?? '';
        const shortSig =
          signature.length > 16 ? `${signature.slice(0, 8)}...${signature.slice(-8)}` : signature;
        panel.innerHTML =
          `<div class="dexswap-sent" role="status">` +
          `<div class="dexswap-sent-title">${esc(t('hudChrome.dexSwap.sentTitle'))}</div>` +
          `<div class="dexswap-line">${esc(t('hudChrome.dexSwap.sentBody'))}</div>` +
          `<div class="dexswap-line dexswap-sig" title="${esc(signature)}">${esc(t('hudChrome.dexSwap.signatureLabel', { signature: shortSig }))}</div>` +
          `<a class="dexswap-explorer" href="${esc(`${EXPLORER_TX_BASE}${encodeURIComponent(signature)}`)}" target="_blank" rel="noopener noreferrer">${esc(t('hudChrome.dexSwap.viewOnExplorer'))}</a>` +
          `<button type="button" class="btn dexswap-again-btn" data-dexswap-again>${esc(t('hudChrome.dexSwap.buyMore'))}</button>` +
          `</div>`;
        panel.querySelector('[data-dexswap-again]')?.addEventListener('click', () => {
          this.state = resetDexSwap(this.state);
          this.notice = null;
          this.paint();
          (this.deps.root().querySelector('[data-dexswap-amount]') as HTMLElement | null)?.focus();
        });
        return;
      }
      case 'error':
        if (this.state.errorCode === ERR_RATE_LIMITED && cooling) {
          this.paintCooldown();
          return;
        }
        panel.innerHTML = `<div class="dexswap-error" role="alert">${esc(this.errorMessage())}</div>`;
        return;
    }
  }

  // Rate-limit cooldown: a localized countdown that keeps quote/buy disabled
  // until retryAfterMs elapses, then re-enables by clearing the elapsed state.
  private paintCooldown(): void {
    const panel = this.panel();
    if (!panel) return;
    const seconds = cooldownRemainingSeconds(this.state, this.deps.now());
    panel.innerHTML =
      `<div class="dexswap-error dexswap-cooldown" role="alert" data-dexswap-cooldown>` +
      `${esc(t('hudChrome.dexSwap.cooldown', { seconds: formatNumber(seconds, { maximumFractionDigits: 0 }) }))}</div>`;
    this.armCooldownTimer();
  }

  private armCooldownTimer(): void {
    this.clearCooldownTimer();
    this.cooldownTimer = window.setInterval(() => {
      if (!this.isOpen || this.state.errorCode !== ERR_RATE_LIMITED) {
        this.clearCooldownTimer();
        return;
      }
      const nowMs = this.deps.now();
      if (isCoolingDown(this.state, nowMs)) {
        const hint = this.panel()?.querySelector<HTMLElement>('[data-dexswap-cooldown]');
        if (hint) {
          const seconds = cooldownRemainingSeconds(this.state, nowMs);
          hint.textContent = t('hudChrome.dexSwap.cooldown', {
            seconds: formatNumber(seconds, { maximumFractionDigits: 0 }),
          });
        }
        return;
      }
      // Cooldown elapsed: back to idle, actions re-enabled.
      this.state = clearElapsedCooldown(this.state, nowMs);
      this.paint();
    }, 1000);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer !== null) {
      window.clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  // While a quote is held, flip the Buy button + stale hint once it expires so
  // the player is never shown an actionable price that would be refused.
  private armStaleTimer(): void {
    this.clearStaleTimer();
    this.staleTimer = window.setInterval(() => {
      if (!this.isOpen || this.state.phase !== 'quoted') {
        this.clearStaleTimer();
        return;
      }
      const stale = !canSign(this.state, this.deps.now());
      const hint = this.panel()?.querySelector<HTMLElement>('[data-dexswap-stale]');
      if (hint) hint.hidden = !stale;
    }, 1000);
  }

  private clearStaleTimer(): void {
    if (this.staleTimer !== null) {
      window.clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
  }
}
