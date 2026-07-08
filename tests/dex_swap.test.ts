// Server tests for the in-game buy-$WOC Jupiter proxy (server/dex_swap.ts).
//
// Drives the real RouteDefs (middleware chain + handler) through fakeCtx with
// the upstream fetch replaced by a fake Jupiter / fake Solana RPC installed via
// configureDexSwapRuntime: zero network, real code paths. Covers the fail-closed
// flag gate, the input-mint allowlist, the server-side output-mint pin (a
// tampered quoteResponse is rejected), the amount/slippage bounds, happy-path
// quote + swap passthrough (asserting what is forwarded upstream), and upstream
// error propagation (429/500 surface as typed errors, never swallowed).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureDexSwapRuntime,
  DEX_SWAP_INPUTS,
  resetDexSwapRuntimeForTests,
  routes,
  SOL_MINT,
  USDC_MINT,
} from '../server/dex_swap';
import { HttpError } from '../server/http/errors';
import type { Ctx, RouteDef } from '../server/http/types';
import { type FakeRes, fakeCtx } from './server/helpers';

// The default $WOC mint (server/woc_balance.ts / dex_swap.ts fallback) and a
// valid 32-byte base58 pubkey (the system program id) for swap bodies.
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

interface UpstreamCall {
  url: string;
  init: RequestInit | undefined;
}

