// Central config for the Aldrin Club subscription: the display + gating knobs the
// GAME still owns. Read once here so the status route and the subscribe UI agree.
//
// SPLIT ARCHITECTURE (#938): all MONEY config (mints, RPC, DEX/FX, token
// decimals, the treasury + buyback-vault addresses, the 50/50 split execution,
// every Stripe SECRET key, and the buyback keeper) MOVED to the economy service.
// The game holds none of it: no secrets, no payee addresses, no keeper. What is
// left here is purely presentational (price/period for display, the burn-bps the
// UI shows as "50% bought-and-burned") plus the feature + Stripe-rail flags.
// Server-only module: no SQL, no client import, no secrets in git.

// The whole feature is OFF until an operator opts in. With it off the routes 404,
// no membership is granted, and the subscribe UI renders disabled. Flip on only
// once the economy service is wired (WOC_ECONOMY_SERVICE_URL + secret).
export const ALDRIN_ENABLED = boolEnv(process.env.ALDRIN_ENABLED, false);

// Headline price, authored in USD cents. DISPLAY ONLY: the economy service prices
// the actual per-period amount in the chosen asset (the game never converts).
// Twenty dollars a month by default.
export const ALDRIN_PRICE_USD_CENTS = clampInt(
  process.env.ALDRIN_PRICE_USD_CENTS,
  2000,
  100,
  100000,
);

// One billing period in days, for the local membership clock (grant/heal) and the
// UI's "days remaining". The service owns the authoritative period; this is the
// mirror the local membership grant uses. Thirty days keeps the math
// host-agnostic (no calendar quirks).
export const ALDRIN_PERIOD_DAYS = clampInt(process.env.ALDRIN_PERIOD_DAYS, 30, 1, 366);

// The split the UI advertises ("N% bought-and-burned"). DISPLAY ONLY: the economy
// service executes the actual 50/50 treasury + buy-and-burn split. Default 50%.
export const ALDRIN_BURN_BPS = clampInt(process.env.ALDRIN_BURN_BPS, 5000, 0, 10000);

// Whether the Stripe rail is advertised to the client. The Stripe SECRET keys
// live in the economy service, never here; this is only the "offer the card rail"
// flag the status route reports.
export const ALDRIN_STRIPE_ENABLED = boolEnv(process.env.ALDRIN_STRIPE_ENABLED, false);

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
