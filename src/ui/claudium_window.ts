// Thin modal window for CLAUDIUM, the server-authoritative soft currency.
//
// The consumer half of the pure-core + thin-consumer split (reference
// daily_rewards_window.ts / vendor_window.ts). It paints #claudium-window from
// the ClaudiumView (claudium_view.ts) and wires buy / spend / close. It owns NO
// currency logic: every number (balance, SKU credit, price, store cost) arrives
// through the injected deps, which read the economy SDK. When the service is off
// the view is the disabled/empty state and this paints a clean notice, never a
// crash.
//
// All strings are t() keys; all interpolation passes through esc(); colors/sizes
// are CSS tokens (class names), no literal hex/px in this module.

import {
  buildClaudiumView,
  type ClaudiumDiscountInput,
  type ClaudiumDiscountRow,
  type ClaudiumPriceInput,
  type ClaudiumSkuInput,
  type ClaudiumStoreItemInput,
  type ClaudiumView,
} from './claudium_view';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { svgIcon } from './ui_icons';

export type ClaudiumRail = 'stripe' | 'woc';

/** The service-sourced snapshot the window renders (all values from the service). */
export interface ClaudiumSnapshot {
  balance: number | null;
  skus: readonly ClaudiumSkuInput[];
  price: ClaudiumPriceInput;
  storeItems: readonly ClaudiumStoreItemInput[];
  /** The last purchase's service-computed discount, or null when there is none. */
  discount?: ClaudiumDiscountInput | null;
}

/**
 * Hud-supplied glue. The window paints from what these return and reports clicks
 * back; it never reaches into Hud. balance()/skus()/price()/storeItems() are the
 * async service reads; buy()/spend() start the (client-signed) purchase/spend
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
  buy(rail: ClaudiumRail, sku: string): void;
  /** Redeem a cosmetic for its Claudium cost. */
  spend(itemId: string, kind: 'cosmetic' | 'skin' | 'item'): void;
}

const EMPTY_SNAPSHOT: ClaudiumSnapshot = {
  balance: null,
  skus: [],
  price: { usdPerClaudium: null, wocBaseUnitsPerClaudium: null },
  storeItems: [],
  discount: null,
};