// A fake upstream: records every call and answers from the queued responders in
// order (a single responder answers every call when the queue has one entry).
function installFakeUpstream(...responders: ((call: UpstreamCall) => Response)[]): UpstreamCall[] {
  const calls: UpstreamCall[] = [];
  configureDexSwapRuntime({
    fetchImpl: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
      if (!responder) throw new Error('unexpected upstream call');
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

const rpcDecimalsResponse = (decimals: number): Response =>
  jsonResponse(200, { jsonrpc: '2.0', id: 1, result: { value: { decimals } } });

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

beforeEach(() => {
  process.env.WOC_DEX_SWAP_ENABLED = '1';
  delete process.env.JUPITER_BASE_URL;
  delete process.env.JUPITER_API_KEY;
  delete process.env.DEX_SWAP_MAX_SLIPPAGE_BPS;
});

afterEach(() => {
  delete process.env.WOC_DEX_SWAP_ENABLED;
  resetDexSwapRuntimeForTests();
});

describe('dex swap: fail-closed feature flag', () => {
  it('refuses all three endpoints with 404 dex_swap.disabled when the flag is unset', async () => {
    delete process.env.WOC_DEX_SWAP_ENABLED;
    const calls = installFakeUpstream(() => jsonResponse(200, {}));
    await expectHttpError(run(configRoute, fakeCtx()), 404, 'dex_swap.disabled');
    await expectHttpError(run(quoteRoute, fakeCtx()), 404, 'dex_swap.disabled');
    await expectHttpError(
      run(swapRoute, fakeCtx({ method: 'POST', body: {} })),
      404,
      'dex_swap.disabled',
    );
    // Fail-closed means no upstream traffic at all while disabled.
    expect(calls.length).toBe(0);
  });

  it('refuses when the flag is any value other than exactly 1', async () => {
    for (const value of ['0', 'true', 'yes', ' ']) {
      process.env.WOC_DEX_SWAP_ENABLED = value;
      await expectHttpError(run(configRoute, fakeCtx()), 404, 'dex_swap.disabled');
    }
  });
});

describe('dex swap: GET /api/dexswap/config', () => {
  it('returns the pinned mint, decimals, input allowlist, and slippage ceiling', async () => {
    const calls = installFakeUpstream(() => rpcDecimalsResponse(6));
    const ctx = fakeCtx();
    await run(configRoute, ctx);
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({
      enabled: true,
      wocMint: WOC_MINT,
      wocDecimals: 6,
      inputs: [
        { mint: SOL_MINT, symbol: 'SOL', decimals: 9 },
        { mint: USDC_MINT, symbol: 'USDC', decimals: 6 },
      ],
      maxSlippageBps: 500,
    });
    // The decimals read is a getTokenSupply POST against the RPC URL, once.
    expect(calls.length).toBe(1);
    const rpcBody = JSON.parse(String(calls[0].init?.body)) as {
      method: string;
      params: unknown[];
    };
    expect(rpcBody.method).toBe('getTokenSupply');
    expect(rpcBody.params).toEqual([WOC_MINT]);

    // Second config read serves the cached decimals: no second RPC call.
    const again = fakeCtx();
    await run(configRoute, again);
    expect(calls.length).toBe(1);
    expect((jsonBody(again.res as unknown as FakeRes) as { wocDecimals: number }).wocDecimals).toBe(
      6,
    );
  });

  it('propagates a failed decimals read as a typed upstream error', async () => {
    installFakeUpstream(() => new Response('rpc down', { status: 500 }));
    const err = await expectHttpError(run(configRoute, fakeCtx()), 502, 'dex_swap.upstream_error');
    expect(err.params?.upstreamStatus).toBe(500);
  });

  it('honors DEX_SWAP_MAX_SLIPPAGE_BPS in the config payload', async () => {
    process.env.DEX_SWAP_MAX_SLIPPAGE_BPS = '250';
    installFakeUpstream(() => rpcDecimalsResponse(6));
    const ctx = fakeCtx();
    await run(configRoute, ctx);
    const body = jsonBody(ctx.res as unknown as FakeRes) as { maxSlippageBps: number };
    expect(body.maxSlippageBps).toBe(250);
  });
});

describe('dex swap: GET /api/dexswap/quote validation', () => {
  const quoteCtx = (query: Record<string, string>): Ctx => fakeCtx({ query });

  it('rejects an input mint outside the SOL/USDC allowlist before any upstream call', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, SAMPLE_QUOTE));
    await expectHttpError(
      run(quoteRoute, quoteCtx({ inputMint: WOC_MINT, amount: '1000', slippageBps: '100' })),
      400,
      'dex_swap.input_not_allowed',
    );
    await expectHttpError(
      run(quoteRoute, quoteCtx({ amount: '1000', slippageBps: '100' })),
      400,
      'dex_swap.input_not_allowed',
    );
    expect(calls.length).toBe(0);
  });

  it('rejects zero, negative, fractional, non-numeric, and oversized amounts', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, SAMPLE_QUOTE));
    for (const amount of ['0', '-5', '1.5', 'abc', '01', '1e9', '', '9'.repeat(21)]) {
      await expectHttpError(
        run(quoteRoute, quoteCtx({ inputMint: SOL_MINT, amount, slippageBps: '100' })),
        400,
        'dex_swap.invalid_amount',
      );
    }
    expect(calls.length).toBe(0);
  });

  it('rejects slippage of 0, above the ceiling, non-integer, or missing', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, SAMPLE_QUOTE));
    for (const slippageBps of ['0', '501', '2.5', 'abc', '']) {
      await expectHttpError(
        run(quoteRoute, quoteCtx({ inputMint: SOL_MINT, amount: '1000', slippageBps })),
        400,
        'dex_swap.invalid_slippage',
      );
    }
    expect(calls.length).toBe(0);
  });

  it('accepts slippage up to a raised DEX_SWAP_MAX_SLIPPAGE_BPS', async () => {
    process.env.DEX_SWAP_MAX_SLIPPAGE_BPS = '1000';
    installFakeUpstream(() => jsonResponse(200, SAMPLE_QUOTE));
    const ctx = quoteCtx({ inputMint: SOL_MINT, amount: '1000', slippageBps: '900' });
    await run(quoteRoute, ctx);
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(200);
  });
});

