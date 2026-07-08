// Buy $WOC off the DEX in game: the server-side Jupiter Swap API proxy.
//
// Non-custodial by construction: this module never signs, never holds keys or
// funds, and never broadcasts. It validates the client's swap inputs, PINS the
// output mint to WOC_MINT server-side (the client cannot choose what it buys),
// and forwards to the Jupiter Swap API (quote + swap-transaction build). The
// player's own wallet signs and sends the returned transaction via the Wallet
// Standard SolanaSignAndSendTransaction feature (src/net/wallet.ts).
//
// Fail-closed: every endpoint refuses with a stable 404 code unless
// WOC_DEX_SWAP_ENABLED=1 is set in the server environment. No platform fee is
// taken (Jupiter platformFeeBps is deliberately NOT set; adding a treasury fee
// is a money-policy decision left to the maintainers).
//
// The upstream fetch is an INJECTED dependency (configureDexSwapRuntime) so the
// tests drive a fake Jupiter with zero network. Upstream non-200s propagate as
// a typed dex_swap.upstream_error carrying the upstream status + error string,
// never swallowed. $WOC's on-chain decimals are read once via the same
// SOLANA_RPC_URL config server/woc_balance.ts uses (getTokenSupply) and cached
// in-module for the client's display math.

import { HttpError } from './http/errors';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json, readBody } from './http_util';
import { isSolanaAddress } from './wallet_link';

// The two payment tokens a player may swap INTO $WOC. Wrapped SOL (Jupiter
// unwraps via wrapAndUnwrapSol) and mainnet USDC. Server-side allowlist: any
// other input mint is rejected before an upstream call is made.
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const DEX_SWAP_INPUTS = [
  { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
] as const;

// Slippage ceiling fallback (basis points) when DEX_SWAP_MAX_SLIPPAGE_BPS is
// unset, and the amount digit bound (a 20-digit base-unit amount already
// exceeds any real supply; longer strings are rejected before BigInt work).
export const DEFAULT_MAX_SLIPPAGE_BPS = 500;
export const MAX_AMOUNT_DIGITS = 20;
// Upstream error strings are truncated to this length before they ride the
// typed error params (enough to diagnose, bounded so a hostile upstream body
// cannot bloat the response).
export const UPSTREAM_ERROR_MAX_CHARS = 300;
// Jupiter's stable no-route error code (quote has no path to $WOC, e.g. an
// unpooled mint or an amount too large for the pool). Surfaced as its own
// typed code so the client renders a real "no liquidity" state.
const JUPITER_NO_ROUTE_CODE = 'COULD_NOT_FIND_ANY_ROUTE';

// ---------------------------------------------------------------------------
// Env config. All reads are lazy (per request) so the flag and bounds can be
// flipped without module-reload ceremony and the tests can drive both states.
// The mint + RPC URL mirror server/woc_balance.ts exactly (same names, same
// local-dev VITE_ fallback, same defaults): woc_balance stays the sanctioned
// Solana RPC touchpoint and this module reuses its configuration.
// ---------------------------------------------------------------------------

function dexSwapEnabled(): boolean {
  return (process.env.WOC_DEX_SWAP_ENABLED ?? '').trim() === '1';
}

function wocMint(): string {
  return (
    process.env.WOC_MINT ??
    process.env.VITE_WOC_MINT ??
    '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth'
  ).trim();
}

function solanaRpcUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.VITE_SOLANA_RPC_URL ??
    'https://api.mainnet-beta.solana.com'
  ).trim();
}

