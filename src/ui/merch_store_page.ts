// Thin homepage page for the merch store (Printful dropship).
//
// The consumer half of the pure-core + thin-consumer split (reference
// claudium_window.ts / vendor_window.ts). It paints #merch-store-root inside the
// homepage #store-view section from the MerchView (merch_view.ts) and wires
// add-to-cart / shipping / rail / checkout. It owns NO money logic: every price
// arrives through the injected deps, which read the merch SDK; the checkout total
// it shows is display math the service re-prices. When the store is off the view
// is the disabled state and this paints a clean notice, never a crash.
//
// All strings are t() keys; all interpolation passes through esc(); colors/sizes
// are CSS tokens (class names), no literal hex/px in this module.

import type {
  MerchCheckoutInput,
  MerchCheckoutOutcome,
  MerchOrder,
  MerchProducts,
  MerchRail,
  MerchShipping,
} from '../net/merch_sdk';
import { esc } from './esc';
import { formatDateTime, formatNumber, type TranslationKey, t } from './i18n';
import {
  buildMerchView,
  type MerchView,
  merchShippingComplete,
  resolveCheckoutOutcome,
} from './merch_view';

/**
 * Homepage-supplied glue. The page paints from what these return and reports
 * clicks back; it never reaches into main.ts. products()/claudiumBalance()/
 * orders() are the async service reads (balance/orders resolve to empty when
 * logged out); checkout() starts the rail-specific flow via the SDK orchestrator.
 */
export interface MerchStorePageDeps {
  root(): HTMLElement;
  products(): Promise<MerchProducts>;
  claudiumBalance(): Promise<number | null>;
  orders(): Promise<MerchOrder[]>;
  checkout(input: MerchCheckoutInput): Promise<MerchCheckoutOutcome>;
  /** True when a logged-in session exists (checkout needs one; browsing does not). */
  loggedIn(): boolean;
}

const SHIPPING_FIELDS = [
  ['name', 'hudChrome.merch.shipping.name'],
  ['address1', 'hudChrome.merch.shipping.address1'],
  ['address2', 'hudChrome.merch.shipping.address2'],
  ['city', 'hudChrome.merch.shipping.city'],
  ['state', 'hudChrome.merch.shipping.state'],
  ['zip', 'hudChrome.merch.shipping.zip'],
  ['country', 'hudChrome.merch.shipping.country'],
  ['email', 'hudChrome.merch.shipping.email'],
] as const;

type ShippingFieldKey = (typeof SHIPPING_FIELDS)[number][0];

export class MerchStorePage {
  private renderSeq = 0;
  private cart = new Map<string, number>();
  private selectedRail: MerchRail = 'stripe';
  private pendingCheckout = false;
  private noticeKey: TranslationKey | null = null;
  private lastOrderId: string | null = null;
  /** A stripe order awaiting card payment in the embedded checkout window. */
  private pendingPaymentOrderId: string | null = null;
  private shippingDraft: Partial<Record<ShippingFieldKey, string>> = {};

  constructor(private readonly deps: MerchStorePageDeps) {}

  async render(): Promise<void> {
    const seq = ++this.renderSeq;
    this.paintLoading();
    let products: MerchProducts = { enabled: false, products: [] };
    let balance: number | null = null;
    let orders: MerchOrder[] = [];
    try {
      [products, balance, orders] = await Promise.all([
        this.deps.products(),
        this.deps.claudiumBalance(),
        this.deps.orders(),
      ]);
    } catch {
      // A thrown read is treated exactly like the store being off: the disabled
      // state. The page never surfaces a crash.
    }
    if (seq !== this.renderSeq) return;
    const view = buildMerchView({
      enabled: products.enabled,
      products: products.products,
      claudiumBalance: balance,
      cart: [...this.cart.entries()].map(([variantId, qty]) => ({ variantId, qty })),
      orders,
    });
    this.paint(view);
  }

  private paintLoading(): void {
    const root = this.deps.root();
    root.innerHTML =
      `<div class="merch-loading" role="status" aria-live="polite">` +
      `<span class="merch-spinner" aria-hidden="true"></span>` +
      `<span>${esc(t('hudChrome.merch.loading'))}</span>` +
      `</div>`;
  }

