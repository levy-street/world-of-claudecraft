// Realm-purchase pricing (#475). The "buy a realm" path lets a player acquire a
// realm OUTRIGHT with SOL or USDC instead of locking $WOC: they pay the live
// market value of the tier's $WOC threshold, split 70% to the treasury and 30%
// to a buyback vault that the buy-and-burn keeper swaps to $WOC and burns. This
// module is the pricing + split math: convert a tier's $WOC amount into a
// SOL/USDC base-unit price via Jupiter, and split a total into its two legs.
//
// Pricing reads a Jupiter quote for a fixed REFERENCE $WOC notional (not the full
// tier amount) and linearly scales it to the tier size. Quoting the whole tier
// (which for Gold is 10% of supply) would bake in enormous price impact and
// quote a price far below fair value; a liquid reference trade gives a clean
// mid-market unit price that we scale up. Integer (bigint) math throughout; the
// quote is the only network touch and is briefly cached.
//
// Server-only module (no SQL, no client import). The actual on-chain swap+burn of
// the 30% lives in server/realm_buyback_keeper.ts, reusing the proven PayoutKeeper.

import { WOC_MINT, WOC_DECIMALS, USDC_MINT } from './woc_config';

// Native SOL is swapped through its wrapped-SOL mint on Jupiter (wrapAndUnwrapSol
// handles the wrap/unwrap); the buyer still pays in native lamports.
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export type BuyCurrency = 'USDC' | 'SOL';

export interface CurrencyConfig {
  key: BuyCurrency;
  mint: string; // the mint Jupiter prices against (wSOL for native SOL)
  decimals: number; // base-unit exponent (USDC 6, SOL 9)
  native: boolean; // true = paid in native lamports (System transfer), false = SPL transfer
}

export const CURRENCIES: Record<BuyCurrency, CurrencyConfig> = {
  USDC: { key: 'USDC', mint: USDC_MINT, decimals: 6, native: false },
  SOL: { key: 'SOL', mint: WSOL_MINT, decimals: 9, native: true },
};

export function isBuyCurrency(s: string): s is BuyCurrency {
  return s === 'USDC' || s === 'SOL';
}

const JUPITER_API = (process.env.JUPITER_API ?? 'https://quote-api.jup.ag/v6').trim();

function intEnv(key: string, def: number, min: number, max: number): number {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= min && v <= max ? v : def;
}

// 70% to the treasury, the remainder (30%) to the buyback+burn vault. Tunable but
// clamped to a sane range; the buyback leg is always the exact remainder so the
// two legs sum to the price with no rounding dust unaccounted for.
export const TREASURY_BPS = intEnv('REALM_BUY_TREASURY_BPS', 7000, 0, 10_000);

export function splitBuy(totalBase: bigint): { treasuryBase: bigint; buybackBase: bigint } {
  const treasuryBase = (totalBase * BigInt(TREASURY_BPS)) / 10_000n;
  return { treasuryBase, buybackBase: totalBase - treasuryBase };
}

const TEN = 10n;
function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= TEN;
  return r;
}

// The reference $WOC notional priced to derive the unit price. Authored in human
// $WOC, exposed in base units. Large enough to dodge rounding-to-zero on a cheap
// token, small enough to avoid material price impact on a routable pair.
function refWocBase(): bigint {
  const human = intEnv('REALM_BUY_PRICE_REF_WOC', 1_000_000, 1, 1_000_000_000);
  return BigInt(human) * pow10(WOC_DECIMALS);
}

// Slippage hint on the PRICING quote only (not a binding swap): a tolerant value
// is fine since we just want a market estimate, not an execution guarantee.
const PRICE_SLIPPAGE_BPS = intEnv('REALM_BUY_PRICE_SLIPPAGE_BPS', 50, 0, 10_000);

