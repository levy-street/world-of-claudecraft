// Rentable SOL/WOC trading bots in game: the THIN authenticated proxy to the
// economy service (woc-daily-rewards-service), which owns the entire bot
// engine (the catalog and pricing, the Claudium ledger, payment verification,
// the per-player vault, the Jupiter strategy loop, billing enforcement, and
// per-player rate limits) behind its /v1/tradingbots routes. This module
// deliberately contains ZERO Jupiter/crypto/custody logic: no upstream URL, no
// catalog, no price math. Single source of truth = the service. The contract
// the service implements is docs/prd/woc/trading-bots.md.
//
// The game server never signs, holds keys or funds, or broadcasts. Where money
// moves (the WOC rental payment, the vault deposit), the service returns an
// unsigned transaction the player's own wallet signs and sends via the Wallet
// Standard (src/net/wallet.ts); the confirm endpoints verify service-side.
//
// Fail-closed twice over: every endpoint refuses with a stable 404 code unless
// this server's OWN WOC_TRADING_BOTS_ENABLED=1 is set AND the service
// connection (ECONOMY_SERVICE_URL + WOC_ECONOMY_INTERNAL_SECRET) is
// configured; the service keeps its own independent flag, so both layers
// default OFF.
//
// Auth: every route except config requires a bearer session. The authenticated
// account id is forwarded as x-woc-player-id; unlike the dexswap family, the
// service uses it as the IDENTITY key for subscription and vault ownership
// (not just rate limiting), which is why the PRD binds withdrawals to the
// account's verified linked wallet. Config stays a public read (the client
// fetches it at boot, before login, to decide launcher visibility).
//
// The service fetch is an INJECTED dependency (configureTradingBotsRuntime) so
// the tests drive a fake economy service with zero network. Service error
// codes map onto this server's stable trading_bots.* codes (the client
// localizes them code-first); unknown codes and transport failures surface as
// trading_bots.upstream_error, never swallowed.

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
// states. The connection pair is shared with the dexswap proxy; only the flag
// is this feature's own.
// ---------------------------------------------------------------------------

