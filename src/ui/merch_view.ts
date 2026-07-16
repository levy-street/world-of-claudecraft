// Pure, host-agnostic view model for the homepage merch store.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; reference claudium_view.ts / vendor_view.ts). The merch catalog,
// per-variant USD and Claudium prices, stock flags, and order statuses ALL come
// from the economy service. This core recomputes NONE of them authoritatively; the
// line/total sums it emits are DISPLAY math over service-provided unit prices (the
// service re-prices every checkout), mirroring how claudium_view marks
// affordability. DOM-free and i18n-free so tests/merch_view.test.ts can drive it
// directly.
//
// The one non-negotiable: when the store is off (enabled false) the model is a
// clean disabled/empty state, NEVER an error crash.

/** One sellable variant as returned by the service (usd + claudium per unit). */
export interface MerchVariantInput {
  variantId: string;
  label: string;
  usd: number;
  claudium: number;
  inStock: boolean;
}

export interface MerchProductInput {
  productId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  variants: readonly MerchVariantInput[];
}

export interface MerchCartEntryInput {
  variantId: string;
  qty: number;
}

export interface MerchOrderInput {
  orderId: string;
  status: string;
  createdAtMs: number;
  totalLabel: string;
  items: readonly { name: string; qty: number }[];
  trackingUrl: string | null;
}

/** The raw inputs, all sourced from the service via the SDK (plus the local cart). */
export interface MerchViewInput {
  /** False when the store flag or the service is off: render the disabled state. */
  enabled: boolean;
  products: readonly MerchProductInput[];
  /** Integer Claudium balance, or null when logged out / service off. */
  claudiumBalance: number | null;
  cart: readonly MerchCartEntryInput[];
  orders?: readonly MerchOrderInput[];
}

/** Row types mirror the inputs verbatim (the catalog renders as-served). */
export type MerchVariantRow = MerchVariantInput;

export interface MerchProductRow {
  productId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  variants: readonly MerchVariantRow[];
}

export interface MerchCartRow {
  variantId: string;
  productName: string;
  variantLabel: string;
  qty: number;
  unitUsd: number;
  unitClaudium: number;
  lineUsd: number;
  lineClaudium: number;
}

/** Which checkout rails the page may enable (display gating only). */
export interface MerchRailAvailability {
  stripe: boolean;
  sol: boolean;
  /** Claudium needs a known balance covering the display total. */
  claudium: boolean;
}

export interface MerchOrderRow {
  orderId: string;
  /** A hudChrome.merch.status.* key suffix; 'unknown' for a status this build predates. */
  statusKey: string;
  createdAtMs: number;
  totalLabel: string;
  /** Structured items; the consumer composes the label through t() + formatNumber. */
  items: readonly { name: string; qty: number }[];
  trackingUrl: string | null;
}

export interface MerchView {
  /** True when the store is off: render the disabled/empty state. */
  disabled: boolean;
  productRows: MerchProductRow[];
  cartRows: MerchCartRow[];
  cartCount: number;
  /** Display-only sums of service-provided unit prices (the service re-prices checkout). */
  totalUsd: number;
  totalClaudium: number;
  rails: MerchRailAvailability;
  /** A checkout can start only with a non-empty, fully in-stock cart. */
  canCheckout: boolean;
  orderRows: MerchOrderRow[];
}

/** Service order statuses this build knows how to label. */
const STATUS_KEYS: Record<string, string> = {
  pending_payment: 'pendingPayment',
  paid: 'paid',
  submitted: 'submitted',
  in_production: 'inProduction',
  shipped: 'shipped',
  delivered: 'delivered',
  payment_failed: 'paymentFailed',
  expired: 'expired',
  canceled: 'canceled',
  refunded: 'refunded',
  fulfillment_failed: 'fulfillmentFailed',
};

/** Map a service order status onto its label-key suffix (forward-compatible). */
export function merchStatusKey(status: string): string {
  return STATUS_KEYS[status] ?? 'unknown';
}

/**
 * The slice of a checkout outcome the notice decision reads. Structural on
 * purpose: the page passes the SDK outcome, but the pure core never imports
 * from src/net (the UI-core purity gate forbids that layer).
 */
export interface MerchOutcomeInput {
  checkout: {
    ok: boolean;
    orderId: string | null;
    rail: string | null;
    reason: string | null;
  };
  settlement: { settled: boolean } | null;
}

export type MerchOutcomeNotice =
  | 'orderPlaced'
  | 'paymentPending'
  | 'notSettled'
  | 'invalid'
  | 'unavailable';

export interface MerchOutcomeState {
  /** True only when the order is out of the cart's hands (placed or in Stripe's). */
  clearCart: boolean;
  orderId: string | null;
  notice: MerchOutcomeNotice;
}