// Reject a pricing route whose price impact exceeds this, in basis points of the
// reference trade. A thin or manipulated pool shows large impact even on the small
// reference notional, so this stops a near-zero price from being pinned (a buyer
// could otherwise mint a whale-tier realm for dust on a low-liquidity route). The
// whole buy feature requires a routable, liquid pair anyway.
const MAX_PRICE_IMPACT_BPS = intEnv('REALM_BUY_MAX_PRICE_IMPACT_BPS', 500, 0, 10_000);

function numEnv(key: string, def: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

// Optional absolute price floor per currency (human units, e.g. min 1 USDC). A
// computed tier price below the floor is treated as unavailable, a backstop against
// a bad oracle reading. 0 disables the floor (the default).
function minPriceBase(currency: BuyCurrency): bigint {
  const key = currency === 'SOL' ? 'REALM_BUY_MIN_PRICE_SOL' : 'REALM_BUY_MIN_PRICE_USDC';
  const human = numEnv(key, 0);
  return BigInt(Math.round(human * Number(pow10(CURRENCIES[currency].decimals))));
}

const PRICE_CACHE_MS = intEnv('REALM_BUY_PRICE_CACHE_SECONDS', 30, 0, 3600) * 1000;
// outMint -> { at, outPerRef } : currency base units received for refWocBase $WOC.
const priceCache = new Map<string, { at: number; outPerRef: bigint }>();

// One Jupiter ExactIn quote: currency base units out for `inWocBase` $WOC in.
// null on no route / RPC failure (the caller surfaces it as price-unavailable).
async function jupiterOutForWoc(outMint: string, inWocBase: bigint): Promise<bigint | null> {
  try {
    const url =
      `${JUPITER_API}/quote?inputMint=${WOC_MINT}&outputMint=${outMint}` +
      `&amount=${inWocBase.toString()}&swapMode=ExactIn&slippageBps=${PRICE_SLIPPAGE_BPS}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { outAmount?: string; routePlan?: unknown[]; priceImpactPct?: string };
    if (typeof data.outAmount !== 'string' || !/^[0-9]+$/.test(data.outAmount) || !data.routePlan?.length) {
      return null; // no route / thin liquidity
    }
    // priceImpactPct is a decimal fraction string ("0.0123" = 1.23%). A large impact
    // on the small reference trade means a thin/manipulated pool: refuse to price.
    const impactPct = Math.abs(Number(data.priceImpactPct ?? '0'));
    if (Number.isFinite(impactPct) && impactPct * 10_000 > MAX_PRICE_IMPACT_BPS) return null;
    const out = BigInt(data.outAmount);
    return out > 0n ? out : null;
  } catch {
    return null;
  }
}

// Currency base units received for the cached reference $WOC notional. Cached per
// currency mint for PRICE_CACHE_MS so a burst of quote requests mostly hits cache.
async function refPriceFor(currency: BuyCurrency): Promise<bigint | null> {
  const mint = CURRENCIES[currency].mint;
  const hit = priceCache.get(mint);
  if (hit && Date.now() - hit.at < PRICE_CACHE_MS) return hit.outPerRef;
  const out = await jupiterOutForWoc(mint, refWocBase());
  if (out === null) return null;
  priceCache.set(mint, { at: Date.now(), outPerRef: out });
  return out;
}

// The SOL/USDC base-unit price of `tierWocBase` $WOC at the live market: the
// reference quote scaled linearly to the tier size. null when no route is
// available (devnet / an unlisted mint), which the route reports as 503.
export async function priceTierInCurrency(
  tierWocBase: bigint,
  currency: BuyCurrency,
): Promise<bigint | null> {
  if (tierWocBase <= 0n) return null;
  const outPerRef = await refPriceFor(currency);
  if (outPerRef === null) return null;
  const price = (outPerRef * tierWocBase) / refWocBase();
  if (price <= 0n) return null;
  if (price < minPriceBase(currency)) return null; // below the configured sanity floor
  return price;
}
