// Pure view-core for the Trading Bots window (rent a SOL/WOC trading bot,
// fund its vault, run it).
//
// DOM/Three/i18n-free (UI_PURE_CORES-registered): it owns the screen
// derivation (catalog -> fund -> dashboard from the /api/tradingbots/status
// aggregate), the one-async-op-at-a-time state machine (idle -> requesting ->
// signing -> confirming -> done | error) with monotonic seq guards so a stale
// completion can never overwrite newer state, the exact base-unit deposit
// bounds validation (bigint/string arithmetic via the dex_swap_view math, no
// float ever touches an integer amount), the rate-limit cooldown, and the
// PnL / remaining-rental display derivations. Time is INJECTED (callers pass
// nowMs); this module never reads a clock. The thin DOM consumer is
// trading_bots_window.ts.

import { formatBaseUnits, parseAmountToBaseUnits } from './dex_swap_view';

// ---------------------------------------------------------------------------
// Wire shapes (the service payloads the proxy relays verbatim; the contract
// table lives in docs/prd/woc/trading-bots.md). All amounts are base-unit
// digit strings.
// ---------------------------------------------------------------------------

/** One strategy param slot in a SKU's schema, rendered as a bounded input. */
export interface TradingBotParamSpec {
  key: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/** One rentable bot product, as served by GET /api/tradingbots/config. */
export interface TradingBotSku {
  id: string;
  /** Monthly rental price in $WOC base units. */
  priceWocBaseUnits: string;
  /** Monthly rental price in Claudium (an integer service-ledger amount). */
  priceClaudium: number;
  minDepositSol: string;
  maxDepositSol: string;
  minDepositWoc: string;
  maxDepositWoc: string;
  params: TradingBotParamSpec[];
}

/** The /api/tradingbots/config payload the window boots from. */
export interface TradingBotsConfig {
  enabled: boolean;
  wocMint: string;
  wocDecimals: number;
  solDecimals: number;
  claudiumEnabled: boolean;
  skus: TradingBotSku[];
}

/** The player's live rental, or null when none. */
export interface TradingBotSubscription {
  skuId: string;
  activeUntilMs: number;
}

/** The vault pair balances, base-unit digit strings. */
export interface TradingBotVault {
  sol: string;
  woc: string;
}

/** The bot's run state + current strategy params. */
export interface TradingBotState {
  state: 'running' | 'paused';
  params: Record<string, number>;
}

/** One executed swap in the recent-trades list. */
export interface TradingBotTrade {
  tsMs: number;
  side: 'buy' | 'sell';
  inAmount: string;
  inMint: string;
  outAmount: string;
  outMint: string;
  signature: string;
}

/** The PnL summary line ({periodDays}d window, signed WOC delta + bps). */
export interface TradingBotPnl {
  periodDays: number;
  wocBaseUnits: string;
  bps: number;
}

/** The GET /api/tradingbots/status aggregate driving the whole window. */
export interface TradingBotsStatus {
  subscription: TradingBotSubscription | null;
  claudiumBalance: number;
  vault: TradingBotVault | null;
  bot: TradingBotState | null;
  trades: TradingBotTrade[];
  pnl: TradingBotPnl | null;
}

// ---------------------------------------------------------------------------
// Catalog. SKU names/blurbs are client-side t() keys by stable id (the service
// config carries only ids + numbers), so an id this build does not know cannot
// be rendered and is hidden until a client release adds its strings.
// ---------------------------------------------------------------------------

/** The SKU ids this build carries localized names/blurbs for. */
export const KNOWN_SKU_IDS = ['grid', 'dca', 'momentum'] as const;
export type KnownSkuId = (typeof KNOWN_SKU_IDS)[number];

/** True when this build can render the SKU (it has i18n for the id). */
export function isKnownSkuId(id: string): id is KnownSkuId {
  return (KNOWN_SKU_IDS as readonly string[]).includes(id);
}

/** The config's SKUs this build can render, in service order. */
export function visibleSkus(config: TradingBotsConfig): TradingBotSku[] {
  return config.skus.filter((sku) => isKnownSkuId(sku.id));
}

/** The SKU for an id, or null when the config does not carry it. */
export function skuForId(config: TradingBotsConfig, id: string): TradingBotSku | null {
  return config.skus.find((sku) => sku.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Screen derivation. One aggregate read decides which of the three primary
// screens the window shows; the transient subscribe/withdraw flows are op
// state, not screen state.
// ---------------------------------------------------------------------------

export type TradingBotsScreen = 'catalog' | 'fund' | 'dashboard';

/** True when the vault holds nothing (absent, or both legs zero). */
export function isVaultEmpty(vault: TradingBotVault | null): boolean {
  if (vault === null) return true;
  const sol = /^\d+$/.test(vault.sol) ? BigInt(vault.sol) : 0n;
  const woc = /^\d+$/.test(vault.woc) ? BigInt(vault.woc) : 0n;
  return sol === 0n && woc === 0n;
}

/**
 * Which screen the status aggregate lands on: no rental -> the catalog; a
 * rental with an empty vault -> the funding screen; a funded rental -> the
 * dashboard. A null status (not yet loaded) stays on the catalog.
 */
export function screenForStatus(status: TradingBotsStatus | null): TradingBotsScreen {
  if (!status || status.subscription === null) return 'catalog';
  if (isVaultEmpty(status.vault)) return 'fund';
  return 'dashboard';
}

// ---------------------------------------------------------------------------
// Op state machine. The window runs ONE async money/control operation at a
// time; transitions are pure (state in, state out) and every async completion
// carries the seq issued when its request began, so a stale response (the
// player reset or started another op mid-flight) can never overwrite newer
// state.
// ---------------------------------------------------------------------------

export type TradingBotsOpKind = 'subscribe' | 'deposit' | 'withdraw' | 'control';

export type TradingBotsOpPhase =
  | 'idle'
  | 'requesting'
  | 'signing'
  | 'confirming'
  | 'done'
  | 'error';

export interface TradingBotsOpState {
  phase: TradingBotsOpPhase;
  /** Which operation is in flight (meaningful outside 'idle'). */
  kind: TradingBotsOpKind | null;
  /** A stable error code the window maps to a localized message (phase 'error'). */
  errorCode: string | null;
  /** Injected-clock timestamp until which op actions stay locked (429). */
  cooldownUntilMs: number | null;
  /** Monotonic request guard: completions must match to apply. */
  seq: number;
}

export function createTradingBotsOpState(): TradingBotsOpState {
  return { phase: 'idle', kind: null, errorCode: null, cooldownUntilMs: null, seq: 0 };
}

/** Start an operation; the returned seq must ride with its completions. */
export function beginOp(state: TradingBotsOpState, kind: TradingBotsOpKind): TradingBotsOpState {
  return {
    phase: 'requesting',
    kind,
    errorCode: null,
    cooldownUntilMs: null,
    seq: state.seq + 1,
  };
}

/** The unsigned transaction arrived; the wallet approval is now pending. */
export function opSigning(state: TradingBotsOpState, seq: number): TradingBotsOpState {
  if (state.seq !== seq || state.phase !== 'requesting') return state;
  return { ...state, phase: 'signing' };
}

/** The wallet sent the transaction; the service-side confirm is now pending. */
export function opConfirming(state: TradingBotsOpState, seq: number): TradingBotsOpState {
  if (state.seq !== seq || state.phase !== 'signing') return state;
  return { ...state, phase: 'confirming' };
}

/** The operation completed (from any in-flight phase); stale seq no-ops. */
export function opDone(state: TradingBotsOpState, seq: number): TradingBotsOpState {
  if (state.seq !== seq || !isOpInFlight(state)) return state;
  return { ...state, phase: 'done' };
}

/** The operation failed (from any in-flight phase); stale seq no-ops. */
export function opFailed(
  state: TradingBotsOpState,
  seq: number,
  errorCode: string,
): TradingBotsOpState {
  if (state.seq !== seq || !isOpInFlight(state)) return state;
  return { ...state, phase: 'error', errorCode };
}

/** True while a request/sign/confirm leg is pending (actions stay disabled). */
export function isOpInFlight(state: TradingBotsOpState): boolean {
  return state.phase === 'requesting' || state.phase === 'signing' || state.phase === 'confirming';
}

/** Back to idle (keeps the seq so in-flight completions stay dead). */
export function resetOp(state: TradingBotsOpState): TradingBotsOpState {
  return { ...createTradingBotsOpState(), seq: state.seq + 1 };
}

// ---------------------------------------------------------------------------
// Rate-limit cooldown. A 429 carries retryAfterMs; the window locks the op
// buttons until the injected clock passes cooldownUntilMs, rendering the
// remaining seconds. Mirrors the dex swap window's cooldown contract.
// ---------------------------------------------------------------------------

/** The stable error tag a rate-limit failure sets (localized as a cooldown). */
export const ERR_RATE_LIMITED = 'rate_limited';

/** Apply a rate-limit refusal to the in-flight op; a stale seq is a no-op. */
export function opRateLimited(
  state: TradingBotsOpState,
  seq: number,
  retryAfterMs: number,
  nowMs: number,
): TradingBotsOpState {
  if (state.seq !== seq || !isOpInFlight(state)) return state;
  const waitMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 60_000;
  return {
    ...state,
    phase: 'error',
    errorCode: ERR_RATE_LIMITED,
    cooldownUntilMs: nowMs + waitMs,
  };
}

/** Milliseconds of cooldown left (0 when none or already elapsed). */
export function cooldownRemainingMs(state: TradingBotsOpState, nowMs: number): number {
  if (state.cooldownUntilMs === null) return 0;
  return Math.max(0, state.cooldownUntilMs - nowMs);
}

/** Whole seconds of cooldown left, for the countdown line (at least 1 while live). */
export function cooldownRemainingSeconds(state: TradingBotsOpState, nowMs: number): number {
  return Math.ceil(cooldownRemainingMs(state, nowMs) / 1000);
}

/** True while op actions must stay disabled. */
export function isCoolingDown(state: TradingBotsOpState, nowMs: number): boolean {
  return cooldownRemainingMs(state, nowMs) > 0;
}

/** Clear an elapsed cooldown (back to idle); a live cooldown is kept as-is. */
export function clearElapsedCooldown(state: TradingBotsOpState, nowMs: number): TradingBotsOpState {
  if (state.cooldownUntilMs === null || isCoolingDown(state, nowMs)) return state;
  return resetOp(state);
}

// ---------------------------------------------------------------------------
// Deposit validation. Exact bigint math over base-unit digit strings; the
// service re-validates, so this is a UX gate, never the authority.
// ---------------------------------------------------------------------------

export type DepositFieldError = 'invalid' | 'out_of_bounds';

export type DepositValidation =
  | { ok: true; solBaseUnits: string; wocBaseUnits: string }
  | { ok: false; field: 'sol' | 'woc'; reason: DepositFieldError };

/** True when min <= amount <= max, all base-unit digit strings. */
export function amountWithinBounds(baseUnits: string, min: string, max: string): boolean {
  if (!/^\d+$/.test(baseUnits) || !/^\d+$/.test(min) || !/^\d+$/.test(max)) return false;
  const amount = BigInt(baseUnits);
  return amount >= BigInt(min) && amount <= BigInt(max);
}

/**
 * Validate the typed SOL + WOC deposit pair against the SKU's bounds. Parsing
 * is exact (dex_swap_view.parseAmountToBaseUnits); the first failing field is
 * reported so the window can focus it.
 */
export function validateDeposit(
  sku: TradingBotSku,
  config: TradingBotsConfig,
  solText: string,
  wocText: string,
): DepositValidation {
  const solBaseUnits = parseAmountToBaseUnits(solText, config.solDecimals);
  if (solBaseUnits === null) return { ok: false, field: 'sol', reason: 'invalid' };
  if (!amountWithinBounds(solBaseUnits, sku.minDepositSol, sku.maxDepositSol)) {
    return { ok: false, field: 'sol', reason: 'out_of_bounds' };
  }
  const wocBaseUnits = parseAmountToBaseUnits(wocText, config.wocDecimals);
  if (wocBaseUnits === null) return { ok: false, field: 'woc', reason: 'invalid' };
  if (!amountWithinBounds(wocBaseUnits, sku.minDepositWoc, sku.maxDepositWoc)) {
    return { ok: false, field: 'woc', reason: 'out_of_bounds' };
  }
  return { ok: true, solBaseUnits, wocBaseUnits };
}

/** The localized bounds hint pair for one deposit leg ('0.1' to '5'). */
export function depositBoundsText(
  min: string,
  max: string,
  decimals: number,
  groupInt?: (intDigits: string) => string,
): { min: string; max: string } | null {
  const minText = formatBaseUnits(min, decimals, groupInt);
  const maxText = formatBaseUnits(max, decimals, groupInt);
  if (minText === null || maxText === null) return null;
  return { min: minText, max: maxText };
}

// ---------------------------------------------------------------------------
// Strategy params. Bounded numeric inputs; the service owns the schema, this
// clamps for UX only.
// ---------------------------------------------------------------------------

/** Clamp a typed param value into its spec's bounds, snapped to the step. */
export function clampParam(spec: TradingBotParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  const step = spec.step > 0 ? spec.step : 1;
  const snapped = spec.min + Math.round((value - spec.min) / step) * step;
  return Math.min(spec.max, Math.max(spec.min, snapped));
}

/** The effective param values: the bot's current ones over the spec defaults. */
export function effectiveParams(
  sku: TradingBotSku,
  bot: TradingBotState | null,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const spec of sku.params) {
    const current = bot?.params[spec.key];
    values[spec.key] = typeof current === 'number' ? clampParam(spec, current) : spec.default;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Display derivations. Integer math; formatters are injected by the window.
// ---------------------------------------------------------------------------

/**
 * A basis-points value as a signed percent string ('+2.3', '-0.05', '0');
 * exact integer math, trailing fractional zeros trimmed.
 */
export function signedPercentText(bps: number): string | null {
  if (!Number.isInteger(bps) || Math.abs(bps) > 1_000_000) return null;
  if (bps === 0) return '0';
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const digits =
    frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0+$/, '')}`;
  return `${bps > 0 ? '+' : '-'}${digits}`;
}

/**
 * The signed exact $WOC delta for the PnL line ('+1200', '-0.5'), or null when
 * malformed. The magnitude rides a base-unit digit string; an explicit leading
 * '-' marks a loss (the service encodes sign in the string).
 */
export function signedWocText(
  wocBaseUnits: string,
  decimals: number,
  groupInt?: (intDigits: string) => string,
): string | null {
  const negative = wocBaseUnits.startsWith('-');
  const magnitude = negative ? wocBaseUnits.slice(1) : wocBaseUnits;
  const text = formatBaseUnits(magnitude, decimals, groupInt);
  if (text === null) return null;
  if (text === '0') return '0';
  return negative ? `-${text}` : `+${text}`;
}

/** Whole days of rental left (ceiling; 0 once expired). */
export function rentalDaysLeft(subscription: TradingBotSubscription, nowMs: number): number {
  return Math.max(0, Math.ceil((subscription.activeUntilMs - nowMs) / 86_400_000));
}

/** True once the rental lapsed (the dashboard shows renew + withdraw only). */
export function isRentalExpired(subscription: TradingBotSubscription, nowMs: number): boolean {
  return subscription.activeUntilMs <= nowMs;
}
