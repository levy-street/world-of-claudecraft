// Central $WOC / Solana commerce config, trimmed to what the voice-NPC feature
// needs: the mint, RPC, decimals, sink routing (burn / treasury split), and this
// feature's price. Mirrors the shared config shape used by the rest of the $WOC
// commerce surface (ad marketplace, identity actions, SNS) so a future merge of
// those features lines up; the SNS/buyback/ad-marketplace sections themselves
// are NOT ported here, they belong to those other features.
//
// Prices are authored in **human-readable $WOC** (env vars) and exposed in token
// **base units** (x 10^decimals) for on-chain math. Server-only module; no SQL,
// no client import.

// The $WOC SPL mint. Prefer the server-only var, fall back to the client's
// VITE_* (loaded from .env.local in dev by db.ts), then the published default,
// mirrors server/woc_balance.ts so a single local config drives everything.
export const WOC_MINT = (
  process.env.WOC_MINT ??
  process.env.VITE_WOC_MINT ??
  '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
).trim();

export const SOLANA_RPC_URL = (
  process.env.SOLANA_RPC_URL ??
  process.env.VITE_SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com'
).trim();

function boolEnv(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

// $WOC token decimals. Most SPL/pump tokens use 6; override if the canonical
// mint differs. Used to convert human prices to base units and to build the
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

/** Split a price into the burn and treasury portions (base units). */
export function splitPrice(priceBase: bigint): { burnBase: bigint; treasuryBase: bigint } {
  const burnBase = (priceBase * BigInt(WOC_BURN_BPS)) / 10000n;
  return { burnBase, treasuryBase: priceBase - burnBase };
}

// ── Voice NPC: "burn $WOC to clone your voice into an NPC" ──────────────────
// A player burns $WOC, records a short voice sample, and an ElevenLabs voice
// clone speaks a few quest lines as a small dynamic NPC. ElevenLabs is a paid
// third-party API with real per-clone/per-character cost, and the burn price
// has no tokenomics sign-off yet, so this whole feature ships OFF by default,
// mirroring how AD_MARKET_ENABLED/SNS_ENABLED gate other money features here.
export const VOICE_NPC_ENABLED = boolEnv(process.env.VOICE_NPC_ENABLED, false);

// TODO(tokenomics): 25000 $WOC is a placeholder, not a priced decision. Tune
// before any mainnet launch: needs a tokenomics sign-off pass that weighs the
// ElevenLabs cloning + synthesis cost against the burn-deflation goal.
export const WOC_PRICE_VOICE_NPC = numEnv(process.env.WOC_PRICE_VOICE_NPC, 25000);

export function wocPriceVoiceNpcHuman(): number {
  return WOC_PRICE_VOICE_NPC;
}

export function wocPriceVoiceNpcBase(): bigint {
  return wocToBase(WOC_PRICE_VOICE_NPC);
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
