// Central $WOC / Solana commerce config — the single source of truth for the
// mint, RPC, decimals, sink routing (burn / treasury split), and feature prices.
// Read once here so every consumer (rename payments in this PR, SNS subdomains,
// and the shared marketplace + buyback core) agrees on the same numbers.
//
// Prices are authored in **human-readable $WOC** (env vars) and exposed in token
// **base units** (× 10^decimals) for on-chain math. Server-only module; no SQL,
// no client import.

// The $WOC SPL mint. Prefer the server-only var, fall back to the client's
// VITE_* (loaded from .env.local in dev by db.ts), then the published default —
// mirrors server/woc_balance.ts so a single local config drives everything.
export const WOC_MINT = (
  process.env.WOC_MINT ?? process.env.VITE_WOC_MINT ?? '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();

export const SOLANA_RPC_URL = (
  process.env.SOLANA_RPC_URL ?? process.env.VITE_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
).trim();

// USDC mint — used by the shared marketplace core (PR3 / #469), declared here so
// there is one canonical value. Mainnet USDC by default.
export const USDC_MINT = (
  process.env.USDC_MINT ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
).trim();

// $WOC token decimals. Most SPL/pump tokens use 6; override if the canonical
// mint differs. Used to convert human prices → base units and to build the
// client-side burnChecked instruction (which is decimal-checked on-chain).
export const WOC_DECIMALS = clampInt(process.env.WOC_DECIMALS, 6, 0, 18);

// Sink routing. By default 100% of a payment is burned (a clean deflationary
// sink). Set WOC_BURN_BPS < 10000 and WOC_TREASURY to split the remainder to a
// treasury address. Always: burned + treasury-credited must cover the price.
export const WOC_BURN_BPS = clampInt(process.env.WOC_BURN_BPS, 10000, 0, 10000);
export const WOC_TREASURY = (process.env.WOC_TREASURY ?? '').trim() || null;

const TEN = 10n;
function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= TEN;
  return r;
}
const BASE_UNIT = pow10(WOC_DECIMALS);

/** Convert a human-readable $WOC amount to integer base units. */
export function wocToBase(human: number): bigint {
  if (!Number.isFinite(human) || human < 0) return 0n;
  // Round to the nearest base unit; prices are whole-ish so this is exact in
  // practice, and we never want a fractional-unit threshold the client can't hit.
  return BigInt(Math.round(human * Number(BASE_UNIT)));
}

// Feature prices in human $WOC (env-overridable; placeholders — tune before any
// mainnet launch). Each is also exposed in base units.
export type WocPriceKey = 'rename_character' | 'rename_guild' | 'reserve_name' | 'sns_subdomain';

const PRICE_HUMAN: Record<WocPriceKey, number> = {
  rename_character: numEnv(process.env.WOC_PRICE_RENAME_CHARACTER, 500),
  rename_guild: numEnv(process.env.WOC_PRICE_RENAME_GUILD, 2500),
  reserve_name: numEnv(process.env.WOC_PRICE_RESERVE, 1000),
  sns_subdomain: numEnv(process.env.WOC_PRICE_SUBDOMAIN, 1000),
};

export function wocPriceHuman(key: WocPriceKey): number {
  return PRICE_HUMAN[key];
}

export function wocPriceBase(key: WocPriceKey): bigint {
  return wocToBase(PRICE_HUMAN[key]);
}

/** Split a price into the burn and treasury portions (base units). */
export function splitPrice(priceBase: bigint): { burnBase: bigint; treasuryBase: bigint } {
  const burnBase = (priceBase * BigInt(WOC_BURN_BPS)) / 10000n;
  return { burnBase, treasuryBase: priceBase - burnBase };
}

function numEnv(v: string | undefined, dflt: number): number {
  if (v === undefined) return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function clampInt(v: string | undefined, dflt: number, lo: number, hi: number): number {
  if (v === undefined) return dflt;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
