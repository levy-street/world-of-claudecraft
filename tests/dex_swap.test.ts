// Server tests for the in-game buy-$WOC proxy (server/dex_swap.ts).
//
// The proxy is a THIN forwarder to the economy service, which owns the whole
// Jupiter integration (mint pinning, bounds, fee policy, rate limits). So the
// tests fake the SERVICE, not Jupiter: they drive the real RouteDefs
// (middleware chain + handler) through fakeCtx with the service fetch and the
// auth token lookup replaced via configureDexSwapRuntime. Covered: the
// fail-closed flag gate (and the unconfigured-service gate), the bearer auth
// on quote/swap, the forwarded internal secret + player id headers, the
// passthrough of config/quote/swap bodies, and the mapping of every service
// error code (incl. rate_limited with retryAfterMs and transport failures)
// onto the game's stable dex_swap.* codes, never swallowed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureDexSwapRuntime, resetDexSwapRuntimeForTests, routes } from '../server/dex_swap';
import { HttpError } from '../server/http/errors';
import type { Ctx, RouteDef } from '../server/http/types';
import { type FakeRes, fakeCtx } from './server/helpers';

const SERVICE_URL = 'http://economy.internal:8798';
const SECRET = 'internal-secret';
const TOKEN = 'a'.repeat(64);
const ACCOUNT_ID = 42;
const AUTH_HEADERS = { authorization: `Bearer ${TOKEN}` };
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const WOC_MINT = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const VALID_PUBKEY = '11111111111111111111111111111111';

