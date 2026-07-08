// Buy $WOC off the DEX in game: the THIN authenticated proxy to the economy
// service (woc-daily-rewards-service), which owns the entire Jupiter
// integration (mint pinning, amount/slippage validation, the platform-fee
// policy, and per-player rate limits) behind its /v1/dexswap routes. This
// module deliberately contains ZERO Jupiter/crypto logic: no upstream URL, no
// mint allowlist, no fee math. Single source of truth = the service.
//
// Non-custodial by construction: neither layer signs, holds keys or funds, or
// broadcasts. The service returns an unsigned transaction the player's own
// wallet signs and sends via the Wallet Standard (src/net/wallet.ts).
//
// Fail-closed twice over: every endpoint refuses with a stable 404 code unless
// this server's OWN WOC_DEX_SWAP_ENABLED=1 is set AND the service connection
// (ECONOMY_SERVICE_URL + WOC_ECONOMY_INTERNAL_SECRET) is configured; the
// service keeps its own independent flag, so both layers default OFF.
//
// Auth: quote and swap require a bearer session (the per-player rate limits
// key on it); the authenticated account id is forwarded as x-woc-player-id,
// used by the service ONLY for rate limiting. Config stays a public read (the
// client fetches it at boot, before login, to decide launcher visibility).
//
// The service fetch is an INJECTED dependency (configureDexSwapRuntime) so the
// tests drive a fake economy service with zero network. Service error codes
// map onto this server's stable dex_swap.* codes (the client localizes them
// code-first); unknown codes and transport failures surface as
// dex_swap.upstream_error, never swallowed.

import type { ErrorCode } from './http/error_codes';
import { HttpError } from './http/errors';
import { type RequireAccountDeps, requireAccount } from './http/middleware/require_account';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json, readBody } from './http_util';

// Upstream error strings are truncated to this length before they ride the
// typed error params (enough to diagnose, bounded so a hostile body cannot
// bloat the response).
export const UPSTREAM_ERROR_MAX_CHARS = 300;

// ---------------------------------------------------------------------------
// Env config. All reads are lazy (per request) so the flag and service target
// can be flipped without module-reload ceremony and the tests drive both
// states. The secret name matches the service's front door exactly.
// ---------------------------------------------------------------------------

function dexSwapEnabled(): boolean {
  return (process.env.WOC_DEX_SWAP_ENABLED ?? '').trim() === '1';
}

function economyServiceUrl(): string | null {
  const raw = (process.env.ECONOMY_SERVICE_URL ?? '').trim();
  if (!raw) return null;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function economySecret(): string | null {
  const raw = (process.env.WOC_ECONOMY_INTERNAL_SECRET ?? '').trim();
  return raw ? raw : null;
}

// ---------------------------------------------------------------------------
// Injected runtime: the service fetch (tests: a fake economy service) and the
// auth deps (tests: an injected token lookup so no Postgres is touched).
// registry.ts spreads the static `routes` array, so the runtime is swappable
// after load.
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface DexSwapRuntime {
  fetchImpl: FetchLike;
  authDeps: Omit<RequireAccountDeps, 'scope'>;
}

const DEFAULT_RUNTIME: DexSwapRuntime = {
  fetchImpl: (url, init) => fetch(url, init),
  authDeps: {},
};

let runtime: DexSwapRuntime = DEFAULT_RUNTIME;

/** Install a service fetch / auth deps (tests: fake service, fake tokens). */
export function configureDexSwapRuntime(overrides: Partial<DexSwapRuntime>): void {
  runtime = { ...runtime, ...overrides };
}

/** Restore the real fetch + auth runtime (test-only). */
export function resetDexSwapRuntimeForTests(): void {
  runtime = DEFAULT_RUNTIME;
}

// ---------------------------------------------------------------------------
// Gates. Fail-closed: flag off OR an unconfigured service connection is the
// same stable 404 (the feature does not exist), with a dev-channel warning for
// the misconfigured-but-enabled case so ops can tell the two apart.
// ---------------------------------------------------------------------------

let misconfigWarned = false;

const dexSwapGate: Middleware = async (_ctx, next) => {
  if (!dexSwapEnabled()) throw new HttpError(404, 'dex_swap.disabled');
  if (economyServiceUrl() === null || economySecret() === null) {
    if (!misconfigWarned) {
      misconfigWarned = true;
      console.warn(
        '[dexswap] WOC_DEX_SWAP_ENABLED=1 but ECONOMY_SERVICE_URL / ' +
          'WOC_ECONOMY_INTERNAL_SECRET is unset; refusing (fail-closed)',
      );
    }
    throw new HttpError(404, 'dex_swap.disabled');
  }
  await next();
};

/** Bearer auth for quote/swap; the auth deps are injectable for tests. */
const dexSwapAuth: Middleware = async (ctx, next) => {
  await requireAccount({ scope: 'read', ...runtime.authDeps })(ctx, next);
};

// ---------------------------------------------------------------------------
// Service error mapping. The service emits stable codes (packages/sdk
// dexswap.ts in the service repo); each maps onto this server's registered
// dex_swap.* code so the client localizes it code-first. rate_limited carries
// retryAfterMs through for the UI cooldown; upstream_error carries the bounded
// upstream status + text through unchanged.
// ---------------------------------------------------------------------------

const SERVICE_ERROR_MAP: Record<string, { status: number; code: ErrorCode }> = {
  disabled: { status: 404, code: 'dex_swap.disabled' },
  input_not_allowed: { status: 400, code: 'dex_swap.input_not_allowed' },
  invalid_amount: { status: 400, code: 'dex_swap.invalid_amount' },
  invalid_slippage: { status: 400, code: 'dex_swap.invalid_slippage' },
  quote_tampered: { status: 400, code: 'dex_swap.quote_tampered' },
  invalid_public_key: { status: 400, code: 'dex_swap.invalid_public_key' },
  no_route: { status: 400, code: 'dex_swap.no_route' },
};

function truncated(text: unknown): string {
  return String(text ?? '').slice(0, UPSTREAM_ERROR_MAX_CHARS);
}

/** Map a non-2xx service answer onto the stable dex_swap.* HttpError. */
function serviceFailure(status: number, body: Record<string, unknown> | null): HttpError {
  const code = body && typeof body.error === 'string' ? body.error : '';
  if (code === 'rate_limited') {
    const retryAfterMs =
      typeof body?.retryAfterMs === 'number' && body.retryAfterMs > 0
        ? Math.ceil(body.retryAfterMs)
        : 60_000;
    return new HttpError(429, 'dex_swap.rate_limited', { retryAfterMs });
  }
  if (code === 'upstream_error') {
    const upstreamStatus = typeof body?.upstreamStatus === 'number' ? body.upstreamStatus : status;
    return new HttpError(502, 'dex_swap.upstream_error', {
      upstreamStatus,
      upstreamError: truncated(body?.upstreamError),
    });
  }
  const mapped = SERVICE_ERROR_MAP[code];
  if (mapped) return new HttpError(mapped.status, mapped.code);
  // An unknown service code (or an unparseable body): surfaced, never swallowed.
  return new HttpError(502, 'dex_swap.upstream_error', {
    upstreamStatus: status,
    upstreamError: truncated(code || 'unrecognized economy service answer'),
  });
}

/**
 * Forward one call to the economy service with the internal secret (+ the
 * player id when the route is authenticated) and return the parsed 2xx body.
 * A transport failure or a non-2xx answer throws the mapped typed error.
 */
async function forwardToService(
  path: string,
  init: { method: 'GET' | 'POST'; playerId?: string; body?: string },
): Promise<unknown> {
  const base = economyServiceUrl();
  const secret = economySecret();
  if (base === null || secret === null) throw new HttpError(404, 'dex_swap.disabled');
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-woc-economy-secret': secret,
  };
  if (init.playerId !== undefined) headers['x-woc-player-id'] = init.playerId;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await runtime.fetchImpl(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body,
    });
  } catch (err) {
    console.warn('[dexswap] economy service unreachable', err);
    throw new HttpError(502, 'dex_swap.upstream_error', {
      upstreamStatus: 0,
      upstreamError: 'economy service unreachable',
    });
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw serviceFailure(res.status, body);
  if (body === null) {
    throw new HttpError(502, 'dex_swap.upstream_error', {
      upstreamStatus: res.status,
      upstreamError: 'economy service returned no JSON body',
    });
  }
  return body;
}