function tradingBotsEnabled(): boolean {
  return (process.env.WOC_TRADING_BOTS_ENABLED ?? '').trim() === '1';
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

interface TradingBotsRuntime {
  fetchImpl: FetchLike;
  authDeps: Omit<RequireAccountDeps, 'scope'>;
}

const DEFAULT_RUNTIME: TradingBotsRuntime = {
  fetchImpl: (url, init) => fetch(url, init),
  authDeps: {},
};

let runtime: TradingBotsRuntime = DEFAULT_RUNTIME;

/** Install a service fetch / auth deps (tests: fake service, fake tokens). */
export function configureTradingBotsRuntime(overrides: Partial<TradingBotsRuntime>): void {
  runtime = { ...runtime, ...overrides };
}

/** Restore the real fetch + auth runtime (test-only). */
export function resetTradingBotsRuntimeForTests(): void {
  runtime = DEFAULT_RUNTIME;
}

// ---------------------------------------------------------------------------
// Gates. Fail-closed: flag off OR an unconfigured service connection is the
// same stable 404 (the feature does not exist), with a dev-channel warning for
// the misconfigured-but-enabled case so ops can tell the two apart.
// ---------------------------------------------------------------------------

let misconfigWarned = false;

const tradingBotsGate: Middleware = async (_ctx, next) => {
  if (!tradingBotsEnabled()) throw new HttpError(404, 'trading_bots.disabled');
  if (economyServiceUrl() === null || economySecret() === null) {
    if (!misconfigWarned) {
      misconfigWarned = true;
      console.warn(
        '[tradingbots] WOC_TRADING_BOTS_ENABLED=1 but ECONOMY_SERVICE_URL / ' +
          'WOC_ECONOMY_INTERNAL_SECRET is unset; refusing (fail-closed)',
      );
    }
    throw new HttpError(404, 'trading_bots.disabled');
  }
  await next();
};

/** Bearer auth for everything but config; auth deps injectable for tests. */
const tradingBotsAuth: Middleware = async (ctx, next) => {
  await requireAccount({ scope: 'read', ...runtime.authDeps })(ctx, next);
};

// ---------------------------------------------------------------------------
// Service error mapping. The service emits stable codes (the contract table in
// docs/prd/woc/trading-bots.md); each maps onto this server's registered
// trading_bots.* code so the client localizes it code-first. rate_limited
// carries retryAfterMs through for the UI cooldown; upstream_error carries the
// bounded upstream status + text through unchanged.
// ---------------------------------------------------------------------------

const SERVICE_ERROR_MAP: Record<string, { status: number; code: ErrorCode }> = {
  disabled: { status: 404, code: 'trading_bots.disabled' },
  unknown_sku: { status: 400, code: 'trading_bots.unknown_sku' },
  invalid_pay_currency: { status: 400, code: 'trading_bots.invalid_pay_currency' },
  already_subscribed: { status: 409, code: 'trading_bots.already_subscribed' },
  subscription_required: { status: 403, code: 'trading_bots.subscription_required' },
  subscription_expired: { status: 403, code: 'trading_bots.subscription_expired' },
  insufficient_claudium: { status: 400, code: 'trading_bots.insufficient_claudium' },
  invalid_amount: { status: 400, code: 'trading_bots.invalid_amount' },
  deposit_out_of_bounds: { status: 400, code: 'trading_bots.deposit_out_of_bounds' },
  invalid_public_key: { status: 400, code: 'trading_bots.invalid_public_key' },
  invalid_params: { status: 400, code: 'trading_bots.invalid_params' },
  payment_not_found: { status: 404, code: 'trading_bots.payment_not_found' },
  payment_unverified: { status: 400, code: 'trading_bots.payment_unverified' },
  vault_busy: { status: 409, code: 'trading_bots.vault_busy' },
};

function truncated(text: unknown): string {
  return String(text ?? '').slice(0, UPSTREAM_ERROR_MAX_CHARS);
}

/** Map a non-2xx service answer onto the stable trading_bots.* HttpError. */
function serviceFailure(status: number, body: Record<string, unknown> | null): HttpError {
  const code = body && typeof body.error === 'string' ? body.error : '';
  if (code === 'rate_limited') {
    const retryAfterMs =
      typeof body?.retryAfterMs === 'number' && body.retryAfterMs > 0
        ? Math.ceil(body.retryAfterMs)
        : 60_000;
    return new HttpError(429, 'trading_bots.rate_limited', { retryAfterMs });
  }
  if (code === 'upstream_error') {
    const upstreamStatus = typeof body?.upstreamStatus === 'number' ? body.upstreamStatus : status;
    return new HttpError(502, 'trading_bots.upstream_error', {
      upstreamStatus,
      upstreamError: truncated(body?.upstreamError),
    });
  }
  const mapped = SERVICE_ERROR_MAP[code];
  if (mapped) return new HttpError(mapped.status, mapped.code);
  // An unknown service code (or an unparseable body): surfaced, never swallowed.
  return new HttpError(502, 'trading_bots.upstream_error', {
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
  if (base === null || secret === null) throw new HttpError(404, 'trading_bots.disabled');
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
    console.warn('[tradingbots] economy service unreachable', err);
    throw new HttpError(502, 'trading_bots.upstream_error', {
      upstreamStatus: 0,
      upstreamError: 'economy service unreachable',
    });
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw serviceFailure(res.status, body);
  if (body === null) {
    throw new HttpError(502, 'trading_bots.upstream_error', {
      upstreamStatus: res.status,
      upstreamError: 'economy service returned no JSON body',
    });
  }
  return body;
}

/** The authenticated account id as the service's subscription/vault key. */
function playerIdFor(ctx: Ctx): string {
  const accountId = ctx.account?.accountId;
  // The auth middleware runs before every handler that calls this; a missing
  // account here is a wiring bug, surfaced as a 401 rather than an anon key.
  if (typeof accountId !== 'number') throw new HttpError(401, 'auth.token_missing');
  return String(accountId);
}

// ---------------------------------------------------------------------------
// Handlers: parse the wire, forward, relay. No validation beyond shape: the
// service owns the rules, so the two layers can never disagree. POST bodies
// forward only the contract fields (never the raw client body), so a bloated
// or hostile extra field dies here.
// ---------------------------------------------------------------------------

/**
 * GET /api/tradingbots/config: the service's catalog payload verbatim (SKUs
 * with monthly WOC/Claudium prices, deposit bounds, and param schemas, plus
 * mints/decimals). Public read: fetched at boot to gate the launcher.
 */
async function configHandler(ctx: Ctx): Promise<void> {
  const body = await forwardToService('/v1/tradingbots/config', { method: 'GET' });
  return json(ctx.res, 200, body);
}

/**
 * GET /api/tradingbots/status: the one aggregate read driving the whole
 * window: subscription, Claudium balance, vault balances, bot state + params,
 * recent trades, and the PnL summary.
 */
async function statusHandler(ctx: Ctx): Promise<void> {
  const body = await forwardToService('/v1/tradingbots/status', {
    method: 'GET',
    playerId: playerIdFor(ctx),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/tradingbots/subscribe { skuId, payWith, userPublicKey? }: rent a
 * bot. payWith 'woc' answers { paymentId, paymentTransaction } (unsigned, for
 * the WALLET to sign); payWith 'claudium' debits service-side and answers
 * { subscription } in one call.
 */
async function subscribeHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/tradingbots/subscribe', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      skuId: clientBody.skuId,
      payWith: clientBody.payWith,
      userPublicKey: clientBody.userPublicKey,
    }),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/tradingbots/subscribe/confirm { paymentId, signature }: the
 * service verifies the payment on-chain and activates the rental.
 */
async function subscribeConfirmHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/tradingbots/subscribe/confirm', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      paymentId: clientBody.paymentId,
      signature: clientBody.signature,
    }),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/tradingbots/deposit { solAmount, wocAmount, userPublicKey }:
 * returns { depositId, depositTransaction } (unsigned, for the WALLET to
 * sign) funding the player's segregated vault within the SKU's bounds.
 */
async function depositHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/tradingbots/deposit', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      solAmount: clientBody.solAmount,
      wocAmount: clientBody.wocAmount,
      userPublicKey: clientBody.userPublicKey,
    }),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/tradingbots/deposit/confirm { depositId, signature }: the service
 * verifies the deposit on-chain and answers the updated { vault }.
 */
