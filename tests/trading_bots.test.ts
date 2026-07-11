// Server tests for the rentable trading-bot proxy (server/trading_bots.ts).
//
// The proxy is a THIN forwarder to the economy service, which owns the whole
// bot engine (catalog, Claudium ledger, payment verification, vault custody,
// the Jupiter strategy loop, rate limits). So the tests fake the SERVICE, not
// Jupiter: they drive the real RouteDefs (middleware chain + handler) through
// fakeCtx with the service fetch and the auth token lookup replaced via
// configureTradingBotsRuntime. Covered: the fail-closed flag gate (and the
// unconfigured-service gate) on all eight routes, the bearer auth on the seven
// player routes, the forwarded internal secret + player id headers, the exact
// per-route body passthrough (extraneous client fields never forwarded), and
// the mapping of every service error code (incl. rate_limited with
// retryAfterMs and transport failures) onto the game's stable trading_bots.*
// codes, never swallowed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '../server/http/errors';
import type { Ctx, RouteDef } from '../server/http/types';
import {
  configureTradingBotsRuntime,
  resetTradingBotsRuntimeForTests,
  routes,
} from '../server/trading_bots';
import { type FakeRes, fakeCtx } from './server/helpers';

const SERVICE_URL = 'http://economy.internal:8798';
const SECRET = 'internal-secret';
const TOKEN = 'a'.repeat(64);
const READ_TOKEN = 'c'.repeat(64);
const ACCOUNT_ID = 42;
const AUTH_HEADERS = { authorization: `Bearer ${TOKEN}` };
const READ_AUTH_HEADERS = { authorization: `Bearer ${READ_TOKEN}` };
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const WOC_MINT = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const VALID_PUBKEY = '11111111111111111111111111111111';

const route = (method: string, path: string): RouteDef => {
  const found = routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`route not found: ${method} ${path}`);
  return found;
};
const configRoute = route('GET', '/api/tradingbots/config');
const statusRoute = route('GET', '/api/tradingbots/status');
const subscribeRoute = route('POST', '/api/tradingbots/subscribe');
const subscribeConfirmRoute = route('POST', '/api/tradingbots/subscribe/confirm');
const depositRoute = route('POST', '/api/tradingbots/deposit');
const depositConfirmRoute = route('POST', '/api/tradingbots/deposit/confirm');
const withdrawRoute = route('POST', '/api/tradingbots/withdraw');
const controlRoute = route('POST', '/api/tradingbots/control');
const authedRoutes = [
  statusRoute,
  subscribeRoute,
  subscribeConfirmRoute,
  depositRoute,
  depositConfirmRoute,
  withdrawRoute,
  controlRoute,
];

// Run a RouteDef the way the onion would: middleware in order, then the handler.
async function run(routeDef: RouteDef, ctx: Ctx): Promise<void> {
  const chain = routeDef.middleware ?? [];
  const dispatch = async (idx: number): Promise<void> => {
    const mw = chain[idx];
    if (mw) {
      await mw(ctx, () => dispatch(idx + 1));
      return;
    }
    await routeDef.handler(ctx);
  };
  await dispatch(0);
}

async function expectHttpError(
  promise: Promise<void>,
  status: number,
  code: string,
): Promise<HttpError> {
  let thrown: unknown = null;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(HttpError);
  const httpError = thrown as HttpError;
  expect(httpError.status).toBe(status);
  expect(httpError.code).toBe(code);
  return httpError;
}

function jsonBody(res: FakeRes): unknown {
  return JSON.parse(res.body);
}

interface ServiceCall {
  url: string;
  init: RequestInit | undefined;
}

// The fake economy service: records every forwarded call and answers from the
// queued responders in order (the last responder answers every later call).
function installFakeService(...responders: ((call: ServiceCall) => Response)[]): ServiceCall[] {
  const calls: ServiceCall[] = [];
  configureTradingBotsRuntime({
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
      if (!responder) throw new Error('unexpected service call');
      return responder(call);
    },
  });
  return calls;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const headersOf = (call: ServiceCall): Record<string, string> =>
  (call.init?.headers ?? {}) as Record<string, string>;

