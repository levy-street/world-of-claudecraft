// Thin modal window for CLAUDIUM, the server-authoritative soft currency.
//
// The consumer half of the pure-core + thin-consumer split (reference
// daily_rewards_window.ts / vendor_window.ts). It paints #claudium-window from
// the ClaudiumView (claudium_view.ts) and wires currency purchases / close. It owns NO
// currency logic: every number (balance, SKU credit, price) arrives
// through the injected deps, which read the economy SDK. When the service is off
// the view is the disabled/empty state and this paints a clean notice, never a
// crash.
//
// All strings are t() keys; all interpolation passes through esc(); colors/sizes
// are CSS tokens (class names), no literal hex/px in this module.

import { buildClaudiumView, type ClaudiumSkuInput, type ClaudiumView } from './claudium_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export type ClaudiumRail = 'stripe' | 'sol' | 'usdc' | 'woc';

/** The service-sourced snapshot the window renders (all values from the service). */
export interface ClaudiumSnapshot {
  available?: boolean;
  balance: number | null;
  skus: readonly ClaudiumSkuInput[];
  nativeRails?: Partial<Record<'sol' | 'usdc' | 'woc', boolean>>;
  walletBalances?: {
    solLamports: string | null;
    usdcBaseUnits: string | null;
    wocBaseUnits: string | null;
  };
  nativePrices?: readonly {
    sku: string;
    solAmountBase?: string | null;
    usdcAmountBase?: string | null;
    wocAmountBase?: string | null;
  }[];
}

/**
 * Hud-supplied glue. The window paints from what these return and reports clicks
 * back; it never reaches into Hud. balance()/skus()/price() are the
 * async service reads; buy() starts the client-signed purchase
 * flows; the focus pair comes from Hud.windowFocus().
 */
export interface ClaudiumWindowDeps {
  root(): HTMLElement;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  onVisibilityChange?(): void;
  /** Load the current service snapshot. Rejects only on an unexpected error. */
  snapshot(): Promise<ClaudiumSnapshot>;
  /** Begin a purchase on the chosen rail for the chosen SKU. */
  buy(rail: ClaudiumRail, sku: string): Promise<void>;
}

const EMPTY_SNAPSHOT: ClaudiumSnapshot = {
  balance: null,
  skus: [],
};

const WOC_DECIMALS = 6;
const USDC_DECIMALS = 6;
const WOC_ICON_URL = '/woc_logo_square.webp';
const SOL_ICON_URL = '/claudium/icons/solana-icon.webp';
const USDC_ICON_URL = '/claudium/icons/usdc-icon.webp';
type ClaudiumFocusTarget = { kind: 'rail' | 'sku'; value: string };

function sameClaudiumView(left: ClaudiumView | null, right: ClaudiumView): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

export class ClaudiumWindow {
  private openerFocus: HTMLElement | null = null;
  private renderSeq = 0;
  private hasRenderedSnapshot = false;
  private currentView: ClaudiumView | null = null;
  private refreshing = false;
  private refreshFailed = false;
  private announceSeq = 0;
  private selectedRail: ClaudiumRail = 'stripe';
  private pendingPurchase: { rail: ClaudiumRail; sku: string } | null = null;
  private purchaseError: string | null = null;