function jupiterBaseUrl(): string {
  const raw = (process.env.JUPITER_BASE_URL ?? 'https://lite-api.jup.ag').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function jupiterApiKey(): string | null {
  const raw = (process.env.JUPITER_API_KEY ?? '').trim();
  return raw ? raw : null;
}

export function maxSlippageBps(): number {
  const raw = Number((process.env.DEX_SWAP_MAX_SLIPPAGE_BPS ?? '').trim());
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_SLIPPAGE_BPS;
}

// ---------------------------------------------------------------------------
// Injected upstream fetch. registry.ts spreads the static `routes` array, so
// the runtime is swappable after load: tests install a fake Jupiter + fake RPC
// via configureDexSwapRuntime and reset with resetDexSwapRuntimeForTests. The
// default binds the global fetch (bound lazily so a test-installed global
// fetch stub would also be honored).
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface DexSwapRuntime {
  fetchImpl: FetchLike;
}

const DEFAULT_RUNTIME: DexSwapRuntime = {
  fetchImpl: (url, init) => fetch(url, init),
};

let runtime: DexSwapRuntime = DEFAULT_RUNTIME;
let cachedWocDecimals: number | null = null;

/** Install an upstream fetch implementation (tests: a fake Jupiter + fake RPC). */
export function configureDexSwapRuntime(overrides: Partial<DexSwapRuntime>): void {
  runtime = { ...runtime, ...overrides };
}

/** Restore the real fetch runtime and drop the cached $WOC decimals (test-only). */
export function resetDexSwapRuntimeForTests(): void {
  runtime = DEFAULT_RUNTIME;
  cachedWocDecimals = null;
}

// ---------------------------------------------------------------------------
// Typed failures. Every reject is a stable HttpError code the client localizes
// (apiError.dex_swap.*); the server emits the CODE, never English prose.
// ---------------------------------------------------------------------------

function disabledError(): HttpError {
  return new HttpError(404, 'dex_swap.disabled');
}

function upstreamError(status: number, errorText: string): HttpError {
  return new HttpError(502, 'dex_swap.upstream_error', {
    upstreamStatus: status,
    upstreamError: errorText.slice(0, UPSTREAM_ERROR_MAX_CHARS),
  });
}

/** Fail-closed feature gate: every dexswap endpoint 404s unless the flag is 1. */
const dexSwapGate: Middleware = async (_ctx, next) => {
  if (!dexSwapEnabled()) throw disabledError();
  await next();
};

// ---------------------------------------------------------------------------
// Input validation helpers (pure).
// ---------------------------------------------------------------------------

function allowedInputMint(mint: unknown): mint is string {
  return typeof mint === 'string' && DEX_SWAP_INPUTS.some((input) => input.mint === mint);
}

/**
 * A positive integer base-unit amount, as the canonical digit string. Rejects
 * signs, decimals, exponents, leading zeros, zero itself, and anything longer
 * than MAX_AMOUNT_DIGITS, so the value forwarded upstream is exactly what a
 * u64-ish token amount can be. String in, string out: no float ever touches it.
 */
export function parseAmountParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed) || trimmed.length > MAX_AMOUNT_DIGITS) return null;
  return trimmed;
}

/** An integer slippage in 1..maxSlippageBps(), or null. */
export function parseSlippageParam(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= maxSlippageBps() ? value : null;
}

/** The single string value of a query param ('' and arrays reject downstream). */
function queryParam(ctx: Ctx, key: string): unknown {
  const value = ctx.query[key];
  return Array.isArray(value) ? value[0] : value;
}

// ---------------------------------------------------------------------------
// Upstream calls.
// ---------------------------------------------------------------------------

function jupiterHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(extra ?? {}) };
  const key = jupiterApiKey();
  if (key) headers['x-api-key'] = key;
  return headers;
}

/**
 * Map a Jupiter non-200 to the typed failure: the stable no-route code becomes
 * dex_swap.no_route (a real player-facing "no liquidity" state), anything else
 * propagates as dex_swap.upstream_error with the upstream status + error text.
 */
function jupiterFailure(status: number, bodyText: string): HttpError {
  let errorText = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; errorCode?: unknown };
    if (parsed && typeof parsed === 'object') {
      if (parsed.errorCode === JUPITER_NO_ROUTE_CODE) {
        return new HttpError(400, 'dex_swap.no_route');
      }
      if (typeof parsed.error === 'string' && parsed.error) errorText = parsed.error;
    }
  } catch {
    // Not JSON: keep the raw body text as the upstream error string.
  }
  return upstreamError(status, errorText);
}

/**
 * $WOC's on-chain decimals via getTokenSupply(WOC_MINT), read once and cached.
 * Uses the injected fetch against the same SOLANA_RPC_URL woc_balance.ts reads,
 * so the RPC endpoint (and any key in it) stays server-side. A failed read is a
 * typed upstream error: the config endpoint does not answer with made-up math.
 */
async function wocDecimals(): Promise<number> {
  if (cachedWocDecimals !== null) return cachedWocDecimals;
  const res = await runtime.fetchImpl(solanaRpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenSupply',
      params: [wocMint()],
    }),
  });
  if (!res.ok) throw upstreamError(res.status, await res.text());
  const data = (await res.json()) as { result?: { value?: { decimals?: unknown } } };
  const decimals = data?.result?.value?.decimals;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw upstreamError(res.status, 'getTokenSupply returned no decimals');
  cachedWocDecimals = decimals;
  return decimals;
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/**
 * GET /api/dexswap/config: everything the client UI needs to render the buy
 * window (the pinned output mint + its decimals, the input allowlist with
 * decimals for display math, and the slippage ceiling). Reached only when the
 * gate passed, so enabled is true by construction.
 */