const forwardedBody = (call: ServiceCall): Record<string, unknown> =>
  JSON.parse(String(call.init?.body)) as Record<string, unknown>;

const SERVICE_CONFIG = {
  enabled: true,
  wocMint: WOC_MINT,
  wocDecimals: 6,
  solDecimals: 9,
  claudiumEnabled: true,
  skus: [
    {
      id: 'grid',
      priceWocBaseUnits: '250000000000',
      priceClaudium: 900,
      minDepositSol: '100000000',
      maxDepositSol: '5000000000',
      minDepositWoc: '5000000000',
      maxDepositWoc: '250000000000',
      params: [
        { key: 'gridSpacingBps', min: 10, max: 500, step: 5, default: 50 },
        { key: 'orderSizeBps', min: 100, max: 2500, step: 100, default: 500 },
      ],
    },
  ],
};

const SERVICE_STATUS = {
  subscription: { skuId: 'grid', activeUntilMs: 1_800_000_000_000 },
  claudiumBalance: 1200,
  vault: { sol: '1000000000', woc: '52000000000' },
  bot: { state: 'running', params: { gridSpacingBps: 50, orderSizeBps: 500 } },
  trades: [
    {
      tsMs: 1_799_000_000_000,
      side: 'buy',
      inAmount: '100000000',
      inMint: SOL_MINT,
      outAmount: '5200000000',
      outMint: WOC_MINT,
      signature: 'sig1',
    },
  ],
  pnl: { periodDays: 30, wocBaseUnits: '1200000000', bps: 230 },
};

const authedGet = (): Ctx => fakeCtx({ headers: AUTH_HEADERS });
const authedPost = (body: unknown): Ctx => fakeCtx({ method: 'POST', headers: AUTH_HEADERS, body });

beforeEach(() => {
  process.env.WOC_TRADING_BOTS_ENABLED = '1';
  process.env.ECONOMY_SERVICE_URL = SERVICE_URL;
  process.env.WOC_ECONOMY_INTERNAL_SECRET = SECRET;
  // Real bearer parsing, fake token resolution: no Postgres in these tests.
  // TOKEN is a full session; READ_TOKEN is a read-scoped (companion/OAuth)
  // token, accepted on reads and rejected on every mutating route.
  configureTradingBotsRuntime({
    authDeps: {
      lookupToken: async (raw) =>
        raw === TOKEN
          ? { accountId: ACCOUNT_ID, scope: 'full' as const }
          : raw === READ_TOKEN
            ? { accountId: ACCOUNT_ID, scope: 'read' as const }
            : null,
      moderationStatus: async () => ({
        locked: false,
        banned: false,
        suspendedUntil: null,
        reason: '',
        message: '',
        chatMutedUntil: null,
        chatStrikes: 0,
      }),
    },
  });
});

afterEach(() => {
  delete process.env.WOC_TRADING_BOTS_ENABLED;
  delete process.env.ECONOMY_SERVICE_URL;
  delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
  resetTradingBotsRuntimeForTests();
});

