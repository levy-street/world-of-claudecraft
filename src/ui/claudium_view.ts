// Pure, host-agnostic view model for the CLAUDIUM window.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; reference vendor_view.ts / stat_tooltip_view.ts). CLAUDIUM is a
// server-authoritative soft currency: the peg, prices, SKU credits, balance, and
// store costs ALL come from the economy service. This core recomputes NONE of
// them; it only projects the service payloads into the render rows and the
// per-rail availability the window paints. DOM-free and i18n-free so
// tests/claudium_view.test.ts can drive it directly.
//
// The one non-negotiable: when the balance is null (the service is off) the model
// is a clean disabled/empty state, NEVER an error crash.

/** A price rung as returned by the service (usd + Claudium credited). */
export interface ClaudiumSkuInput {
  sku: string;
  usd: number;
  claudium: number;
}

/** Per-rail price. usdPerClaudium fixes the display peg; woc base-units null => oracle down. */
export interface ClaudiumPriceInput {
  usdPerClaudium: number | null;
  wocBaseUnitsPerClaudium: number | null;
}

/** A cosmetic-store row as returned by the service (name + Claudium cost). */
export interface ClaudiumStoreItemInput {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  costClaudium: number;
}

/**
 * The service-computed discount block that rides on a Claudium purchase result. The
 * view NEVER derives a percentage, a bonus, or a credited amount, it only carries
 * these through and lets the consumer format them. "X% off the effective peg
 * price": the buyer pays the full amount and receives MORE Claudium
 * (claudiumCredited >= baseClaudium). floorBps is the always-on $WOC floor (1500 for
 * the woc rail, else 0); promoBps is the admin/limited-time part.
 */
export interface ClaudiumDiscountInput {
  rail: 'stripe' | 'woc' | 'sol' | 'usdc';
  baseClaudium: number;
  discountBps: number;
  claudiumCredited: number;
  bonusClaudium: number;
  breakdown: { floorBps: number; promoBps: number };
  effectiveCentsPer100: number;
}

/** The raw inputs, all sourced from the service via the SDK. */
export interface ClaudiumViewInput {
  /** Integer Claudium balance, or null when the service is off. */
  balance: number | null;
  skus: readonly ClaudiumSkuInput[];
  price: ClaudiumPriceInput;
  storeItems: readonly ClaudiumStoreItemInput[];
  /** The last purchase's service-computed discount, or null/absent when there is none. */
  discount?: ClaudiumDiscountInput | null;
}

/** One buy-picker row: the money label and the Claudium credited, both from the service. */
export interface ClaudiumBuyRow {
  sku: string;
  usd: number;
  claudium: number;
}

/** One cosmetic-store row: the item, its kind, and its Claudium cost, from the service. */
export interface ClaudiumStoreRow {
  itemId: string;
  name: string;
  kind: 'cosmetic' | 'skin' | 'item';
  costClaudium: number;
}

/** Which purchase rails the window may enable. */
export interface ClaudiumRailAvailability {
  /** Stripe is available when there is at least one SKU rung to buy. */
  stripe: boolean;
  /** WOC is available only when the oracle price (base units per Claudium) is present. */
  woc: boolean;
}

/**
 * The projected discount, present only when the service reported an actual discount
 * (discountBps > 0). Every value is passed through verbatim from the service; the
 * view derives nothing except percent = discountBps / 100 (a pure unit rescale of a
 * service integer, the ONLY arithmetic here, never a price computation). floorBps > 0
 * means the always-on $WOC floor applies; promoBps > 0 means a limited-time promo is
 * folded in.
 */
export interface ClaudiumDiscountRow {
  discountBps: number;
  percent: number;
  baseClaudium: number;
  claudiumCredited: number;
  bonusClaudium: number;
  floorBps: number;
  promoBps: number;
}

export interface ClaudiumView {
  /** True when the service is off (balance null): render the disabled/empty state. */
  disabled: boolean;
  /** Whether a numeric balance is known (false in the disabled state). */
  hasBalance: boolean;
  /** The integer balance to render, or null in the disabled state. */
  balance: number | null;
  buyRows: ClaudiumBuyRow[];
  rails: ClaudiumRailAvailability;
  /** True when neither rail can transact (nothing to buy or oracle down + no skus). */
  buyDisabled: boolean;
  storeRows: ClaudiumStoreRow[];
  /** The service-computed discount to display, or null when there is none to show. */
  discount: ClaudiumDiscountRow | null;
}

/**
 * Project the service discount into a render row, pass-through only. Returns null
 * (nothing to show) unless the service reported a real discount (discountBps > 0);
 * a zero or missing discount shows no row. The one derivation is percent =
 * discountBps / 100 (a unit rescale), never a price.
 */
function projectDiscount(
  input: ClaudiumDiscountInput | null | undefined,
): ClaudiumDiscountRow | null {
  if (!input || input.discountBps <= 0) return null;
  return {
    discountBps: input.discountBps,
    percent: input.discountBps / 100,
    baseClaudium: input.baseClaudium,
    claudiumCredited: input.claudiumCredited,
    bonusClaudium: input.bonusClaudium,
    floorBps: input.breakdown.floorBps,
    promoBps: input.breakdown.promoBps,
  };
}

/**
 * Project the service payloads into the render model.
 *
 * Disabled state: a null balance means the service is off, so every buy/store row
 * is dropped and both rails are unavailable, a clean empty state (not an error).
 * Funded state: buy rows mirror the SKU ladder verbatim; stripe is available when
 * the ladder is non-empty; woc is available only when the oracle price is present;
 * store rows mirror the service catalog verbatim.
 */
export function buildClaudiumView(input: ClaudiumViewInput): ClaudiumView {
  const disabled = input.balance === null;
  if (disabled) {
    return {
      disabled: true,
      hasBalance: false,
      balance: null,
      buyRows: [],
      rails: { stripe: false, woc: false },
      buyDisabled: true,
      storeRows: [],
      discount: null,
    };
  }

  const buyRows: ClaudiumBuyRow[] = input.skus.map((s) => ({
    sku: s.sku,
    usd: s.usd,
    claudium: s.claudium,
  }));
  const stripe = buyRows.length > 0;
  const woc = buyRows.length > 0 && input.price.wocBaseUnitsPerClaudium !== null;
  const storeRows: ClaudiumStoreRow[] = input.storeItems.map((i) => ({
    itemId: i.itemId,
    name: i.name,
    kind: i.kind,
    costClaudium: i.costClaudium,
  }));

  return {
    disabled: false,
    hasBalance: true,
    balance: input.balance,
    buyRows,
    rails: { stripe, woc },
    buyDisabled: !stripe && !woc,
    storeRows,
    discount: projectDiscount(input.discount),
  };
}