export class ClaudiumWindow {
  private openerFocus: HTMLElement | null = null;
  private renderSeq = 0;
  private selectedRail: ClaudiumRail = 'stripe';

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
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
    this.deps.onVisibilityChange?.();
  }

  async render(focus: 'open' | null = null): Promise<void> {
    const root = this.deps.root();
    const seq = ++this.renderSeq;
    this.ensureShell();
    if (focus === 'open') (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
    let snapshot: ClaudiumSnapshot;
    try {
      snapshot = await this.deps.snapshot();
    } catch {
      // A thrown read is treated exactly like the service being off: the disabled
      // state. The UI never surfaces a crash.
      snapshot = EMPTY_SNAPSHOT;
    }
    if (!this.isOpen || seq !== this.renderSeq) return;
    this.paint(buildClaudiumView(snapshot));
  }

  private ensureShell(): void {
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'claudium-title' });
    if (root.querySelector('.cl-body')) return;
    root.innerHTML = this.titleHtml() + `<div class="cl-body"></div>`;
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  private titleHtml(): string {
    return (
      `<div class="panel-title"><span id="claudium-title">${esc(t('hudChrome.claudium.title'))}</span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.claudium.close'))}">${svgIcon('close')}</button></div>`
    );
  }

  private paint(view: ClaudiumView): void {
    const body = this.deps.root().querySelector<HTMLElement>('.cl-body');
    if (!body) return;
    body.innerHTML =
      this.balanceHtml(view) +
      this.noticeHtml(view) +
      this.buyHtml(view) +
      this.storeHtml(view) +
      this.disclosureHtml();
    this.wire(body, view);
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
      `<span class="cl-balance-label">${esc(t('hudChrome.claudium.balanceLabel'))}</span>` +
      `<strong class="cl-balance-value">${esc(shown)}</strong>` +
      `</div>`
    );
  }

  private noticeHtml(view: ClaudiumView): string {
    if (!view.disabled) return '';
    return `<p class="cl-notice" role="status">${esc(t('hudChrome.claudium.unavailable'))}</p>`;
  }

  private buyHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const stripeSel =
      this.selectedRail === 'stripe' ? ' aria-pressed="true"' : ' aria-pressed="false"';
    const wocSel = this.selectedRail === 'woc' ? ' aria-pressed="true"' : ' aria-pressed="false"';
    const railPicker =
      `<div class="cl-rails" role="group" aria-label="${esc(t('hudChrome.claudium.railLabel'))}">` +
      `<button type="button" class="cl-rail" data-rail="stripe"${stripeSel} ${view.rails.stripe ? '' : 'disabled'}>${esc(t('hudChrome.claudium.railStripe'))}</button>` +
      `<button type="button" class="cl-rail" data-rail="woc"${wocSel} ${view.rails.woc ? '' : 'disabled'}>${esc(t('hudChrome.claudium.railWoc'))}</button>` +
      `</div>`;
    const wocNote = view.rails.woc
      ? ''
      : `<p class="cl-rail-note">${esc(t('hudChrome.claudium.railWocUnavailable'))}</p>`;
    const rows = view.buyRows
      .map((row) => {
        const usd = this.usdLabel(row.usd);
        const claudium = formatNumber(row.claudium, { maximumFractionDigits: 0 });
        const label = t('hudChrome.claudium.skuRow', { usd, claudium });
        return (
          `<button type="button" class="cl-sku" data-sku="${esc(row.sku)}" aria-label="${esc(label)}">` +
          `<span class="cl-sku-usd">${esc(usd)}</span>` +
          `<span class="cl-sku-claudium">${esc(t('hudChrome.claudium.storeCost', { amount: claudium }))}</span>` +
          `<span class="cl-sku-buy">${esc(t('hudChrome.claudium.buyButton'))}</span>` +
          `</button>`
        );
      })
      .join('');
    const list = view.buyDisabled
      ? `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.buyUnavailable'))}</p>`
      : `<div class="cl-sku-list">${rows}</div>`;
    return (
      `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.buyTitle'))}</h3>` +
      railPicker +
      wocNote +
      `<div class="cl-amount-label">${esc(t('hudChrome.claudium.amountLabel'))}</div>` +
      list +
      this.discountHtml(view.discount) +
      `</section>`
    );
  }

  /**
   * The service-computed discount: "N% off" with the base-to-credited bonus, shown
   * only when the service reported an actual discount (the view already null-guards
   * discountBps > 0). For the $WOC rail floor (floorBps > 0) an always-on incentive
   * line is appended, plus a promo note when promoBps > 0. Every number here is
   * service-owned; the window only formats it. Plain arrows/words, never an em or en
   * dash.
   */
  private discountHtml(discount: ClaudiumDiscountRow | null): string {
    if (!discount) return '';
    const percent = formatNumber(discount.percent, { maximumFractionDigits: 2 });
    const summary = t('hudChrome.claudium.discountSummary', { percent });
    const bonus = t('hudChrome.claudium.discountBonus', {
      base: formatNumber(discount.baseClaudium, { maximumFractionDigits: 0 }),
      credited: formatNumber(discount.claudiumCredited, { maximumFractionDigits: 0 }),
      bonus: formatNumber(discount.bonusClaudium, { maximumFractionDigits: 0 }),
    });
    const incentive =
      discount.floorBps > 0
        ? `<p class="cl-discount-incentive" role="note">${esc(t('hudChrome.claudium.wocIncentive'))}` +
          (discount.promoBps > 0 ? ` ${esc(t('hudChrome.claudium.wocPromoNote'))}` : '') +
          `</p>`
        : '';
    return (
      `<div class="cl-discount" role="status">` +
      `<span class="cl-discount-label">${esc(t('hudChrome.claudium.discountLabel'))}</span>` +
      `<span class="cl-discount-summary">${esc(summary)}</span>` +
      `<span class="cl-discount-bonus">${esc(bonus)}</span>` +
      incentive +
      `</div>`
    );
  }

  private usdLabel(usd: number): string {
    // The service sends whole-dollar SKUs ($1..$10000). Render with locale grouping
    // but no cents, so $10000 reads $10,000 in en and localizes elsewhere.
    return `$${formatNumber(usd, { maximumFractionDigits: 0 })}`;
  }

  private storeHtml(view: ClaudiumView): string {
    if (view.disabled) return '';
    const kindLabel = (kind: 'cosmetic' | 'skin' | 'item'): string =>
      kind === 'skin'
        ? t('hudChrome.claudium.kindSkin')
        : kind === 'item'
          ? t('hudChrome.claudium.kindItem')
          : t('hudChrome.claudium.kindCosmetic');
    const rows =
      view.storeRows.length === 0
        ? `<p class="cl-empty" role="status">${esc(t('hudChrome.claudium.storeEmpty'))}</p>`
        : view.storeRows
            .map((row) => {
              const cost = t('hudChrome.claudium.storeCost', {
                amount: formatNumber(row.costClaudium, { maximumFractionDigits: 0 }),
              });
              return (
                `<div class="cl-item">` +
                `<span class="cl-item-name">${esc(row.name)}</span>` +
                `<span class="cl-item-kind">${esc(kindLabel(row.kind))}</span>` +
                `<span class="cl-item-cost">${esc(cost)}</span>` +
                `<button type="button" class="cl-item-buy" data-item="${esc(row.itemId)}" data-kind="${esc(row.kind)}" aria-label="${esc(cost)}">${esc(t('hudChrome.claudium.spendButton'))}</button>` +
                `</div>`
              );
            })
            .join('');
    return `<section class="cl-section"><h3>${esc(t('hudChrome.claudium.storeTitle'))}</h3><div class="cl-item-list">${rows}</div></section>`;
  }

  private disclosureHtml(): string {
    return `<p class="cl-disclosure">${esc(t('hudChrome.claudium.disclosure'))}</p>`;
  }

  private wire(body: HTMLElement, view: ClaudiumView): void {
    body.querySelectorAll<HTMLButtonElement>('[data-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rail = btn.dataset.rail === 'woc' ? 'woc' : 'stripe';
        if (rail === 'woc' && !view.rails.woc) return;
        if (rail === 'stripe' && !view.rails.stripe) return;
        this.selectedRail = rail;
        this.paint(view);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-sku]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.dataset.sku;
        if (sku) this.deps.buy(this.selectedRail, sku);
      });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.item;
        const kind = btn.dataset.kind;
        if (itemId && (kind === 'cosmetic' || kind === 'skin' || kind === 'item')) {
          this.deps.spend(itemId, kind);
        }
      });
    });
  }
}