describe('trading bots proxy: fail-closed gates', () => {
  it('refuses all eight endpoints with 404 trading_bots.disabled when the flag is unset', async () => {
    delete process.env.WOC_TRADING_BOTS_ENABLED;
    const calls = installFakeService(() => jsonResponse(200, {}));
    await expectHttpError(run(configRoute, fakeCtx()), 404, 'trading_bots.disabled');
    await expectHttpError(run(statusRoute, authedGet()), 404, 'trading_bots.disabled');
    for (const postRoute of [
      subscribeRoute,
      subscribeConfirmRoute,
      depositRoute,
      depositConfirmRoute,
      withdrawRoute,
      controlRoute,
    ]) {
      await expectHttpError(run(postRoute, authedPost({})), 404, 'trading_bots.disabled');
    }
    // Fail-closed means no service traffic at all while disabled.
    expect(calls.length).toBe(0);
  });

  it('refuses when the flag is any value other than exactly 1', async () => {
    for (const value of ['0', 'true', 'yes', ' ']) {
      process.env.WOC_TRADING_BOTS_ENABLED = value;
      await expectHttpError(run(configRoute, fakeCtx()), 404, 'trading_bots.disabled');
    }
  });

  it('refuses (fail-closed, zero calls) when the service URL or secret is unconfigured', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    delete process.env.ECONOMY_SERVICE_URL;
    await expectHttpError(run(configRoute, fakeCtx()), 404, 'trading_bots.disabled');
    process.env.ECONOMY_SERVICE_URL = SERVICE_URL;
    delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
    await expectHttpError(run(statusRoute, authedGet()), 404, 'trading_bots.disabled');
    expect(calls.length).toBe(0);
  });
});

describe('trading bots proxy: auth on every player route', () => {
  it('rejects a missing bearer token with 401 before any service call', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_STATUS));
    await expectHttpError(run(statusRoute, fakeCtx()), 401, 'auth.token_missing');
    for (const postRoute of [
      subscribeRoute,
      subscribeConfirmRoute,
      depositRoute,
      depositConfirmRoute,
      withdrawRoute,
      controlRoute,
    ]) {
      await expectHttpError(
        run(postRoute, fakeCtx({ method: 'POST', body: {} })),
        401,
        'auth.token_missing',
      );
    }
    expect(calls.length).toBe(0);
  });

  it('rejects an unresolvable token with 401', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_STATUS));
    const badToken = fakeCtx({ headers: { authorization: `Bearer ${'b'.repeat(64)}` } });
    await expectHttpError(run(statusRoute, badToken), 401, 'auth.token_invalid');
    expect(calls.length).toBe(0);
  });

  it('config stays a public read (no Authorization needed)', async () => {
    installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    const ctx = fakeCtx();
    await run(configRoute, ctx);
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(200);
  });

  it('a read-scoped token is accepted on the status read', async () => {
    installFakeService(() => jsonResponse(200, SERVICE_STATUS));
    const ctx = fakeCtx({ headers: READ_AUTH_HEADERS });
    await run(statusRoute, ctx);
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(200);
  });

  it('a read-scoped token is 403 on every MUTATING route, zero service calls', async () => {
    // The scope invariant: read tokens (companion apps, OAuth character:read)
    // are rejected on every mutating route. A Claudium subscribe debits the
    // account ledger and control starts trading the funded vault, so none of
    // the six may run on a read token.
    const calls = installFakeService(() => jsonResponse(200, {}));
    for (const postRoute of [
      subscribeRoute,
      subscribeConfirmRoute,
      depositRoute,
      depositConfirmRoute,
      withdrawRoute,
      controlRoute,
    ]) {
      await expectHttpError(
        run(postRoute, fakeCtx({ method: 'POST', headers: READ_AUTH_HEADERS, body: {} })),
        403,
        'auth.forbidden',
      );
    }
    expect(calls.length).toBe(0);
  });
});