async function configHandler(ctx: Ctx): Promise<void> {
  const decimals = await wocDecimals();
  return json(ctx.res, 200, {
    enabled: true,
    wocMint: wocMint(),
    wocDecimals: decimals,
    inputs: DEX_SWAP_INPUTS,
    maxSlippageBps: maxSlippageBps(),
  });
}

/**
 * GET /api/dexswap/quote?inputMint&amount&slippageBps: validate against the
 * allowlist + bounds, then proxy Jupiter's quote with outputMint pinned to
 * WOC_MINT and swapMode=ExactIn, both set HERE so the client cannot choose
 * them. Returns Jupiter's quoteResponse verbatim (the client derives price
 * impact + minimum received from it and posts it back to /swap).
 */
async function quoteHandler(ctx: Ctx): Promise<void> {
  const inputMint = queryParam(ctx, 'inputMint');
  if (!allowedInputMint(inputMint)) throw new HttpError(400, 'dex_swap.input_not_allowed');
  const amount = parseAmountParam(queryParam(ctx, 'amount'));
  if (amount === null) throw new HttpError(400, 'dex_swap.invalid_amount');
  const slippageBps = parseSlippageParam(queryParam(ctx, 'slippageBps'));
  if (slippageBps === null) throw new HttpError(400, 'dex_swap.invalid_slippage');

  const params = new URLSearchParams({
    inputMint,
    outputMint: wocMint(),
    amount,
    slippageBps: String(slippageBps),
    swapMode: 'ExactIn',
  });
  const res = await runtime.fetchImpl(`${jupiterBaseUrl()}/swap/v1/quote?${params.toString()}`, {
    method: 'GET',
    headers: jupiterHeaders(),
  });
  if (!res.ok) throw jupiterFailure(res.status, await res.text());
  const quoteResponse: unknown = await res.json();
  return json(ctx.res, 200, quoteResponse);
}

/**
 * POST /api/dexswap/swap { quoteResponse, userPublicKey }: re-validate the
 * quote's mints (the allowlisted input AND the pinned $WOC output; a tampered
 * outputMint is rejected with a typed error, so this proxy can never be used
 * to build a swap into another token), check the pubkey shape, then proxy
 * Jupiter's swap-transaction build. wrapAndUnwrapSol keeps native SOL usable
 * without a manual wSOL account; dynamicComputeUnitLimit right-sizes the CU
 * budget. Returns { swapTransaction } (a base64 serialized transaction) for the
 * WALLET to sign and send: no key or signature ever exists server-side.
 */
async function swapHandler(ctx: Ctx): Promise<void> {
  const body = await readBody(ctx.req);
  const quoteResponse = body.quoteResponse as Record<string, unknown> | undefined;
  if (!quoteResponse || typeof quoteResponse !== 'object' || Array.isArray(quoteResponse)) {
    throw new HttpError(400, 'dex_swap.quote_tampered');
  }
  if (!allowedInputMint(quoteResponse.inputMint)) {
    throw new HttpError(400, 'dex_swap.input_not_allowed');
  }
  if (quoteResponse.outputMint !== wocMint()) {
    throw new HttpError(400, 'dex_swap.quote_tampered');
  }
  const userPublicKey = body.userPublicKey;
  if (!isSolanaAddress(userPublicKey)) throw new HttpError(400, 'dex_swap.invalid_public_key');

  const res = await runtime.fetchImpl(`${jupiterBaseUrl()}/swap/v1/swap`, {
    method: 'POST',
    headers: jupiterHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
    }),
  });
  if (!res.ok) throw jupiterFailure(res.status, await res.text());
  const data = (await res.json()) as { swapTransaction?: unknown };
  if (typeof data?.swapTransaction !== 'string' || !data.swapTransaction) {
    throw upstreamError(res.status, 'swap build returned no transaction');
  }
  return json(ctx.res, 200, { swapTransaction: data.swapTransaction });
}

// ---------------------------------------------------------------------------
// The route table. All three are gate-first (fail-closed 404 when the flag is
// off). Public like GET /api/woc/balance: quotes read public market data, the
// swap build binds only to the caller's own pubkey and returns an unsigned
// transaction only that pubkey's wallet can execute; the server keeps no
// custody and no account linkage is required to buy.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/dexswap/config',
    surface: 'api',
    middleware: [dexSwapGate],
    handler: configHandler,
  },
  {
    method: 'GET',
    path: '/api/dexswap/quote',
    surface: 'api',
    middleware: [dexSwapGate],
    handler: quoteHandler,
  },
  {
    method: 'POST',
    path: '/api/dexswap/swap',
    surface: 'api',
    middleware: [dexSwapGate],
    handler: swapHandler,
  },
];
