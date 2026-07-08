// Pure view-core for the in-game "Buy $WOC" DEX swap window.
//
// DOM/Three/i18n-free (UI_PURE_CORES-registered): it owns the swap flow state
// machine (idle -> quoting -> quoted -> signing -> sent | error), the exact
// base-unit <-> decimal display math (bigint/string arithmetic, no float ever
// touches an integer amount), the price-impact + minimum-received derivation
// from a Jupiter quoteResponse, and quote staleness (a quote older than
// QUOTE_TTL_MS must be re-quoted before it may be signed). Time is INJECTED
// (callers pass nowMs); this module never reads a clock. The thin DOM consumer
// is dex_swap_window.ts.

/** One allowed payment token, as served by GET /api/dexswap/config. */
export interface DexSwapInputToken {
  mint: string;
  symbol: string;
  decimals: number;
}

/** The /api/dexswap/config payload the window boots from. */
export interface DexSwapConfig {
  enabled: boolean;
  wocMint: string;
  wocDecimals: number;
  inputs: DexSwapInputToken[];
  maxSlippageBps: number;
}

/** The slice of a Jupiter quoteResponse the view derives its display from. */
export interface DexSwapQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  /** Worst-case output under the quoted slippage (ExactIn): the minimum received. */
  otherAmountThreshold: string;
  /** Price impact as a decimal fraction string (e.g. '0.0012' = 0.12%). */
  priceImpactPct?: string;
  slippageBps?: number;
}

/** A quote older than this must be re-quoted; signing a stale route is refused. */
export const QUOTE_TTL_MS = 20_000;
/** The slippage the window requests, clamped to the server's ceiling. */
export const DEFAULT_SLIPPAGE_BPS = 100;
/** Base-unit digit bound, mirroring the server's MAX_AMOUNT_DIGITS. */
export const MAX_AMOUNT_DIGITS = 20;

/** The slippage to request: the window default, never above the server ceiling. */
export function effectiveSlippageBps(maxSlippageBps: number): number {
  return Math.max(1, Math.min(DEFAULT_SLIPPAGE_BPS, maxSlippageBps));
}

// ---------------------------------------------------------------------------
// State machine. Transitions are pure (state in, state out); async completions
// carry the seq issued when their request began, so a stale response (the
// player re-quoted or reset mid-flight) can never overwrite newer state.
// ---------------------------------------------------------------------------

export type DexSwapPhase = 'idle' | 'quoting' | 'quoted' | 'signing' | 'sent' | 'error';

export interface DexSwapState {
  phase: DexSwapPhase;
  quote: DexSwapQuote | null;
  /** Injected-clock timestamp of when the live quote arrived (staleness anchor). */
  quotedAtMs: number | null;
  /** The confirmed transaction signature (phase 'sent'). */
  signature: string | null;
  /** A stable error code the window maps to a localized message (phase 'error'). */
  errorCode: string | null;
  /** Monotonic request guard: completions must match to apply. */
  seq: number;
}

export function createDexSwapState(): DexSwapState {
  return { phase: 'idle', quote: null, quotedAtMs: null, signature: null, errorCode: null, seq: 0 };
}

/** Start a quote request; the returned seq must ride with its completion. */
export function beginQuote(state: DexSwapState): DexSwapState {
  return {
    phase: 'quoting',
    quote: null,
    quotedAtMs: null,
    signature: null,
    errorCode: null,
    seq: state.seq + 1,
  };
}

/** Apply a quote completion; a stale seq (or a phase that moved on) is a no-op. */
export function quoteReceived(
  state: DexSwapState,
  seq: number,
  quote: DexSwapQuote,
  nowMs: number,
): DexSwapState {
  if (state.seq !== seq || state.phase !== 'quoting') return state;
  return { ...state, phase: 'quoted', quote, quotedAtMs: nowMs };
}

/** Apply a quote failure; a stale seq is a no-op. */
export function quoteFailed(state: DexSwapState, seq: number, errorCode: string): DexSwapState {
  if (state.seq !== seq || state.phase !== 'quoting') return state;
  return { ...state, phase: 'error', quote: null, quotedAtMs: null, errorCode };
}

/** True when the held quote is too old to sign and must be re-quoted. */
export function isQuoteStale(state: DexSwapState, nowMs: number): boolean {
  return state.quotedAtMs === null || nowMs - state.quotedAtMs > QUOTE_TTL_MS;
}

/** True when Buy may proceed: a live, fresh quote is held. */
export function canSign(state: DexSwapState, nowMs: number): boolean {
  return state.phase === 'quoted' && state.quote !== null && !isQuoteStale(state, nowMs);
}

export type BeginSignResult =
  | { ok: true; state: DexSwapState; quote: DexSwapQuote }
  | { ok: false; reason: 'no_quote' | 'stale' };

/**
 * Attempt to enter the signing phase. A stale quote is REFUSED (reason 'stale'):
 * the caller must re-quote; there is no path that signs an expired route.
 */
export function beginSign(state: DexSwapState, nowMs: number): BeginSignResult {
  if (state.phase !== 'quoted' || state.quote === null) return { ok: false, reason: 'no_quote' };
  if (isQuoteStale(state, nowMs)) return { ok: false, reason: 'stale' };
  return {
    ok: true,
    quote: state.quote,
    state: { ...state, phase: 'signing', seq: state.seq + 1 },
  };
}

/** Apply a confirmed send (the wallet returned the signature); stale seq no-ops. */
export function signSent(state: DexSwapState, seq: number, signature: string): DexSwapState {
  if (state.seq !== seq || state.phase !== 'signing') return state;
  return { ...state, phase: 'sent', signature };
}