async function depositConfirmHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/tradingbots/deposit/confirm', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      depositId: clientBody.depositId,
      signature: clientBody.signature,
    }),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/tradingbots/withdraw { userPublicKey }: pause the bot and return
 * the vault balances. Passthrough supports both custody shapes in the PRD: an
 * unsigned owner transaction or a service-signed payout status.
 */
async function withdrawHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/tradingbots/withdraw', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      userPublicKey: clientBody.userPublicKey,
    }),
  });
  return json(ctx.res, 200, body);
}

/**
 * POST /api/tradingbots/control { action, params? }: start/pause the bot or
 * update its strategy params; answers the updated { bot }.
 */
async function controlHandler(ctx: Ctx): Promise<void> {
  const clientBody = await readBody(ctx.req);
  const body = await forwardToService('/v1/tradingbots/control', {
    method: 'POST',
    playerId: playerIdFor(ctx),
    body: JSON.stringify({
      action: clientBody.action,
      params: clientBody.params,
    }),
  });
  return json(ctx.res, 200, body);
}

// ---------------------------------------------------------------------------
// The route table. All eight gate-first (fail-closed 404 when the flag is off
// or the service connection is unconfigured). Config is a public read (boot
// visibility check); everything else requires a bearer session, whose account
// id is the service's subscription/vault identity key.
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/tradingbots/config',
    surface: 'api',
    middleware: [tradingBotsGate],
    handler: configHandler,
  },
  {
    method: 'GET',
    path: '/api/tradingbots/status',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: statusHandler,
  },
  {
    method: 'POST',
    path: '/api/tradingbots/subscribe',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: subscribeHandler,
  },
  {
    method: 'POST',
    path: '/api/tradingbots/subscribe/confirm',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: subscribeConfirmHandler,
  },
  {
    method: 'POST',
    path: '/api/tradingbots/deposit',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: depositHandler,
  },
  {
    method: 'POST',
    path: '/api/tradingbots/deposit/confirm',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: depositConfirmHandler,
  },
  {
    method: 'POST',
    path: '/api/tradingbots/withdraw',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: withdrawHandler,
  },
  {
    method: 'POST',
    path: '/api/tradingbots/control',
    surface: 'api',
    middleware: [tradingBotsGate, tradingBotsAuth],
    handler: controlHandler,
  },
];