describe('trading bots proxy: forwarding', () => {
  it('config forwards with the internal secret and relays the catalog verbatim', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    const ctx = fakeCtx();
    await run(configRoute, ctx);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/config`);
    expect(headersOf(calls[0])['x-woc-economy-secret']).toBe(SECRET);
    expect(headersOf(calls[0])['x-woc-player-id']).toBeUndefined();
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual(SERVICE_CONFIG);
  });

  it('status forwards the secret + player id and relays the aggregate verbatim', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_STATUS));
    const ctx = authedGet();
    await run(statusRoute, ctx);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/status`);
    expect(headersOf(calls[0])['x-woc-economy-secret']).toBe(SECRET);
    expect(headersOf(calls[0])['x-woc-player-id']).toBe(String(ACCOUNT_ID));
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual(SERVICE_STATUS);
  });

  it('subscribe forwards exactly skuId + payWith + userPublicKey, relaying the payment leg', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { paymentId: 'pay_1', paymentTransaction: 'dGVzdA==' }),
    );
    const ctx = authedPost({
      skuId: 'grid',
      payWith: 'woc',
      userPublicKey: VALID_PUBKEY,
      extraneous: 'never forwarded',
    });
    await run(subscribeRoute, ctx);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/subscribe`);
    expect(calls[0].init?.method).toBe('POST');
    expect(headersOf(calls[0])['x-woc-player-id']).toBe(String(ACCOUNT_ID));
    const forwarded = forwardedBody(calls[0]);
    expect(Object.keys(forwarded).sort()).toEqual(['payWith', 'skuId', 'userPublicKey']);
    expect(forwarded.skuId).toBe('grid');
    expect(forwarded.payWith).toBe('woc');
    expect(forwarded.userPublicKey).toBe(VALID_PUBKEY);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      paymentId: 'pay_1',
      paymentTransaction: 'dGVzdA==',
    });
  });

  it('a claudium subscribe passes through the single-call subscription answer', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { subscription: { skuId: 'dca', activeUntilMs: 1_800_000_000_000 } }),
    );
    const ctx = authedPost({ skuId: 'dca', payWith: 'claudium' });
    await run(subscribeRoute, ctx);
    // JSON.stringify drops the undefined userPublicKey: the forwarded body
    // carries exactly the two present fields.
    expect(Object.keys(forwardedBody(calls[0])).sort()).toEqual(['payWith', 'skuId']);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      subscription: { skuId: 'dca', activeUntilMs: 1_800_000_000_000 },
    });
  });

  it('subscribe/confirm forwards exactly paymentId + signature', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { subscription: { skuId: 'grid', activeUntilMs: 1 } }),
    );
    const ctx = authedPost({ paymentId: 'pay_1', signature: 'sig', extra: 'dropped' });
    await run(subscribeConfirmRoute, ctx);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/subscribe/confirm`);
    expect(Object.keys(forwardedBody(calls[0])).sort()).toEqual(['paymentId', 'signature']);
  });

  it('deposit forwards exactly solAmount + wocAmount + userPublicKey, relaying the unsigned tx', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { depositId: 'dep_1', depositTransaction: 'dGVzdA==' }),
    );
    const ctx = authedPost({
      solAmount: '100000000',
      wocAmount: '5000000000',
      userPublicKey: VALID_PUBKEY,
      extra: 'dropped',
    });
    await run(depositRoute, ctx);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/deposit`);
    const forwarded = forwardedBody(calls[0]);
    expect(Object.keys(forwarded).sort()).toEqual(['solAmount', 'userPublicKey', 'wocAmount']);
    expect(forwarded.solAmount).toBe('100000000');
    expect(forwarded.wocAmount).toBe('5000000000');
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      depositId: 'dep_1',
      depositTransaction: 'dGVzdA==',
    });
  });

  it('deposit/confirm forwards exactly depositId + signature, relaying the vault', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { vault: { sol: '1100000000', woc: '57000000000' } }),
    );
    const ctx = authedPost({ depositId: 'dep_1', signature: 'sig', extra: 'dropped' });
    await run(depositConfirmRoute, ctx);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/deposit/confirm`);
    expect(Object.keys(forwardedBody(calls[0])).sort()).toEqual(['depositId', 'signature']);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      vault: { sol: '1100000000', woc: '57000000000' },
    });
  });

  it('withdraw forwards exactly userPublicKey and passes both custody answer shapes through', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { withdrawal: { id: 'wd_1', status: 'pending' } }),
    );
    const ctx = authedPost({ userPublicKey: VALID_PUBKEY, extra: 'dropped' });
    await run(withdrawRoute, ctx);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/withdraw`);
    expect(Object.keys(forwardedBody(calls[0]))).toEqual(['userPublicKey']);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      withdrawal: { id: 'wd_1', status: 'pending' },
    });
  });

  it('control forwards exactly action + params, relaying the bot state', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { bot: { state: 'paused', params: { gridSpacingBps: 75 } } }),
    );
    const ctx = authedPost({
      action: 'update_params',
      params: { gridSpacingBps: 75 },
      extra: 'dropped',
    });
    await run(controlRoute, ctx);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/control`);
    const forwarded = forwardedBody(calls[0]);
    expect(Object.keys(forwarded).sort()).toEqual(['action', 'params']);
    expect(forwarded.params).toEqual({ gridSpacingBps: 75 });
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      bot: { state: 'paused', params: { gridSpacingBps: 75 } },
    });
  });

  it('a paramless control forwards only the action (undefined params dropped)', async () => {
    const calls = installFakeService(() => jsonResponse(200, { bot: { state: 'running' } }));
    await run(controlRoute, authedPost({ action: 'start' }));
    expect(Object.keys(forwardedBody(calls[0]))).toEqual(['action']);
  });

  it('trims a trailing slash off ECONOMY_SERVICE_URL (no double-slash upstream)', async () => {
    process.env.ECONOMY_SERVICE_URL = `${SERVICE_URL}/`;
    const calls = installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    await run(configRoute, fakeCtx());
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/tradingbots/config`);
  });

  it('contains no Jupiter knowledge: the only upstream is the economy service', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_STATUS));
    await run(statusRoute, authedGet());
    for (const call of calls) {
      expect(call.url.startsWith(SERVICE_URL)).toBe(true);
      expect(call.url).not.toContain('jup.ag');
    }
  });
});

describe('trading bots proxy: service error mapping', () => {
  const cases: Array<[string, number, string]> = [
    ['disabled', 404, 'trading_bots.disabled'],
    ['unknown_sku', 400, 'trading_bots.unknown_sku'],
    ['invalid_pay_currency', 400, 'trading_bots.invalid_pay_currency'],
    ['already_subscribed', 409, 'trading_bots.already_subscribed'],
    ['subscription_required', 403, 'trading_bots.subscription_required'],
    ['subscription_expired', 403, 'trading_bots.subscription_expired'],
    ['insufficient_claudium', 400, 'trading_bots.insufficient_claudium'],
    ['invalid_amount', 400, 'trading_bots.invalid_amount'],
    ['deposit_out_of_bounds', 400, 'trading_bots.deposit_out_of_bounds'],
    ['invalid_public_key', 400, 'trading_bots.invalid_public_key'],
    ['invalid_params', 400, 'trading_bots.invalid_params'],
    ['payment_not_found', 404, 'trading_bots.payment_not_found'],
    ['payment_unverified', 400, 'trading_bots.payment_unverified'],
    ['vault_busy', 409, 'trading_bots.vault_busy'],
  ];
  for (const [serviceCode, status, gameCode] of cases) {
    it(`maps service ${serviceCode} to ${status} ${gameCode}`, async () => {
      installFakeService(() => jsonResponse(400, { error: serviceCode }));
      await expectHttpError(
        run(subscribeRoute, authedPost({ skuId: 'grid', payWith: 'woc' })),
        status,
        gameCode,
      );
    });
  }

  it('maps rate_limited to 429 trading_bots.rate_limited carrying retryAfterMs', async () => {
    installFakeService(() => jsonResponse(429, { error: 'rate_limited', retryAfterMs: 5400 }));
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      429,
      'trading_bots.rate_limited',
    );
    expect(err.params?.retryAfterMs).toBe(5400);
  });

  it('rate_limited without a usable retryAfterMs falls back to a 60s cooldown', async () => {
    installFakeService(() => jsonResponse(429, { error: 'rate_limited' }));
    const err = await expectHttpError(
      run(controlRoute, authedPost({ action: 'start' })),
      429,
      'trading_bots.rate_limited',
    );
    expect(err.params?.retryAfterMs).toBe(60_000);
  });

  it('rate_limited with a zero or negative retryAfterMs also falls back to 60s', async () => {
    for (const bad of [0, -500]) {
      installFakeService(() => jsonResponse(429, { error: 'rate_limited', retryAfterMs: bad }));
      const err = await expectHttpError(
        run(statusRoute, authedGet()),
        429,
        'trading_bots.rate_limited',
      );
      expect(err.params?.retryAfterMs).toBe(60_000);
    }
  });

  it('a fractional retryAfterMs is ceiled to whole milliseconds', async () => {
    installFakeService(() => jsonResponse(429, { error: 'rate_limited', retryAfterMs: 1200.4 }));
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      429,
      'trading_bots.rate_limited',
    );
    expect(err.params?.retryAfterMs).toBe(1201);
  });

  it('upstream_error without an upstreamStatus falls back to the HTTP status', async () => {
    installFakeService(() => jsonResponse(503, { error: 'upstream_error', upstreamError: 'down' }));
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      502,
      'trading_bots.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(503);
    expect(err.params?.upstreamError).toBe('down');
  });

  it('propagates upstream_error with the service-reported status + text', async () => {
    installFakeService(() =>
      jsonResponse(502, {
        error: 'upstream_error',
        upstreamStatus: 429,
        upstreamError: 'Rate limit exceeded',
      }),
    );
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      502,
      'trading_bots.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(429);
    expect(err.params?.upstreamError).toBe('Rate limit exceeded');
  });

  it('surfaces an unknown service code as a typed upstream error, never swallowed', async () => {
    installFakeService(() => jsonResponse(400, { error: 'brand_new_code' }));
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      502,
      'trading_bots.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(400);
    expect(err.params?.upstreamError).toBe('brand_new_code');
  });

  it('surfaces a non-JSON service answer as a typed upstream error', async () => {
    installFakeService(() => new Response('Bad Gateway', { status: 502 }));
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      502,
      'trading_bots.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(502);
  });

  it('maps a transport failure (service unreachable) to a typed upstream error', async () => {
    configureTradingBotsRuntime({
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      502,
      'trading_bots.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(0);
    expect(err.params?.upstreamError).toBe('economy service unreachable');
  });

  it('treats a 2xx with no JSON body as a typed upstream error, not a fake success', async () => {
    installFakeService(() => new Response('', { status: 200 }));
    await expectHttpError(run(statusRoute, authedGet()), 502, 'trading_bots.upstream_error');
  });

  it('truncates a hostile oversized service error text', async () => {
    installFakeService(() =>
      jsonResponse(502, {
        error: 'upstream_error',
        upstreamStatus: 500,
        upstreamError: 'x'.repeat(5000),
      }),
    );
    const err = await expectHttpError(
      run(statusRoute, authedGet()),
      502,
      'trading_bots.upstream_error',
    );
    expect(String(err.params?.upstreamError).length).toBe(300);
  });
});

describe('trading bots proxy: route registration shape', () => {
  it('exposes exactly the eight-route family, gate-first, with auth on every player route', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/tradingbots/config',
      'GET /api/tradingbots/status',
      'POST /api/tradingbots/subscribe',
      'POST /api/tradingbots/subscribe/confirm',
      'POST /api/tradingbots/deposit',
      'POST /api/tradingbots/deposit/confirm',
      'POST /api/tradingbots/withdraw',
      'POST /api/tradingbots/control',
    ]);
    for (const r of routes) expect(r.surface).toBe('api');
    expect(configRoute.middleware?.length).toBe(1); // gate only: public read
    for (const r of authedRoutes) expect(r.middleware?.length).toBe(2); // gate + bearer auth
  });
});