/** The authenticated account id as the service's rate-limit key. */
function playerIdFor(ctx: Ctx): string {
  const accountId = ctx.account?.accountId;
  // The auth middleware runs before every handler that calls this; a missing
  // account here is a wiring bug, surfaced as a 401 rather than an anon key.
  if (typeof accountId !== 'number') throw new HttpError(401, 'auth.token_missing');
  return String(accountId);
}

/** The single string value of a query param (arrays reject at the service). */
function queryParam(ctx: Ctx, key: string): string {
  const value = ctx.query[key];
  return String(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
}

// ---------------------------------------------------------------------------
// Handlers: parse the wire, forward, relay. No validation beyond shape: the
// service owns the rules, so the two layers can never disagree.
// ---------------------------------------------------------------------------

/**
 * GET /api/dexswap/config: the service's config payload verbatim (pinned mint,
 * decimals, input allowlist, slippage ceiling, feeBps + feeApplied for the
 * fee-disclosure line). Public read: fetched at boot to gate the launcher.
 */
async function configHandler(ctx: Ctx): Promise<void> {
  const body = await forwardToService('/v1/dexswap/config', { method: 'GET' });
  return json(ctx.res, 200, body);
}

/**
 * GET /api/dexswap/quote?inputMint&amount&slippageBps: forwarded with the
 * authenticated player id; returns { quoteResponse, feeBps, feeApplied }.
 */
async function quoteHandler(ctx: Ctx): Promise<void> {
  const search = new URLSearchParams({
    inputMint: queryParam(ctx, 'inputMint'),
    amount: queryParam(ctx, 'amount'),
    slippageBps: queryParam(ctx, 'slippageBps'),
  });
  const body = await forwardToService(`/v1/dexswap/quote?${search.toString()}`, {
    method: 'GET',
    playerId: playerIdFor(ctx),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/dexswap/swap { quoteResponse, userPublicKey }: forwarded verbatim
 * (the service re-validates the mints and pins the output); returns
 * { swapTransaction } for the WALLET to sign and send.
 */
async function swapHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/dexswap/swap', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      quoteResponse: clientBody.quoteResponse,
      userPublicKey: clientBody.userPublicKey,
    }),
  });
  return json(ctx.res, 200, body);
}

// ---------------------------------------------------------------------------
// The route table. All three gate-first (fail-closed 404 when the flag is off
// or the service connection is unconfigured). Config is a public read (boot
// visibility check); quote and swap require a bearer session, whose account id
// keys the service's per-player rate limits.
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
    middleware: [dexSwapGate, dexSwapAuth],
    handler: quoteHandler,
  },
  {
    method: 'POST',
    path: '/api/dexswap/swap',
    surface: 'api',
    middleware: [dexSwapGate, dexSwapAuth],
    handler: swapHandler,
  },
];