describe('dex swap: GET /api/dexswap/quote passthrough', () => {
  it('pins outputMint to WOC_MINT and swapMode to ExactIn server-side', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, SAMPLE_QUOTE));
    const ctx = fakeCtx({
      query: { inputMint: USDC_MINT, amount: '1500000', slippageBps: '100' },
    });
    await run(quoteRoute, ctx);

    expect(calls.length).toBe(1);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('https://lite-api.jup.ag/swap/v1/quote');
    expect(url.searchParams.get('inputMint')).toBe(USDC_MINT);
    expect(url.searchParams.get('outputMint')).toBe(WOC_MINT);
    expect(url.searchParams.get('amount')).toBe('1500000');
    expect(url.searchParams.get('slippageBps')).toBe('100');
    expect(url.searchParams.get('swapMode')).toBe('ExactIn');
    // The lite tier is keyless: no x-api-key header unless JUPITER_API_KEY is set.
    expect((calls[0].init?.headers as Record<string, string>)['x-api-key']).toBeUndefined();

    // The Jupiter quoteResponse passes through verbatim.
    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual(SAMPLE_QUOTE);
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(200);
  });

  it('sends x-api-key and honors JUPITER_BASE_URL when configured', async () => {
    process.env.JUPITER_BASE_URL = 'https://api.jup.ag/';
    process.env.JUPITER_API_KEY = 'test-key';
    const calls = installFakeUpstream(() => jsonResponse(200, SAMPLE_QUOTE));
    await run(
      quoteRoute,
      fakeCtx({ query: { inputMint: SOL_MINT, amount: '1000', slippageBps: '50' } }),
    );
    expect(calls[0].url.startsWith('https://api.jup.ag/swap/v1/quote?')).toBe(true);
    expect((calls[0].init?.headers as Record<string, string>)['x-api-key']).toBe('test-key');
  });

  it('maps the Jupiter no-route error to 400 dex_swap.no_route', async () => {
    installFakeUpstream(() =>
      jsonResponse(400, {
        error: 'Could not find any route',
        errorCode: 'COULD_NOT_FIND_ANY_ROUTE',
      }),
    );
    await expectHttpError(
      run(
        quoteRoute,
        fakeCtx({ query: { inputMint: SOL_MINT, amount: '1000', slippageBps: '100' } }),
      ),
      400,
      'dex_swap.no_route',
    );
  });

  it('propagates an upstream 429 as a typed error carrying the status + error text', async () => {
    installFakeUpstream(() => jsonResponse(429, { error: 'Rate limit exceeded' }));
    const err = await expectHttpError(
      run(
        quoteRoute,
        fakeCtx({ query: { inputMint: SOL_MINT, amount: '1000', slippageBps: '100' } }),
      ),
      502,
      'dex_swap.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(429);
    expect(err.params?.upstreamError).toBe('Rate limit exceeded');
  });

  it('propagates an upstream 500 with a non-JSON body, never swallowed', async () => {
    installFakeUpstream(() => new Response('Bad Gateway', { status: 500 }));
    const err = await expectHttpError(
      run(
        quoteRoute,
        fakeCtx({ query: { inputMint: SOL_MINT, amount: '1000', slippageBps: '100' } }),
      ),
      502,
      'dex_swap.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(500);
    expect(err.params?.upstreamError).toBe('Bad Gateway');
  });
});