/**
 * Decide what a finished checkout call means for the page: which notice to show,
 * and whether the cart's job is done. Claudium settles synchronously in the
 * call, so ok means placed. Sol is placed only once the confirm ladder reports
 * settled; an unsettled sol keeps the cart (the payment may still be recovering
 * server-side, but the user must be able to retry or walk away with the cart
 * intact). Stripe ok means the service holds a real order awaiting card payment
 * in the embedded checkout: the cart's job is done, but the HONEST notice is
 * payment pending, never "placed" (the page upgrades it when the checkout
 * window reports completion).
 */
export function resolveCheckoutOutcome(outcome: MerchOutcomeInput): MerchOutcomeState {
  const { checkout, settlement } = outcome;
  if (!checkout.ok || !checkout.orderId) {
    return {
      clearCart: false,
      orderId: null,
      notice: checkout.reason === 'invalid_request' ? 'invalid' : 'unavailable',
    };
  }
  if (checkout.rail === 'sol') {
    if (!settlement?.settled) {
      return { clearCart: false, orderId: checkout.orderId, notice: 'notSettled' };
    }
    return { clearCart: true, orderId: checkout.orderId, notice: 'orderPlaced' };
  }
  if (checkout.rail === 'stripe') {
    return { clearCart: true, orderId: checkout.orderId, notice: 'paymentPending' };
  }
  return { clearCart: true, orderId: checkout.orderId, notice: 'orderPlaced' };
}

/**
 * Whether a shipping block is complete enough to submit: the required fields
 * non-empty (address2/state are legitimately optional worldwide). Real address
 * validation is the service's job; this only stops an obviously blank form.
 */
export function merchShippingComplete(
  shipping: {
    name: string;
    address1: string;
    city: string;
    zip: string;
    country: string;
  },
  email: string,
): boolean {
  return (
    shipping.name !== '' &&
    shipping.address1 !== '' &&
    shipping.city !== '' &&
    shipping.zip !== '' &&
    shipping.country !== '' &&
    email !== ''
  );
}

const DISABLED_VIEW: MerchView = {
  disabled: true,
  productRows: [],
  cartRows: [],
  cartCount: 0,
  totalUsd: 0,
  totalClaudium: 0,
  rails: { stripe: false, sol: false, claudium: false },
  canCheckout: false,
  orderRows: [],
};

/**
 * Project the service payloads + the local cart into the render model.
 *
 * Disabled state: enabled:false drops every row and rail, a clean empty state
 * (not an error). Enabled state: product rows mirror the catalog verbatim; cart
 * rows join the cart onto known variants (an unknown or restocked-away variant is
 * dropped rather than guessed); rails are display-gated (stripe/sol need a
 * checkout-able cart, claudium additionally a known balance covering the display
 * total); order rows carry a status label key with an 'unknown' fallback.
 */
export function buildMerchView(input: MerchViewInput): MerchView {
  if (!input.enabled) return DISABLED_VIEW;

  const productRows: MerchProductRow[] = input.products.map((p) => ({
    productId: p.productId,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    variants: p.variants,
  }));

  const variantIndex = new Map<string, { product: MerchProductInput; v: MerchVariantInput }>();
  for (const product of input.products) {
    for (const v of product.variants) variantIndex.set(v.variantId, { product, v });
  }

  const cartRows: MerchCartRow[] = [];
  let totalUsd = 0;
  let totalClaudium = 0;
  let allInStock = true;
  for (const entry of input.cart) {
    if (!Number.isInteger(entry.qty) || entry.qty <= 0) continue;
    const found = variantIndex.get(entry.variantId);
    if (!found) continue;
    if (!found.v.inStock) allInStock = false;
    const lineUsd = found.v.usd * entry.qty;
    const lineClaudium = found.v.claudium * entry.qty;
    totalUsd += lineUsd;
    totalClaudium += lineClaudium;
    cartRows.push({
      variantId: entry.variantId,
      productName: found.product.name,
      variantLabel: found.v.label,
      qty: entry.qty,
      unitUsd: found.v.usd,
      unitClaudium: found.v.claudium,
      lineUsd,
      lineClaudium,
    });
  }

  const canCheckout = cartRows.length > 0 && allInStock;
  const rails: MerchRailAvailability = {
    stripe: canCheckout,
    sol: canCheckout,
    claudium:
      canCheckout && input.claudiumBalance !== null && input.claudiumBalance >= totalClaudium,
  };

  const orderRows: MerchOrderRow[] = (input.orders ?? []).map((o) => ({
    orderId: o.orderId,
    statusKey: merchStatusKey(o.status),
    createdAtMs: o.createdAtMs,
    totalLabel: o.totalLabel,
    items: o.items,
    trackingUrl: o.trackingUrl,
  }));

  return {
    disabled: false,
    productRows,
    cartRows,
    cartCount: cartRows.reduce((sum, row) => sum + row.qty, 0),
    totalUsd,
    totalClaudium,
    rails,
    canCheckout,
    orderRows,
  };
}
