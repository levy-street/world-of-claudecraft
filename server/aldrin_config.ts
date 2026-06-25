// Central config for the Aldrin Club subscription: price, billing period, the
// SOL/USDC/$WOC/Stripe payment rails, and the 50/50 treasury-versus-buyback-burn
// split. Read once here so every consumer (the quote builder, the on-chain
// verifier, the buyback keeper, and the Stripe webhook) agrees on the same
// numbers. Server-only module: no SQL, no client import, no secrets in git.
//
// DRAFT NOTE: this mirrors the conventions of the in-flight $WOC commerce core
// (server/woc_config.ts: WOC_MINT, USDC_MINT, splitPrice, the BUYBACK_* keeper
// config). When that core lands on main, this file should be folded into it so
// there is a single source of truth for mints, RPC, and sink routing. It is kept
// standalone here only so the draft compiles against today's main.

// The whole feature is OFF until an operator opts in. With it off the routes
// 404, no membership is granted, and no keeper runs. Flip on only once the
// treasury + buyback vault addresses are funded and disclosed.
export const ALDRIN_ENABLED = boolEnv(process.env.ALDRIN_ENABLED, false);

// Headline price, authored in USD cents so the SOL/$WOC quote math stays integer.
// Twenty dollars a month by default.
export const ALDRIN_PRICE_USD_CENTS = clampInt(process.env.ALDRIN_PRICE_USD_CENTS, 2000, 100, 100000);

// One billing period in days. A renewal extends membership by this much from
// whichever is later: now, or the current expiry (so paying early never burns
// remaining time). Thirty days keeps the math host-agnostic (no calendar quirks).
export const ALDRIN_PERIOD_DAYS = clampInt(process.env.ALDRIN_PERIOD_DAYS, 30, 1, 366);

// How a crypto payment is split. By default 50% is removed from $WOC supply
// (bought-and-burned for SOL/USDC, burned directly for a $WOC payment) and the
// remaining 50% funds the disclosed treasury. Always: the burn/buyback portion
// plus the treasury portion must cover the full price.
export const ALDRIN_BURN_BPS = clampInt(process.env.ALDRIN_BURN_BPS, 5000, 0, 10000);

// The disclosed, on-chain-auditable treasury that receives the treasury split of
// every SOL/USDC payment and the treasury split of a $WOC payment. Empty in dev
// keeps crypto payments refused (a quote cannot name a payee it does not have).
export const ALDRIN_TREASURY = (process.env.ALDRIN_TREASURY ?? '').trim() || null;

// The buyback vault that receives the buyback split of SOL/USDC payments. The
// buyback keeper (server/aldrin_buyback.ts) later swaps its balance to $WOC on a
// DEX aggregator and burns it. This is the one custodial seam for SOL/USDC; it
// holds nothing but in-flight buyback funds plus a little SOL for fees. Empty in
// dev keeps SOL/USDC payments refused.
export const ALDRIN_BUYBACK_VAULT = (process.env.ALDRIN_BUYBACK_VAULT ?? '').trim() || null;

// How long a payment quote is honored. The quote pins the exact lamport/base
// amount (a live FX snapshot for SOL/$WOC) and the payee addresses, so it must be
// short enough that the FX cannot drift far before the user signs.
export const ALDRIN_QUOTE_TTL_SECONDS = clampInt(process.env.ALDRIN_QUOTE_TTL_SECONDS, 600, 30, 3600);

// ---------------------------------------------------------------------------
// Mints + RPC. Defaults match the published $WOC contract and mainnet USDC, the
// same values server/woc_balance.ts already reads. Prefer the server-only var,
// fall back to the client's VITE_* (loaded from .env.local in dev), then the
// default, so one local config drives everything.
// ---------------------------------------------------------------------------
export const WOC_MINT = (
  process.env.WOC_MINT ?? process.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();

export const USDC_MINT = (process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').trim();

export const SOLANA_RPC_URL = (
  process.env.SOLANA_RPC_URL ?? process.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
).trim();

// DEX aggregator used both to quote a USD->asset amount and (in the keeper) to
// execute the buyback swap. Default Jupiter v6.
export const JUPITER_API = (process.env.JUPITER_API ?? 'https://quote-api.jup.ag').replace(/\/$/, '');

// Token decimals. SOL is always 9, USDC always 6 on Solana; $WOC defaults to 6
// (override if the canonical mint differs).
export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;
export const WOC_DECIMALS = clampInt(process.env.WOC_DECIMALS, 6, 0, 18);

// ---------------------------------------------------------------------------
// Buyback keeper. Off by default; the keeper wallet is the only custodial seam
// for the SOL/USDC buyback half. Store the secret via KMS/secret manager, never
// in git. Never promise price/return: this is protocol-owned deflation.
// ---------------------------------------------------------------------------
export const ALDRIN_BUYBACK_ENABLED = boolEnv(process.env.ALDRIN_BUYBACK_ENABLED, false);
export const ALDRIN_BUYBACK_KEEPER_SECRET = (process.env.ALDRIN_BUYBACK_KEEPER_SECRET ?? '').trim();
// Do not swap dust: only run once at least this much value (USD cents) is pooled.
export const ALDRIN_BUYBACK_MIN_BATCH_USD_CENTS = clampInt(process.env.ALDRIN_BUYBACK_MIN_BATCH_USD_CENTS, 5000, 100, 10_000_000);
// Max acceptable slippage on the swap, in basis points (default 1%).
export const ALDRIN_BUYBACK_SLIPPAGE_BPS = clampInt(process.env.ALDRIN_BUYBACK_SLIPPAGE_BPS, 100, 1, 5000);

// ---------------------------------------------------------------------------
// Stripe (fiat card). The webhook secret verifies inbound events; the secret key
// is used by the (out-of-v1) Checkout-session creation. Both empty in dev keeps
// the Stripe rail refused. We verify webhooks with raw HMAC via node:crypto and
// add no SDK dependency (the repo keeps its dependency set tiny).
// ---------------------------------------------------------------------------
export const ALDRIN_STRIPE_ENABLED = boolEnv(process.env.ALDRIN_STRIPE_ENABLED, false);
export const ALDRIN_STRIPE_SECRET_KEY = (process.env.ALDRIN_STRIPE_SECRET_KEY ?? '').trim();
export const ALDRIN_STRIPE_WEBHOOK_SECRET = (process.env.ALDRIN_STRIPE_WEBHOOK_SECRET ?? '').trim();
// The Stripe Price id for the $20/mo subscription product (created in Stripe).
export const ALDRIN_STRIPE_PRICE_ID = (process.env.ALDRIN_STRIPE_PRICE_ID ?? '').trim();

// ---------------------------------------------------------------------------
// Small env parsers (kept local; mirror server/woc_config.ts).
// ---------------------------------------------------------------------------
function boolEnv(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function clampInt(v: string | undefined, dflt: number, lo: number, hi: number): number {
  if (v === undefined) return dflt;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