describe('dex swap: POST /api/dexswap/swap', () => {
  const swapCtx = (body: unknown): Ctx => fakeCtx({ method: 'POST', body });

  it('rejects a tampered quoteResponse whose outputMint is not WOC_MINT', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, { swapTransaction: 'AAaa' }));
    await expectHttpError(
      run(
        swapRoute,
        swapCtx({
          quoteResponse: { ...SAMPLE_QUOTE, outputMint: USDC_MINT },
          userPublicKey: VALID_PUBKEY,
        }),
      ),
      400,
      'dex_swap.quote_tampered',
    );
    // A missing / non-object quoteResponse is the same typed rejection.
    await expectHttpError(
      run(swapRoute, swapCtx({ userPublicKey: VALID_PUBKEY })),
      400,
      'dex_swap.quote_tampered',
    );
    expect(calls.length).toBe(0);
  });

  it('rejects a quoteResponse whose inputMint is outside the allowlist', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, { swapTransaction: 'AAaa' }));
    await expectHttpError(
      run(
        swapRoute,
        swapCtx({
          quoteResponse: { ...SAMPLE_QUOTE, inputMint: WOC_MINT },
          userPublicKey: VALID_PUBKEY,
        }),
      ),
      400,
      'dex_swap.input_not_allowed',
    );
    expect(calls.length).toBe(0);
  });

  it('rejects a userPublicKey that is not base58 of 32 bytes', async () => {
    const calls = installFakeUpstream(() => jsonResponse(200, { swapTransaction: 'AAaa' }));
    for (const userPublicKey of ['', 'not-base58-0OIl', 'abc', undefined]) {
      await expectHttpError(
        run(swapRoute, swapCtx({ quoteResponse: SAMPLE_QUOTE, userPublicKey })),
        400,
        'dex_swap.invalid_public_key',
      );
    }
    expect(calls.length).toBe(0);
  });

  it('forwards the swap build with wrapAndUnwrapSol + dynamicComputeUnitLimit and returns the base64 transaction', async () => {
    const swapTransaction = Buffer.from('unsigned-versioned-transaction').toString('base64');
    const calls = installFakeUpstream(() => jsonResponse(200, { swapTransaction }));
    const ctx = swapCtx({ quoteResponse: SAMPLE_QUOTE, userPublicKey: VALID_PUBKEY });
    await run(swapRoute, ctx);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://lite-api.jup.ag/swap/v1/swap');
    expect(calls[0].init?.method).toBe('POST');
    const upstreamBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(upstreamBody.wrapAndUnwrapSol).toBe(true);
    expect(upstreamBody.dynamicComputeUnitLimit).toBe(true);
    expect(upstreamBody.userPublicKey).toBe(VALID_PUBKEY);
    expect(upstreamBody.quoteResponse).toEqual(SAMPLE_QUOTE);
    // No platform fee: the proxy must never inject platformFeeBps.
    expect('platformFeeBps' in upstreamBody).toBe(false);

    expect(jsonBody(ctx.res as unknown as FakeRes)).toEqual({ swapTransaction });
    expect((ctx.res as unknown as FakeRes).statusCode).toBe(200);
  });

  it('propagates a swap-build upstream 500 as a typed error', async () => {
    installFakeUpstream(() => jsonResponse(500, { error: 'simulation failed' }));
    const err = await expectHttpError(
      run(swapRoute, swapCtx({ quoteResponse: SAMPLE_QUOTE, userPublicKey: VALID_PUBKEY })),
      502,
      'dex_swap.upstream_error',
    );
    expect(err.params?.upstreamStatus).toBe(500);
    expect(err.params?.upstreamError).toBe('simulation failed');
  });

  it('treats a swap build without a transaction string as an upstream error', async () => {
    installFakeUpstream(() => jsonResponse(200, { unexpected: true }));
    await expectHttpError(
      run(swapRoute, swapCtx({ quoteResponse: SAMPLE_QUOTE, userPublicKey: VALID_PUBKEY })),
      502,
      'dex_swap.upstream_error',
    );
  });
});

describe('dex swap: route registration shape', () => {
  it('exposes exactly the config/quote/swap trio on the api surface, gate-first', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/dexswap/config',
      'GET /api/dexswap/quote',
      'POST /api/dexswap/swap',
    ]);
    for (const r of routes) {
      expect(r.surface).toBe('api');
      expect(r.middleware?.length).toBeGreaterThanOrEqual(1);
    }
    expect(DEX_SWAP_INPUTS.map((i) => i.symbol)).toEqual(['SOL', 'USDC']);
  });
});