/** Apply a swap/sign failure; stale seq no-ops. */
export function signFailed(state: DexSwapState, seq: number, errorCode: string): DexSwapState {
  if (state.seq !== seq || state.phase !== 'signing') return state;
  return { ...state, phase: 'error', errorCode };
}

/** Back to idle (keeps the seq so in-flight completions stay dead). */
export function resetDexSwap(state: DexSwapState): DexSwapState {
  return { ...createDexSwapState(), seq: state.seq + 1 };
}

// ---------------------------------------------------------------------------
// Exact display math. Integer amounts move as digit strings + bigint only:
// parsing and formatting are exact for any size, no float drift.
// ---------------------------------------------------------------------------

/**
 * Parse a player-typed decimal amount ('1', '0.5', '.5', '1.25') into an exact
 * base-unit digit string for `decimals`. Returns null for anything invalid:
 * empty, malformed, more fractional digits than the token carries, zero, or a
 * result beyond MAX_AMOUNT_DIGITS. Exact string/bigint math throughout.
 */
export function parseAmountToBaseUnits(text: string, decimals: number): string | null {
  const trimmed = text.trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  if (intPart === '' && fracPart === '') return null;
  if (fracPart.length > decimals) return null;
  const scaled =
    BigInt(intPart || '0') * 10n ** BigInt(decimals) +
    BigInt(fracPart.padEnd(decimals, '0') || '0');
  if (scaled <= 0n) return null;
  const digits = scaled.toString();
  if (digits.length > MAX_AMOUNT_DIGITS) return null;
  return digits;
}

/**
 * Format a base-unit digit string as an exact decimal string for `decimals`,
 * trimming trailing fractional zeros ('1500000' at 6 -> '1.5'). The optional
 * groupInt formatter localizes the INTEGER digits only (grouping separators);
 * the exact digits are computed here, so the injected formatter can never
 * change the value. Returns null for a non-digit input.
 */
export function formatBaseUnits(
  baseUnits: string,
  decimals: number,
  groupInt: (intDigits: string) => string = (digits) => digits,
): string | null {
  if (!/^\d+$/.test(baseUnits) || !Number.isInteger(decimals) || decimals < 0) return null;
  const digits = baseUnits.replace(/^0+/, '') || '0';
  const intDigits = digits.length > decimals ? digits.slice(0, digits.length - decimals) : '0';
  const fracDigits = (
    digits.length > decimals
      ? digits.slice(digits.length - decimals)
      : digits.padStart(decimals, '0')
  ).replace(/0+$/, '');
  const grouped = groupInt(intDigits);
  return fracDigits ? `${grouped}.${fracDigits}` : grouped;
}

/**
 * Price impact for display: Jupiter's decimal-fraction string ('0.0012') to a
 * percent string ('0.12'). Sub-0.01% impacts render as '<0.01' so a tiny trade
 * never shows a misleading flat 0. Returns null when the quote carries none or
 * it is malformed (the window omits the line).
 */
export function priceImpactPercentText(quote: DexSwapQuote): string | null {
  const raw = quote.priceImpactPct;
  if (typeof raw !== 'string' || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw.trim())) return null;
  const fraction = Number(raw);
  if (!Number.isFinite(fraction) || fraction < 0) return null;
  const percent = fraction * 100;
  if (percent === 0) return '0';
  if (percent < 0.01) return '<0.01';
  return percent.toFixed(2);
}

/** The token entry for a mint, or null when the config does not allow it. */
export function inputTokenForMint(config: DexSwapConfig, mint: string): DexSwapInputToken | null {
  return config.inputs.find((input) => input.mint === mint) ?? null;
}

/** The fully derived, formatter-injected display model for a held quote. */
export interface DexSwapQuoteModel {
  paySymbol: string;
  /** Exact decimal amount paid, in the input token's units. */
  payAmount: string;
  /** Exact decimal $WOC amount quoted out. */
  receiveAmount: string;
  /** Exact decimal worst-case $WOC under the quoted slippage. */
  minReceived: string;
  /** Percent string ('0.12', '<0.01'), or null when the quote carries none. */
  priceImpactPct: string | null;
  /** The slippage the quote was built with, in basis points. */
  slippageBps: number;
}

/**
 * Derive the quote panel model: you pay X TOKEN, you receive ~Y $WOC, minimum
 * received (otherAmountThreshold, the worst case under slippage), price impact.
 * Returns null when the quote's mints do not match the config (a malformed or
 * cross-config quote renders nothing rather than wrong numbers).
 */
export function buildQuoteModel(
  quote: DexSwapQuote,
  config: DexSwapConfig,
  groupInt?: (intDigits: string) => string,
): DexSwapQuoteModel | null {
  const input = inputTokenForMint(config, quote.inputMint);
  if (!input || quote.outputMint !== config.wocMint) return null;
  const payAmount = formatBaseUnits(quote.inAmount, input.decimals, groupInt);
  const receiveAmount = formatBaseUnits(quote.outAmount, config.wocDecimals, groupInt);
  const minReceived = formatBaseUnits(quote.otherAmountThreshold, config.wocDecimals, groupInt);
  if (payAmount === null || receiveAmount === null || minReceived === null) return null;
  return {
    paySymbol: input.symbol,
    payAmount,
    receiveAmount,
    minReceived,
    priceImpactPct: priceImpactPercentText(quote),
    slippageBps: quote.slippageBps ?? effectiveSlippageBps(config.maxSlippageBps),
  };
}
