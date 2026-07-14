// Pure, host-agnostic view model for the CLAUDIUM window.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; reference vendor_view.ts / stat_tooltip_view.ts). CLAUDIUM is a
// server-authoritative soft currency: the peg, prices, SKU credits, balance, and
// purchase amounts ALL come from the economy service. This core recomputes NONE of
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
  /** False when the Stripe price env var for this SKU is not configured. */
  stripeConfigured?: boolean;
}

export interface ClaudiumWalletBalancesInput {
  solLamports: string | null;
  wocBaseUnits: string | null;
}

export interface ClaudiumNativeSkuPriceInput {
  sku: string;
  solAmountBase?: string | null;
  wocAmountBase?: string | null;
}

/** The raw inputs, all sourced from the service via the SDK. */
export interface ClaudiumViewInput {
  /** Integer Claudium balance, or null when the service is off. */
  balance: number | null;
  skus: readonly ClaudiumSkuInput[];
  nativeRails?: Partial<Record<'sol' | 'woc', boolean>>;
  walletBalances?: ClaudiumWalletBalancesInput;
  nativePrices?: readonly ClaudiumNativeSkuPriceInput[];
}

/** One buy-picker row: the money label and the Claudium credited, both from the service. */
export interface ClaudiumBuyRow {
  sku: string;
  usd: number;
  claudium: number;
  stripeConfigured: boolean;
  solAffordable: boolean;
  wocAffordable: boolean;
  solAmountBase: string | null;
  wocAmountBase: string | null;
}

/** Which purchase rails the window may enable. */
export interface ClaudiumRailAvailability {
  /** Stripe is available when there is at least one SKU rung to buy. */
  stripe: boolean;
  /** SOL is available when the native SOL rail is configured in the economy service. */
  sol: boolean;
  /** WOC is available only when the oracle price (base units per Claudium) is present. */
  woc: boolean;
}

export interface ClaudiumView {
  /** True when the service is off (balance null): render the disabled/empty state. */
  disabled: boolean;
  /** Whether a numeric balance is known (false in the disabled state). */
  hasBalance: boolean;
  /** The integer balance to render, or null in the disabled state. */
  balance: number | null;
  walletBalances: ClaudiumWalletBalancesInput;
  buyRows: ClaudiumBuyRow[];
  rails: ClaudiumRailAvailability;
  /** True when neither rail can transact (nothing to buy or oracle down + no skus). */
  buyDisabled: boolean;
}

function affordable(balance: string | null | undefined, cost: string | null | undefined): boolean {
  if (!balance || !cost) return false;
  try {
    return BigInt(balance) >= BigInt(cost);
  } catch {
    return false;
  }
}

/**
 * Project the service payloads into the render model.
 *
 * Disabled state: a null balance means the service is off, so every buy row
 * is dropped and both rails are unavailable, a clean empty state (not an error).
 * Funded state: buy rows mirror the SKU ladder verbatim; stripe is available when
 * the ladder is non-empty; woc is available only when the oracle price is present;
 */
export function buildClaudiumView(input: ClaudiumViewInput): ClaudiumView {
  if (input.balance === null) {
    return {
      disabled: true,
      hasBalance: false,
      balance: null,
      walletBalances: { solLamports: null, wocBaseUnits: null },
      buyRows: [],
      rails: { stripe: false, sol: false, woc: false },
      buyDisabled: true,
    };
  }

  const balance = input.balance;
  const nativePriceBySku = new Map(input.nativePrices?.map((p) => [p.sku, p]) ?? []);
  const walletBalances = input.walletBalances ?? { solLamports: null, wocBaseUnits: null };
  const buyRows: ClaudiumBuyRow[] = input.skus.map((s) => ({
    sku: s.sku,
    usd: s.usd,
    claudium: s.claudium,
    stripeConfigured: s.stripeConfigured !== false,
    solAmountBase: nativePriceBySku.get(s.sku)?.solAmountBase ?? null,
    wocAmountBase: nativePriceBySku.get(s.sku)?.wocAmountBase ?? null,
    solAffordable: affordable(
      walletBalances.solLamports,
      nativePriceBySku.get(s.sku)?.solAmountBase,
    ),
    wocAffordable: affordable(
      walletBalances.wocBaseUnits,
      nativePriceBySku.get(s.sku)?.wocAmountBase,
    ),
  }));
  const stripe = buyRows.some((row) => row.stripeConfigured);
  const sol = input.nativeRails?.sol === true && buyRows.some((row) => row.solAmountBase !== null);
  const woc = input.nativeRails?.woc === true && buyRows.some((row) => row.wocAmountBase !== null);
  return {
    disabled: false,
    hasBalance: true,
    balance,
    walletBalances,
    buyRows,
    rails: { stripe, sol, woc },
    buyDisabled: !stripe && !sol && !woc,
  };
}