  constructor(private readonly deps: ClaudiumWindowDeps) {}

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.openerFocus = this.deps.captureFocus();
    this.deps.closeOthers();
    const root = this.deps.root();
    root.style.display = 'block';
    this.deps.onVisibilityChange?.();
    this.ensureShell();
    void this.render('open');
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') {
      this.openerFocus = null;
      return;
    }
    root.style.display = 'none';
    this.syncRefreshing(false);
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  async render(
    focus: 'open' | null = null,
    restoreTarget: ClaudiumFocusTarget | null = null,
  ): Promise<void> {
    const root = this.deps.root();
    const seq = ++this.renderSeq;
    this.ensureShell();
    if (focus === 'open') (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
    const refreshFocus = restoreTarget ?? this.captureBodyFocus();
    this.syncRefreshing(true);
    if (!this.hasRenderedSnapshot) this.paintLoading();
    let snapshot: ClaudiumSnapshot | null = null;
    try {
      snapshot = await this.deps.snapshot();
    } catch {
      // Keep the last good snapshot mounted. A transient service failure must not
      // collapse the panel or discard the user's place in it.
    }
    if (!this.isOpen || seq !== this.renderSeq) return;

    if ((!snapshot || snapshot.available === false) && this.currentView) {
      this.refreshFailed = true;
      this.syncRefreshing(false, true);
      this.restoreBodyFocus(refreshFocus);
      this.announce(t('hudChrome.claudium.unavailable'));
      return;
    }

    this.refreshFailed = snapshot === null || snapshot.available === false;
    const view = buildClaudiumView(
      this.refreshFailed ? EMPTY_SNAPSHOT : (snapshot ?? EMPTY_SNAPSHOT),
    );
    const viewChanged = !sameClaudiumView(this.currentView, view);
    this.currentView = view;
    const focused = this.captureBodyFocus() ?? refreshFocus;
    this.syncRefreshing(false, this.refreshFailed);
    if (viewChanged) this.paint(view);
    this.restoreBodyFocus(focused);
    this.hasRenderedSnapshot = true;
    if (this.refreshFailed) this.announce(t('hudChrome.claudium.unavailable'));
    else if (!this.pendingPurchase && !this.purchaseError) this.announce('');
  }

  private ensureShell(): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'claudium-title' });
    if (root.querySelector('.cl-body')) return;
    root.innerHTML = `${this.titleHtml()}<div class="cl-body"></div>`;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  private titleHtml(): string {
    return (
      `<div class="panel-title"><span id="claudium-title">${esc(t('hudChrome.claudium.title'))}</span>` +
      `<span class="cl-refresh-status" data-refresh-status aria-hidden="true">` +
      `<span class="cl-spinner" aria-hidden="true"></span>` +
      `<span class="cl-refresh-error" aria-hidden="true">!</span>` +
      `</span>` +
      `<span class="visually-hidden" data-cl-live-status role="status" aria-live="polite" aria-atomic="true"></span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.claudium.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private syncRefreshing(refreshing: boolean, failed = false): void {
    this.refreshing = refreshing;
    const root = this.deps.root();
    root
      .querySelector<HTMLElement>('.cl-body')
      ?.setAttribute('aria-busy', refreshing ? 'true' : 'false');
    const status = root.querySelector<HTMLElement>('[data-refresh-status]');
    status?.classList.toggle('active', refreshing);
    status?.classList.toggle('failed', failed);
    if (failed) status?.setAttribute('title', t('hudChrome.claudium.unavailable'));
    else status?.removeAttribute('title');
    if (this.currentView) this.syncSkuAvailability(this.currentView);
  }

  private announce(message: string): void {
    const status = this.deps.root().querySelector<HTMLElement>('[data-cl-live-status]');
    if (!status) return;
    const seq = ++this.announceSeq;
    status.textContent = '';
    if (!message) return;
    queueMicrotask(() => {
      if (seq === this.announceSeq) status.textContent = message;
    });
  }

  private captureBodyFocus(): ClaudiumFocusTarget | null {
    if (typeof document === 'undefined') return null;
    const body = this.deps.root().querySelector<HTMLElement>('.cl-body');
    const active = document.activeElement as HTMLElement | null;
    if (!body || !active || !body.contains(active)) return null;
    if (active.dataset.sku) return { kind: 'sku', value: active.dataset.sku };
    if (active.dataset.rail) return { kind: 'rail', value: active.dataset.rail };
    return null;
  }

  private restoreBodyFocus(target: ClaudiumFocusTarget | null): void {
    if (!target) return;
    const body = this.deps.root().querySelector<HTMLElement>('.cl-body');
    if (!body) return;
    const attribute = target.kind === 'sku' ? 'data-sku' : 'data-rail';
    const match = Array.from(body.querySelectorAll<HTMLButtonElement>(`[${attribute}]`)).find(
      (button) => button.dataset[target.kind] === target.value && !button.disabled,
    );
    if (match) {
      match.focus();
      return;
    }
    body
      .querySelector<HTMLButtonElement>('[data-rail][aria-pressed="true"]:not(:disabled)')
      ?.focus();
  }

  private paint(view: ClaudiumView): void {
    const body = this.deps.root().querySelector<HTMLElement>('.cl-body');
    if (!body) return;
    body.innerHTML =
      this.balanceHtml(view) + this.noticeHtml(view) + this.buyHtml(view) + this.disclosureHtml();
    this.wire(body, view);
  }

  private paintLoading(): void {
    const body = this.deps.root().querySelector<HTMLElement>('.cl-body');
    if (!body) return;
    body.innerHTML =
      `<div class="cl-loading" role="status" aria-live="polite">` +
      `<span class="cl-spinner" aria-hidden="true"></span>` +
      `<span>${esc(t('hudChrome.claudium.loading'))}</span>` +
      `</div>`;
  }

  private balanceHtml(view: ClaudiumView): string {
    // The balance is the ONE number the disabled state hides: with no service there
    // is no balance to show, so render a dash rather than a fabricated zero.
    const shown = view.hasBalance
      ? t('hudChrome.claudium.balanceUnit', {
          amount: formatNumber(view.balance ?? 0, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.claudium.balanceUnit', { amount: '--' });
    return (
      `<div class="cl-balance">` +
      `<img class="cl-balance-art" src="/claudium/claudium_coin_hero_3q.webp" alt="">` +
      `<div class="cl-balance-main">` +
      `<span class="cl-balance-label">${esc(t('hudChrome.claudium.balanceLabel'))}</span>` +
      `<strong class="cl-balance-value">${esc(shown)}</strong>` +
      `</div>` +
      this.walletBalancesHtml(view) +
      `</div>`
    );
  }

  private walletBalancesHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const sol = this.formatBaseUnits(view.walletBalances.solLamports, 9, 4);
    const usdc = this.formatBaseUnits(view.walletBalances.usdcBaseUnits, USDC_DECIMALS, 2);
    const woc = this.formatBaseUnits(view.walletBalances.wocBaseUnits, WOC_DECIMALS, 2);
    return (
      `<div class="cl-wallet-balances">` +
      `<span>${esc(t('hudChrome.claudium.solBalance', { amount: sol }))}</span>` +
      `<span>${esc(t('hudChrome.claudium.usdcBalance', { amount: usdc }))}</span>` +
      `<span>${esc(t('hudChrome.claudium.wocBalance', { amount: woc }))}</span>` +
      `</div>`
    );
  }

  private noticeHtml(view: ClaudiumView): string {
    if (!view.disabled) return '';
    return `<p class="cl-notice" role="status">${esc(t('hudChrome.claudium.unavailable'))}</p>`;
  }

  private buyHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const pending = this.pendingPurchase;
    const stripeSel =
      this.selectedRail === 'stripe' ? ' aria-pressed="true"' : ' aria-pressed="false"';
    const solSel = this.selectedRail === 'sol' ? ' aria-pressed="true"' : ' aria-pressed="false"';
    const usdcSel = this.selectedRail === 'usdc' ? ' aria-pressed="true"' : ' aria-pressed="false"';
    const wocSel = this.selectedRail === 'woc' ? ' aria-pressed="true"' : ' aria-pressed="false"';
    const railPicker =
      `<div class="cl-rails" role="group" aria-label="${esc(t('hudChrome.claudium.railLabel'))}">` +
      `<button type="button" class="cl-rail" data-rail="stripe"${stripeSel} ${view.rails.stripe && !pending ? '' : 'disabled'}>` +
      this.railIconHtml('card') +
      `<span>${esc(t('hudChrome.claudium.railStripe'))}</span>` +
      `</button>` +
      `<button type="button" class="cl-rail cl-rail-woc" data-rail="woc"${wocSel} ${view.rails.woc && !pending ? '' : 'disabled'}>` +
      this.railIconHtml('woc') +
      `<span>${esc(t('hudChrome.claudium.railWoc'))}</span>` +
      `<span class="cl-rail-discount">${esc(t('hudChrome.claudium.railWocDiscount'))}</span>` +
      `</button>` +
      `<button type="button" class="cl-rail" data-rail="usdc"${usdcSel} ${view.rails.usdc && !pending ? '' : 'disabled'}>` +
      this.railIconHtml('usdc') +
      `<span>${esc(t('hudChrome.claudium.railUsdc'))}</span>` +
      `</button>` +
      `<button type="button" class="cl-rail" data-rail="sol"${solSel} ${view.rails.sol && !pending ? '' : 'disabled'}>` +
      this.railIconHtml('sol') +
      `<span>${esc(t('hudChrome.claudium.railSol'))}</span>` +
      `</button>` +
      `</div>`;
    const nativeNote =
      view.rails.sol || view.rails.usdc || view.rails.woc
        ? ''
        : `<p class="cl-rail-note">${esc(t('hudChrome.claudium.railNativeUnavailable'))}</p>`;
    const rows = view.buyRows
      .map((row, index) => {
        const price = this.buyPriceLabel(row);
        const claudium = formatNumber(row.claudium, { maximumFractionDigits: 0 });
        const label = t('hudChrome.claudium.skuRow', { usd: price, claudium });
        const isPending = pending?.rail === this.selectedRail && pending.sku === row.sku;
        const disabled = this.skuDisabled(view, row);
        return (
          `<button type="button" class="cl-sku cl-pack${isPending ? ' pending' : ''}" data-pack-tier="${index + 1}" data-sku="${esc(row.sku)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>` +
          `<span class="cl-pack-art"><img src="${esc(this.packArt(row.claudium))}" alt=""></span>` +
          `<span class="cl-sku-claudium"><img src="/claudium/icons/claudium_coin_64.webp" alt="">${esc(t('hudChrome.claudium.storeCost', { amount: claudium }))}</span>` +
          `<span class="cl-sku-usd">${esc(price)}</span>` +
          `<span class="cl-sku-buy">` +
          (isPending
            ? `<span class="cl-spinner cl-sku-buy-spinner" aria-hidden="true"></span>`
            : '') +
          `${esc(isPending ? t('hudChrome.claudium.checkoutPendingButton') : t('hudChrome.claudium.buyButton'))}</span>` +
          `</button>`
        );
      })
      .join('');
    const errorNote =
      this.purchaseError && !pending
        ? `<p class="cl-purchase-error" role="alert">${esc(this.purchaseError)}</p>`
        : '';
    const list = view.buyDisabled
      ? `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.buyUnavailable'))}</p>`
      : `<div class="cl-sku-list">${rows}</div>`;
    return (
      `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.buyTitle'))}</h3>` +
      railPicker +
      nativeNote +
      `<div class="cl-amount-label">${esc(t('hudChrome.claudium.amountLabel'))}</div>` +
      errorNote +
      list +
      `</section>`
    );
  }

  private usdLabel(usd: number): string {
    return `$${formatNumber(usd, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  }

  private packArt(claudium: number): string {
    const size = claudium >= 4000 ? 'large' : claudium >= 1050 ? 'small' : 'single';
    return `/claudium/icons/stack_${size}_256.webp`;
  }

  private railIconHtml(kind: 'card' | 'sol' | 'usdc' | 'woc'): string {
    if (kind === 'woc') {
      return `<img class="cl-rail-icon cl-rail-brand" src="${esc(WOC_ICON_URL)}" alt="" aria-hidden="true">`;
    }
    if (kind === 'sol') {
      return `<img class="cl-rail-icon cl-rail-brand" src="${esc(SOL_ICON_URL)}" alt="" aria-hidden="true">`;
    }
    if (kind === 'usdc') {
      return `<img class="cl-rail-icon cl-rail-brand" src="${esc(USDC_ICON_URL)}" alt="" aria-hidden="true">`;
    }
    return (
      `<svg class="cl-rail-icon" viewBox="0 0 24 24" aria-hidden="true">` +
      `<rect x="3.5" y="5.5" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"></rect>` +
      `<path d="M4.5 9h15M7 14.5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>` +
      `</svg>`
    );
  }

  private buyPriceLabel(row: ClaudiumView['buyRows'][number]): string {
    if (this.selectedRail === 'sol') {
      return `${this.formatBaseUnits(row.solAmountBase, 9, 4)} SOL`;
    }
    if (this.selectedRail === 'usdc') {
      return `${this.formatBaseUnits(row.usdcAmountBase, USDC_DECIMALS, 2)} USDC`;
    }
    if (this.selectedRail === 'woc') {
      return `${this.formatBaseUnits(row.wocAmountBase, WOC_DECIMALS, 2)} WOC`;
    }
    return this.usdLabel(row.usd);
  }

  private formatBaseUnits(value: string | null, decimals: number, fractionDigits: number): string {
    if (!value) return '--';
    try {
      const raw = BigInt(value);
      const scale = 10n ** BigInt(decimals);
      const whole = raw / scale;
      const fraction = raw % scale;
      const factor = 10n ** BigInt(fractionDigits);
      const rounded = (fraction * factor + scale / 2n) / scale;
      const amount = Number(whole) + Number(rounded) / Number(factor);
      return formatNumber(amount, {
        maximumFractionDigits: fractionDigits,
        minimumFractionDigits: 0,
      });
    } catch {
      return '--';
    }
  }

  private disclosureHtml(): string {
    return `<p class="cl-disclosure">${esc(t('hudChrome.claudium.disclosure'))}</p>`;
  }

  private wire(body: HTMLElement, view: ClaudiumView): void {
    body.querySelectorAll<HTMLButtonElement>('[data-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rail =
          btn.dataset.rail === 'woc'
            ? 'woc'
            : btn.dataset.rail === 'usdc'
              ? 'usdc'
              : btn.dataset.rail === 'sol'
                ? 'sol'
                : 'stripe';
        if (rail === 'woc' && !view.rails.woc) return;
        if (rail === 'usdc' && !view.rails.usdc) return;
        if (rail === 'sol' && !view.rails.sol) return;
        if (rail === 'stripe' && !view.rails.stripe) return;
        this.selectedRail = rail;
        this.purchaseError = null;
        const focused = this.captureBodyFocus();
        this.paint(view);
        this.restoreBodyFocus(focused);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-sku]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled || this.pendingPurchase) return;
        const sku = btn.dataset.sku;
        if (!sku) return;
        const rail = this.selectedRail;
        const purchaseFocus = this.captureBodyFocus() ?? { kind: 'sku', value: sku };
        this.pendingPurchase = { rail, sku };
        this.purchaseError = null;
        this.syncPendingPurchase(body, rail, sku);
        void this.deps
          .buy(rail, sku)
          .catch((err) => {
            this.purchaseError =
              err instanceof Error && err.message
                ? err.message
                : t('hudChrome.claudium.checkoutFailed');
            this.announce(this.purchaseError);
          })
          .finally(() => {
            this.pendingPurchase = null;
            if (!this.isOpen) return;
            this.paint(this.currentView ?? view);
            this.restoreBodyFocus(purchaseFocus);
            void this.render(null, purchaseFocus);
          });
      });
    });
  }

  private skuDisabled(view: ClaudiumView, row: ClaudiumView['buyRows'][number]): boolean {
    return (
      this.pendingPurchase !== null ||
      this.refreshing ||
      this.refreshFailed ||
      (this.selectedRail === 'stripe' && !row.stripeConfigured) ||
      (this.selectedRail === 'sol' && (!view.rails.sol || !row.solAffordable)) ||
      (this.selectedRail === 'usdc' && (!view.rails.usdc || !row.usdcAffordable)) ||
      (this.selectedRail === 'woc' && (!view.rails.woc || !row.wocAffordable))
    );
  }

  private syncSkuAvailability(view: ClaudiumView): void {
    const rowBySku = new Map(view.buyRows.map((row) => [row.sku, row]));
    this.deps
      .root()
      .querySelectorAll<HTMLButtonElement>('[data-sku]')
      .forEach((button) => {
        const row = button.dataset.sku ? rowBySku.get(button.dataset.sku) : undefined;
        button.disabled = !row || this.skuDisabled(view, row);
      });
  }

  private syncPendingPurchase(body: HTMLElement, rail: ClaudiumRail, sku: string): void {
    body.querySelectorAll<HTMLButtonElement>('[data-rail], [data-sku]').forEach((button) => {
      button.disabled = true;
    });
    const selected = Array.from(body.querySelectorAll<HTMLButtonElement>('[data-sku]')).find(
      (button) => button.dataset.sku === sku,
    );
    if (selected) {
      selected.classList.add('pending');
      const buy = selected.querySelector<HTMLElement>('.cl-sku-buy');
      if (buy) {
        buy.innerHTML =
          `<span class="cl-spinner cl-sku-buy-spinner" aria-hidden="true"></span>` +
          esc(t('hudChrome.claudium.checkoutPendingButton'));
      }
    }
    this.pendingPurchase = { rail, sku };
    this.announce(t('hudChrome.claudium.checkoutPending'));
  }
}