  private paint(view: MerchView): void {
    const root = this.deps.root();
    if (view.disabled) {
      root.innerHTML = `<p class="merch-notice" role="status">${esc(t('hudChrome.merch.unavailable'))}</p>`;
      return;
    }
    root.innerHTML =
      this.noticeHtml() +
      this.catalogHtml(view) +
      this.cartHtml(view) +
      this.checkoutHtml(view) +
      this.ordersHtml(view) +
      `<p class="merch-disclosure">${esc(t('hudChrome.merch.disclosure'))}</p>`;
    this.wire(root, view);
  }

  private noticeHtml(): string {
    if (this.lastOrderId) {
      const text = t('hudChrome.merch.orderPlaced', { orderId: this.lastOrderId });
      return `<p class="merch-confirm" role="status">${esc(text)}</p>`;
    }
    if (this.pendingPaymentOrderId) {
      const text = t('hudChrome.merch.paymentPending', { orderId: this.pendingPaymentOrderId });
      return `<p class="merch-notice" role="status" aria-live="polite">${esc(text)}</p>`;
    }
    if (!this.noticeKey) return '';
    return `<p class="merch-notice" role="status">${esc(t(this.noticeKey))}</p>`;
  }

  private usdLabel(usd: number): string {
    return `$${formatNumber(usd, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private claudiumLabel(claudium: number): string {
    return t('hudChrome.merch.claudiumPrice', {
      amount: formatNumber(claudium, { maximumFractionDigits: 0 }),
    });
  }

  private catalogHtml(view: MerchView): string {
    const cards = view.productRows
      .map((product) => {
        const options = product.variants
          .map(
            (v) =>
              `<option value="${esc(v.variantId)}" ${v.inStock ? '' : 'disabled'}>` +
              `${esc(v.label)} - ${esc(this.usdLabel(v.usd))} / ${esc(this.claudiumLabel(v.claudium))}` +
              `${v.inStock ? '' : ` (${esc(t('hudChrome.merch.outOfStock'))})`}` +
              `</option>`,
          )
          .join('');
        const image = product.imageUrl
          ? `<img class="merch-card-img" src="${esc(product.imageUrl)}" alt="" loading="lazy">`
          : `<div class="merch-card-img merch-card-img-empty" aria-hidden="true"></div>`;
        const selectId = `merch-variant-${product.productId}`;
        return (
          `<div class="merch-card">` +
          image +
          `<h4 class="merch-card-name">${esc(product.name)}</h4>` +
          `<p class="merch-card-desc">${esc(product.description)}</p>` +
          `<label class="visually-hidden" for="${esc(selectId)}">${esc(t('hudChrome.merch.variantLabel'))}</label>` +
          `<select class="merch-variant" id="${esc(selectId)}" data-product="${esc(product.productId)}">${options}</select>` +
          `<button type="button" class="btn merch-add" data-add="${esc(product.productId)}">${esc(t('hudChrome.merch.addToCart'))}</button>` +
          `</div>`
        );
      })
      .join('');
    const body =
      view.productRows.length === 0
        ? `<p class="merch-empty" role="status">${esc(t('hudChrome.merch.catalogEmpty'))}</p>`
        : `<div class="merch-grid">${cards}</div>`;
    return `<section class="merch-section"><h3>${esc(t('hudChrome.merch.catalogTitle'))}</h3>${body}</section>`;
  }

  private cartHtml(view: MerchView): string {
    if (view.cartRows.length === 0) {
      return (
        `<section class="merch-section"><h3>${esc(t('hudChrome.merch.cartTitle'))}</h3>` +
        `<p class="merch-empty" role="status">${esc(t('hudChrome.merch.cartEmpty'))}</p></section>`
      );
    }
    const rows = view.cartRows
      .map(
        (row) =>
          `<div class="merch-cart-row">` +
          `<span class="merch-cart-name">${esc(row.productName)} - ${esc(row.variantLabel)}</span>` +
          `<span class="merch-cart-qty">x${esc(formatNumber(row.qty, { maximumFractionDigits: 0 }))}</span>` +
          `<span class="merch-cart-line">${esc(this.usdLabel(row.lineUsd))} / ${esc(this.claudiumLabel(row.lineClaudium))}</span>` +
          `<button type="button" class="merch-remove" data-remove="${esc(row.variantId)}" aria-label="${esc(t('hudChrome.merch.removeFromCart'))}">&times;</button>` +
          `</div>`,
      )
      .join('');
    const totals =
      `<div class="merch-cart-total">` +
      `<span>${esc(t('hudChrome.merch.totalLabel'))}</span>` +
      `<strong>${esc(this.usdLabel(view.totalUsd))} / ${esc(this.claudiumLabel(view.totalClaudium))}</strong>` +
      `</div>` +
      `<p class="merch-total-note">${esc(t('hudChrome.merch.totalNote'))}</p>`;
    return `<section class="merch-section"><h3>${esc(t('hudChrome.merch.cartTitle'))}</h3>${rows}${totals}</section>`;
  }

  private checkoutHtml(view: MerchView): string {
    if (view.cartRows.length === 0) return '';
    if (!this.deps.loggedIn()) {
      return (
        `<section class="merch-section"><h3>${esc(t('hudChrome.merch.checkoutTitle'))}</h3>` +
        `<p class="merch-notice" role="status">${esc(t('hudChrome.merch.loginRequired'))}</p></section>`
      );
    }
    const fields = SHIPPING_FIELDS.map(([key, labelKey]) => {
      const id = `merch-ship-${key}`;
      const type = key === 'email' ? 'email' : 'text';
      const value = this.shippingDraft[key] ?? '';
      return (
        `<div class="merch-field">` +
        `<label class="merch-label" for="${esc(id)}">${esc(t(labelKey))}</label>` +
        `<input class="merch-input" id="${esc(id)}" name="${esc(key)}" type="${esc(type)}" value="${esc(value)}" autocomplete="${esc(SHIPPING_AUTOCOMPLETE[key])}">` +
        `</div>`
      );
    }).join('');
    const railBtn = (rail: MerchRail, labelKey: TranslationKey, available: boolean): string =>
      `<button type="button" class="merch-rail" data-rail="${esc(rail)}" aria-pressed="${this.selectedRail === rail ? 'true' : 'false'}" ${available && !this.pendingCheckout ? '' : 'disabled'}>${esc(t(labelKey))}</button>`;
    const rails =
      `<div class="merch-rails" role="group" aria-label="${esc(t('hudChrome.merch.railLabel'))}">` +
      railBtn('stripe', 'hudChrome.merch.railStripe', view.rails.stripe) +
      railBtn('sol', 'hudChrome.merch.railSol', view.rails.sol) +
      railBtn('claudium', 'hudChrome.merch.railClaudium', view.rails.claudium) +
      `</div>`;
    const pendingNote = this.pendingCheckout
      ? `<p class="merch-pending" role="status" aria-live="polite"><span class="merch-spinner" aria-hidden="true"></span>${esc(t('hudChrome.merch.checkoutPending'))}</p>`
      : '';
    return (
      `<section class="merch-section"><h3>${esc(t('hudChrome.merch.checkoutTitle'))}</h3>` +
      `<form class="merch-shipping" novalidate>${fields}</form>` +
      rails +
      pendingNote +
      `<button type="button" class="btn btn-primary merch-checkout" data-checkout ${view.canCheckout && !this.pendingCheckout ? '' : 'disabled'}>${esc(t('hudChrome.merch.payNow'))}</button>` +
      `</section>`
    );
  }

  private ordersHtml(view: MerchView): string {
    if (!this.deps.loggedIn() || view.orderRows.length === 0) return '';
    const rows = view.orderRows
      .map((row) => {
        const statusKey = `hudChrome.merch.status.${row.statusKey}` as TranslationKey;
        const tracking = row.trackingUrl
          ? ` <a class="merch-tracking" href="${esc(row.trackingUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('hudChrome.merch.trackOrder'))}</a>`
          : '';
        const itemsLabel = row.items
          .map((i) =>
            t('hudChrome.merch.orderItem', {
              name: i.name,
              qty: formatNumber(i.qty, { maximumFractionDigits: 0 }),
            }),
          )
          .join(t('hudChrome.merch.orderItemSeparator'));
        return (
          `<div class="merch-order-row">` +
          `<span class="merch-order-date">${esc(formatDateTime(new Date(row.createdAtMs)))}</span>` +
          `<span class="merch-order-items">${esc(itemsLabel)}</span>` +
          `<span class="merch-order-total">${esc(row.totalLabel)}</span>` +
          `<span class="merch-order-status">${esc(t(statusKey))}${tracking}</span>` +
          `</div>`
        );
      })
      .join('');
    return `<section class="merch-section"><h3>${esc(t('hudChrome.merch.ordersTitle'))}</h3><div class="merch-orders">${rows}</div></section>`;
  }

  private readShipping(root: HTMLElement): { shipping: MerchShipping; email: string } | null {
    const read = (key: ShippingFieldKey): string => {
      const input = root.querySelector<HTMLInputElement>(`#merch-ship-${key}`);
      const value = input?.value.trim() ?? '';
      this.shippingDraft[key] = value;
      return value;
    };
    const shipping: MerchShipping = {
      name: read('name'),
      address1: read('address1'),
      address2: read('address2'),
      city: read('city'),
      state: read('state'),
      zip: read('zip'),
      country: read('country'),
    };
    const email = read('email');
    if (!merchShippingComplete(shipping, email)) return null;
    return { shipping, email };
  }

  private wire(root: HTMLElement, view: MerchView): void {
    root.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const productId = btn.dataset.add;
        if (!productId) return;
        const select = root.querySelector<HTMLSelectElement>(
          `.merch-variant[data-product="${CSS.escape(productId)}"]`,
        );
        const variantId = select?.value;
        if (!variantId) return;
        this.cart.set(variantId, (this.cart.get(variantId) ?? 0) + 1);
        this.noticeKey = null;
        this.lastOrderId = null;
        this.pendingPaymentOrderId = null;
        void this.render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variantId = btn.dataset.remove;
        if (!variantId) return;
        this.cart.delete(variantId);
        void this.render();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rail = btn.dataset.rail;
        if (rail !== 'stripe' && rail !== 'sol' && rail !== 'claudium') return;
        if (!view.rails[rail]) return;
        this.selectedRail = rail;
        this.paint(view);
      });
    });
    root.querySelectorAll<HTMLInputElement>('.merch-input').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.name as ShippingFieldKey;
        this.shippingDraft[key] = input.value;
      });
    });
    root.querySelector<HTMLButtonElement>('[data-checkout]')?.addEventListener('click', () => {
      if (this.pendingCheckout || !view.canCheckout) return;
      const read = this.readShipping(root);
      if (!read) {
        this.noticeKey = 'hudChrome.merch.shippingIncomplete';
        this.paint(view);
        return;
      }
      const items = view.cartRows.map((row) => ({ variantId: row.variantId, qty: row.qty }));
      this.pendingCheckout = true;
      this.noticeKey = null;
      this.paint(view);
      void this.deps
        .checkout({ rail: this.selectedRail, items, shipping: read.shipping, email: read.email })
        .then((outcome) => {
          this.applyOutcome(outcome);
        })
        .catch(() => {
          this.noticeKey = 'hudChrome.merch.checkoutFailed';
        })
        .finally(() => {
          this.pendingCheckout = false;
          void this.render();
        });
    });
  }

  /**
   * Fold a checkout outcome into the page state. The DECISION (which notice,
   * whether the cart's job is done) is the pure core's resolveCheckoutOutcome;
   * this only maps its typed notice onto page fields. A stripe order shows the
   * honest payment-pending notice until the embedded checkout window reports
   * completion (noteStripePaymentComplete), never a premature "placed".
   */
  private applyOutcome(outcome: MerchCheckoutOutcome): void {
    const state = resolveCheckoutOutcome(outcome);
    this.noticeKey = null;
    this.lastOrderId = null;
    this.pendingPaymentOrderId = null;
    if (state.clearCart) this.cart.clear();
    switch (state.notice) {
      case 'orderPlaced':
        this.lastOrderId = state.orderId;
        return;
      case 'paymentPending':
        this.pendingPaymentOrderId = state.orderId;
        return;
      case 'notSettled':
        this.noticeKey = 'hudChrome.merch.checkoutNotSettled';
        return;
      case 'invalid':
        this.noticeKey = 'hudChrome.merch.shippingIncomplete';
        return;
      case 'unavailable':
        this.noticeKey = 'hudChrome.merch.checkoutUnavailable';
        return;
    }
  }

  /**
   * The embedded stripe checkout reported completion (main.ts wires this to
   * openStripeCheckout's onComplete): upgrade the pending-payment notice to the
   * placed confirmation. The orders list catches the paid status on re-render.
   */
  noteStripePaymentComplete(): void {
    if (!this.pendingPaymentOrderId) return;
    this.lastOrderId = this.pendingPaymentOrderId;
    this.pendingPaymentOrderId = null;
    this.noticeKey = null;
    void this.render();
  }
}

const SHIPPING_AUTOCOMPLETE: Record<ShippingFieldKey, string> = {
  name: 'name',
  address1: 'address-line1',
  address2: 'address-line2',
  city: 'address-level2',
  state: 'address-level1',
  zip: 'postal-code',
  country: 'country-name',
  email: 'email',
};
