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

// ── SNS subdomains + tradeable characters (PR #735) ──────────────────────────
// All of the subdomain/tradeable surface is gated behind these flags and stays
// OFF until the project controls SNS_PARENT_DOMAIN and funds the execution
// wallet. SNS_ENABLED turns on minting; CHARACTER_TRADEABLE additionally makes
// a bound character's controller follow on-chain subdomain ownership.
export const SNS_ENABLED = boolEnv(process.env.SNS_ENABLED, false);
export const CHARACTER_TRADEABLE = boolEnv(process.env.CHARACTER_TRADEABLE, false);
// The project-owned parent domain that subdomains are minted under (no trailing
// .sol needed; normalized to bare label list by sns.ts).
export const SNS_PARENT_DOMAIN = (process.env.SNS_PARENT_DOMAIN ?? 'worldofclaudecraft.sol').trim();
// base58-encoded secret key of the execution wallet that owns SNS_PARENT_DOMAIN
// and co-signs subdomain creation/transfer. The one custodial seam — store it
// encrypted at rest (KMS/SecretVault), never in git. Empty in dev keeps the
// signer unavailable (mint paths refuse rather than using a bogus key).
export const EXECUTION_WALLET_SECRET = (process.env.EXECUTION_WALLET_SECRET ?? '').trim();

// ── Buyback-and-burn engine (PR #736 / #798 / #469 shared core) ──────────────
// A keeper batches USDC accrued from marketplace fees, swaps it to $WOC on a DEX
// aggregator (Jupiter), and burns the proceeds. Off by default; the keeper wallet
// is the only custodial seam and holds nothing but in-flight fee USDC + a little
// SOL. Never promise price/return — this is protocol-owned deflation, not yield.
export const BUYBACK_ENABLED = boolEnv(process.env.BUYBACK_ENABLED, false);
// base58 secret of the keeper wallet that custodies the fee vault USDC, executes
// the swap, and signs the burn. Store via KMS/secret manager; never commit.
export const BUYBACK_KEEPER_SECRET = (process.env.BUYBACK_KEEPER_SECRET ?? '').trim();
// Don't swap dust: only run once at least this much USDC (human units) is pooled.
export const BUYBACK_MIN_BATCH_USDC = numEnv(process.env.BUYBACK_MIN_BATCH_USDC, 50);
// Max acceptable slippage on the USDC→$WOC swap, in basis points (default 1%).
export const BUYBACK_SLIPPAGE_BPS = clampInt(process.env.BUYBACK_SLIPPAGE_BPS, 100, 1, 5000);
export const JUPITER_API = (process.env.JUPITER_API ?? 'https://quote-api.jup.ag').replace(/\/$/, '');
// USDC has 6 decimals on Solana.
export const USDC_DECIMALS = 6;

function boolEnv(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

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