const route = (method: string, path: string): RouteDef => {
  const found = routes.find((r) => r.method === method && r.path === path);
  if (!found) throw new Error(`route not found: ${method} ${path}`);
  return found;
};
const configRoute = route('GET', '/api/dexswap/config');
const quoteRoute = route('GET', '/api/dexswap/quote');
const swapRoute = route('POST', '/api/dexswap/swap');

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
// queued responders in order (one responder answers every call).
function installFakeService(...responders: ((call: ServiceCall) => Response)[]): ServiceCall[] {
  const calls: ServiceCall[] = [];
  configureDexSwapRuntime({
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

const SERVICE_CONFIG = {
  enabled: true,
  wocMint: WOC_MINT,
  wocDecimals: 6,
  inputs: [
    { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
  ],
  maxSlippageBps: 500,
  feeBps: 25,
  feeApplied: true,
};

const SAMPLE_QUOTE = {
  inputMint: SOL_MINT,
  inAmount: '1000000000',
  outputMint: WOC_MINT,
  outAmount: '52340000000',
  otherAmountThreshold: '51816600000',
  swapMode: 'ExactIn',
  slippageBps: 100,
  priceImpactPct: '0.0012',
  routePlan: [],
};

const quoteCtx = (query: Record<string, string> = {}): Ctx =>
  fakeCtx({
    headers: AUTH_HEADERS,
    query: { inputMint: SOL_MINT, amount: '1000000', slippageBps: '100', ...query },
  });

const swapCtx = (body: unknown): Ctx => fakeCtx({ method: 'POST', headers: AUTH_HEADERS, body });

beforeEach(() => {
  process.env.WOC_DEX_SWAP_ENABLED = '1';
  process.env.ECONOMY_SERVICE_URL = SERVICE_URL;
  process.env.WOC_ECONOMY_INTERNAL_SECRET = SECRET;
  // Real bearer parsing, fake token resolution: no Postgres in these tests.
  configureDexSwapRuntime({
    authDeps: {
      lookupToken: async (raw) =>
        raw === TOKEN ? { accountId: ACCOUNT_ID, scope: 'full' as const } : null,
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
  delete process.env.WOC_DEX_SWAP_ENABLED;
  delete process.env.ECONOMY_SERVICE_URL;
  delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
  resetDexSwapRuntimeForTests();
});

describe('dex swap proxy: fail-closed gates', () => {
  it('refuses all three endpoints with 404 dex_swap.disabled when the flag is unset', async () => {
    delete process.env.WOC_DEX_SWAP_ENABLED;
    const calls = installFakeService(() => jsonResponse(200, {}));
    await expectHttpError(run(configRoute, fakeCtx()), 404, 'dex_swap.disabled');
    await expectHttpError(run(quoteRoute, quoteCtx()), 404, 'dex_swap.disabled');
    await expectHttpError(run(swapRoute, swapCtx({})), 404, 'dex_swap.disabled');
    // Fail-closed means no service traffic at all while disabled.
    expect(calls.length).toBe(0);
  });

  it('refuses when the flag is any value other than exactly 1', async () => {
    for (const value of ['0', 'true', 'yes', ' ']) {
      process.env.WOC_DEX_SWAP_ENABLED = value;
      await expectHttpError(run(configRoute, fakeCtx()), 404, 'dex_swap.disabled');
    }
  });

  it('refuses (fail-closed, zero calls) when the service URL or secret is unconfigured', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    delete process.env.ECONOMY_SERVICE_URL;
    await expectHttpError(run(configRoute, fakeCtx()), 404, 'dex_swap.disabled');
    process.env.ECONOMY_SERVICE_URL = SERVICE_URL;
    delete process.env.WOC_ECONOMY_INTERNAL_SECRET;
    await expectHttpError(run(quoteRoute, quoteCtx()), 404, 'dex_swap.disabled');
    expect(calls.length).toBe(0);
  });
});

describe('dex swap proxy: auth on quote and swap', () => {
  it('rejects a missing bearer token with 401 before any service call', async () => {
    const calls = installFakeService(() => jsonResponse(200, SAMPLE_QUOTE));
    await expectHttpError(
      run(quoteRoute, fakeCtx({ query: { inputMint: SOL_MINT, amount: '1', slippageBps: '1' } })),
      401,
      'auth.token_missing',
    );
    await expectHttpError(
      run(swapRoute, fakeCtx({ method: 'POST', body: {} })),
      401,
      'auth.token_missing',
    );
    expect(calls.length).toBe(0);
  });

  it('rejects an unresolvable token with 401', async () => {
    const calls = installFakeService(() => jsonResponse(200, SAMPLE_QUOTE));
    const badToken = fakeCtx({
      headers: { authorization: `Bearer ${'b'.repeat(64)}` },
      query: { inputMint: SOL_MINT, amount: '1', slippageBps: '1' },
    });
    await expectHttpError(run(quoteRoute, badToken), 401, 'auth.token_invalid');
    expect(calls.length).toBe(0);
  });

  it('config stays a public read (no Authorization needed)', async () => {
    installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    const ctx = fakeCtx();
    await run(configRoute, ctx);
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(200);
  });
});

describe('dex swap proxy: forwarding', () => {
  it('config forwards with the internal secret and relays the body verbatim (fee included)', async () => {
    const calls = installFakeService(() => jsonResponse(200, SERVICE_CONFIG));
    const ctx = fakeCtx();
    await run(configRoute, ctx);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/dexswap/config`);
    expect(headersOf(calls[0])['x-woc-economy-secret']).toBe(SECRET);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual(SERVICE_CONFIG);
  });

  it('quote forwards the params, secret, and the authenticated player id', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { quoteResponse: SAMPLE_QUOTE, feeBps: 25, feeApplied: true }),
    );
    const ctx = quoteCtx({ amount: '1500000', slippageBps: '50' });
    await run(quoteRoute, ctx);
    expect(calls.length).toBe(1);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(`${SERVICE_URL}/v1/dexswap/quote`);
    expect(url.searchParams.get('inputMint')).toBe(SOL_MINT);
    expect(url.searchParams.get('amount')).toBe('1500000');
    expect(url.searchParams.get('slippageBps')).toBe('50');
    expect(headersOf(calls[0])['x-woc-economy-secret']).toBe(SECRET);
    expect(headersOf(calls[0])['x-woc-player-id']).toBe(String(ACCOUNT_ID));
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      quoteResponse: SAMPLE_QUOTE,
      feeBps: 25,
      feeApplied: true,
    });
  });

  it('swap forwards exactly quoteResponse + userPublicKey with the player id, relaying the transaction', async () => {
    const calls = installFakeService(() => jsonResponse(200, { swapTransaction: 'dGVzdA==' }));
    const ctx = swapCtx({
      quoteResponse: SAMPLE_QUOTE,
      userPublicKey: VALID_PUBKEY,
      extraneous: 'never forwarded',
    });
    await run(swapRoute, ctx);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${SERVICE_URL}/v1/dexswap/swap`);
    expect(calls[0].init?.method).toBe('POST');
    expect(headersOf(calls[0])['x-woc-player-id']).toBe(String(ACCOUNT_ID));
    const forwarded = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(Object.keys(forwarded).sort()).toEqual(['quoteResponse', 'userPublicKey']);
    expect(forwarded.quoteResponse).toEqual(SAMPLE_QUOTE);
    expect(forwarded.userPublicKey).toBe(VALID_PUBKEY);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({ swapTransaction: 'dGVzdA==' });
  });

  it('contains no Jupiter knowledge: the only upstream is the economy service', async () => {
    const calls = installFakeService(() =>
      jsonResponse(200, { quoteResponse: SAMPLE_QUOTE, feeBps: 0, feeApplied: false }),
    );
    await run(quoteRoute, quoteCtx());
    for (const call of calls) {
      expect(call.url.startsWith(SERVICE_URL)).toBe(true);
      expect(call.url).not.toContain('jup.ag');
    }
  });
});

describe('dex swap proxy: service error mapping', () => {
  const cases: Array<[string, number, string]> = [
    ['disabled', 404, 'dex_swap.disabled'],
    ['input_not_allowed', 400, 'dex_swap.input_not_allowed'],
    ['invalid_amount', 400, 'dex_swap.invalid_amount'],
    ['invalid_slippage', 400, 'dex_swap.invalid_slippage'],
    ['quote_tampered', 400, 'dex_swap.quote_tampered'],
    ['invalid_public_key', 400, 'dex_swap.invalid_public_key'],
    ['no_route', 400, 'dex_swap.no_route'],
  ];
  for (const [serviceCode, status, gameCode] of cases) {
    it(`maps service ${serviceCode} to ${status} ${gameCode}`, async () => {
      installFakeService(() => jsonResponse(400, { error: serviceCode }));
      await expectHttpError(run(quoteRoute, quoteCtx()), status, gameCode);
    });
  }

  it('maps rate_limited to 429 dex_swap.rate_limited carrying retryAfterMs', async () => {
    installFakeService(() => jsonResponse(429, { error: 'rate_limited', retryAfterMs: 5400 }));
    const err = await expectHttpError(run(quoteRoute, quoteCtx()), 429, 'dex_swap.rate_limited');
    expect(err.params?.retryAfterMs).toBe(5400);
  });

  it('rate_limited without a usable retryAfterMs falls back to a 60s cooldown', async () => {
    installFakeService(() => jsonResponse(429, { error: 'rate_limited' }));
    const err = await expectHttpError(
      run(swapRoute, swapCtx({ quoteResponse: SAMPLE_QUOTE, userPublicKey: VALID_PUBKEY })),
      429,
      'dex_swap.rate_limited',
    );
    expect(err.params?.retryAfterMs).toBe(60_000);
  });

  it('propagates upstream_error with the service-reported status + text', async () => {
    installFakeService(() =>
      jsonResponse(502, {
        error: 'upstream_error',
        upstreamStatus: 429,
        upstreamError: 'Rate limit exceeded',
      }),
    );
    const err = await expectHttpError(run(quoteRoute, quoteCtx()), 502, 'dex_swap.upstream_error');
    expect(err.params?.upstreamStatus).toBe(429);
    expect(err.params?.upstreamError).toBe('Rate limit exceeded');
  });

  it('surfaces an unknown service code as a typed upstream error, never swallowed', async () => {
    installFakeService(() => jsonResponse(400, { error: 'brand_new_code' }));
    const err = await expectHttpError(run(quoteRoute, quoteCtx()), 502, 'dex_swap.upstream_error');
    expect(err.params?.upstreamStatus).toBe(400);
    expect(err.params?.upstreamError).toBe('brand_new_code');
  });

  it('surfaces a non-JSON service answer as a typed upstream error', async () => {
    installFakeService(() => new Response('Bad Gateway', { status: 502 }));
    const err = await expectHttpError(run(quoteRoute, quoteCtx()), 502, 'dex_swap.upstream_error');
    expect(err.params?.upstreamStatus).toBe(502);
  });

  it('maps a transport failure (service unreachable) to a typed upstream error', async () => {
    configureDexSwapRuntime({
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const err = await expectHttpError(run(quoteRoute, quoteCtx()), 502, 'dex_swap.upstream_error');
    expect(err.params?.upstreamStatus).toBe(0);
    expect(err.params?.upstreamError).toBe('economy service unreachable');
  });

  it('treats a 2xx with no JSON body as a typed upstream error, not a fake success', async () => {
    installFakeService(() => new Response('', { status: 200 }));
    await expectHttpError(run(quoteRoute, quoteCtx()), 502, 'dex_swap.upstream_error');
  });

  it('truncates a hostile oversized service error text', async () => {
    installFakeService(() =>
      jsonResponse(502, {
        error: 'upstream_error',
        upstreamStatus: 500,
        upstreamError: 'x'.repeat(5000),
      }),
    );
    const err = await expectHttpError(run(quoteRoute, quoteCtx()), 502, 'dex_swap.upstream_error');
    expect(String(err.params?.upstreamError).length).toBe(300);
  });
});

describe('dex swap proxy: route registration shape', () => {
  it('exposes exactly the config/quote/swap trio, gate-first, with auth on quote+swap', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/dexswap/config',
      'GET /api/dexswap/quote',
      'POST /api/dexswap/swap',
    ]);
    for (const r of routes) expect(r.surface).toBe('api');
    expect(configRoute.middleware?.length).toBe(1); // gate only: public read
    expect(quoteRoute.middleware?.length).toBe(2); // gate + bearer auth
    expect(swapRoute.middleware?.length).toBe(2);
  });
});
