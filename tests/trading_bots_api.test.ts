// Tests for the trading-bots REST glue (src/net/trading_bots_api.ts).
//
// The module is fetch-native, so these stub globalThis.fetch (the repo's
// stub-one-global idiom; snapshots.test.ts does the same for WebSocket) and
// drive the REAL config loader and hooks builder: the memoized config load
// (404 and transport failure leave the feature invisible; a malformed or
// disabled config is rejected), the bearer header attach, every hook's exact
// method/path/body (optional fields omitted when absent), the coded-error
// shape thrown on non-2xx (code + params readable structurally, the
// userFacingApiError contract), and the available() launcher gate.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTradingBotsHooks,
  loadTradingBotsConfig,
  resetTradingBotsApiForTests,
  TradingBotsApiError,
  type TradingBotsGlueDeps,
  tradingBotsConfig,
} from '../src/net/trading_bots_api';

const OWNER = '11111111111111111111111111111111';
const TOKEN = 't'.repeat(64);

const VALID_CONFIG = {
  enabled: true,
  wocMint: '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth',
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
      params: [],
    },
  ],
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function stubFetch(...responders: ((call: FetchCall) => Response)[]): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (!responder) throw new Error('unexpected fetch');
    return responder(call);
  }) as typeof fetch;
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const headersOf = (call: FetchCall): Record<string, string> =>
  (call.init?.headers ?? {}) as Record<string, string>;

const bodyOf = (call: FetchCall): Record<string, unknown> =>
  JSON.parse(String(call.init?.body)) as Record<string, unknown>;

function makeDeps(overrides: Partial<TradingBotsGlueDeps> = {}): TradingBotsGlueDeps {
  return {
    token: () => TOKEN,
    linkedWallet: () => OWNER,
    walletAddress: () => OWNER,
    signAndSend: async () => 'sig',
    isWalletFeatureUnsupported: () => false,
    onFundsMoved: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  calls = [];
  resetTradingBotsApiForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('config load', () => {
  it('loads and memoizes the config: one fetch for many awaits', async () => {
    stubFetch(() => jsonResponse(200, VALID_CONFIG));
    await loadTradingBotsConfig(true);
    await loadTradingBotsConfig(true);
    await loadTradingBotsConfig(true);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('/api/tradingbots/config');
    expect(tradingBotsConfig()).toEqual(VALID_CONFIG);
  });

  it('never fetches when the wallet UI is disabled', async () => {
    stubFetch(() => jsonResponse(200, VALID_CONFIG));
    await loadTradingBotsConfig(false);
    expect(calls.length).toBe(0);
    expect(tradingBotsConfig()).toBeNull();
  });

  it('a 404 (the flag-off answer) leaves the feature invisible, no throw', async () => {
    stubFetch(() => jsonResponse(404, { code: 'trading_bots.disabled' }));
    await loadTradingBotsConfig(true);
    expect(tradingBotsConfig()).toBeNull();
  });

  it('rejects a disabled, SKU-less, or malformed config payload', async () => {
    for (const bad of [
      { ...VALID_CONFIG, enabled: false },
      { ...VALID_CONFIG, skus: [] },
      { ...VALID_CONFIG, skus: 'nope' },
      null,
    ]) {
      resetTradingBotsApiForTests();
      calls = [];
      stubFetch(() => jsonResponse(200, bad));
      await loadTradingBotsConfig(true);
      expect(tradingBotsConfig()).toBeNull();
    }
  });

  it('a transport failure at boot hides the feature and never throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    await expect(loadTradingBotsConfig(true)).resolves.toBeUndefined();
    expect(tradingBotsConfig()).toBeNull();
  });
});

describe('hooks: available() launcher gate', () => {
  it('requires BOTH a loaded config and a linked wallet', async () => {
    const noWalletHooks = buildTradingBotsHooks(makeDeps({ linkedWallet: () => null }));
    const hooks = buildTradingBotsHooks(makeDeps());
    // No config yet: gated off for both.
    expect(hooks.available()).toBe(false);
    stubFetch(() => jsonResponse(200, VALID_CONFIG));
    await loadTradingBotsConfig(true);
    expect(hooks.available()).toBe(true);
    expect(hooks.config()).toEqual(VALID_CONFIG);
    expect(noWalletHooks.available()).toBe(false);
  });
});

describe('hooks: endpoint shapes', () => {
  it('fetchStatus GETs with the bearer header and returns the aggregate', async () => {
    const status = {
      subscription: null,
      claudiumBalance: 0,
      vault: null,
      bot: null,
      trades: [],
      pnl: null,
    };
    stubFetch(() => jsonResponse(200, status));
    const result = await buildTradingBotsHooks(makeDeps()).fetchStatus();
    expect(result).toEqual(status);
    expect(calls[0].url).toBe('/api/tradingbots/status');
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('attaches no Authorization header without a session token', async () => {
    stubFetch(() => jsonResponse(200, {}));
    await buildTradingBotsHooks(makeDeps({ token: () => null })).fetchStatus();
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });

  it('subscribe POSTs skuId + payWith, omitting a null userPublicKey', async () => {
    stubFetch(() => jsonResponse(200, { subscription: {} }));
    const hooks = buildTradingBotsHooks(makeDeps());
    await hooks.subscribe('grid', 'claudium', null);
    expect(calls[0].url).toBe('/api/tradingbots/subscribe');
    expect(calls[0].init?.method).toBe('POST');
    expect(headersOf(calls[0])['Content-Type']).toBe('application/json');
    expect(bodyOf(calls[0])).toEqual({ skuId: 'grid', payWith: 'claudium' });

    await hooks.subscribe('grid', 'woc', OWNER);
    expect(bodyOf(calls[1])).toEqual({ skuId: 'grid', payWith: 'woc', userPublicKey: OWNER });
  });

  it('confirmSubscribe, deposit, confirmDeposit, and withdraw carry exact bodies', async () => {
    stubFetch(() => jsonResponse(200, {}));
    const hooks = buildTradingBotsHooks(makeDeps());
    await hooks.confirmSubscribe('pay_1', 'sig');
    expect(calls[0].url).toBe('/api/tradingbots/subscribe/confirm');
    expect(bodyOf(calls[0])).toEqual({ paymentId: 'pay_1', signature: 'sig' });

    await hooks.deposit('500000000', '10000000000', OWNER);
    expect(calls[1].url).toBe('/api/tradingbots/deposit');
    expect(bodyOf(calls[1])).toEqual({
      solAmount: '500000000',
      wocAmount: '10000000000',
      userPublicKey: OWNER,
    });

    await hooks.confirmDeposit('dep_1', 'sig');
    expect(calls[2].url).toBe('/api/tradingbots/deposit/confirm');
    expect(bodyOf(calls[2])).toEqual({ depositId: 'dep_1', signature: 'sig' });

    await hooks.withdraw(OWNER);
    expect(calls[3].url).toBe('/api/tradingbots/withdraw');
    expect(bodyOf(calls[3])).toEqual({ userPublicKey: OWNER });
  });

  it('control POSTs the action, omitting absent params', async () => {
    stubFetch(() => jsonResponse(200, { bot: {} }));
    const hooks = buildTradingBotsHooks(makeDeps());
    await hooks.control('start');
    expect(calls[0].url).toBe('/api/tradingbots/control');
    expect(bodyOf(calls[0])).toEqual({ action: 'start' });
    await hooks.control('update_params', { gridSpacingBps: 75 });
    expect(bodyOf(calls[1])).toEqual({
      action: 'update_params',
      params: { gridSpacingBps: 75 },
    });
  });

  it('delegates signAndSend / isWalletFeatureUnsupported / onFundsMoved to the deps', async () => {
    let moved = 0;
    const featureErr = new Error('feature');
    const hooks = buildTradingBotsHooks(
      makeDeps({
        signAndSend: async (tx) => `signed:${tx}`,
        isWalletFeatureUnsupported: (err) => err === featureErr,
        onFundsMoved: () => {
          moved += 1;
        },
      }),
    );
    expect(await hooks.signAndSend('dHg=')).toBe('signed:dHg=');
    expect(hooks.isWalletFeatureUnsupported(featureErr)).toBe(true);
    expect(hooks.isWalletFeatureUnsupported(new Error('other'))).toBe(false);
    hooks.onFundsMoved();
    expect(moved).toBe(1);
  });
});

describe('hooks: coded errors', () => {
  it('a non-2xx answer throws the coded error with the body as params', async () => {
    stubFetch(() => jsonResponse(429, { code: 'trading_bots.rate_limited', retryAfterMs: 5_400 }));
    const hooks = buildTradingBotsHooks(makeDeps());
    let thrown: unknown = null;
    try {
      await hooks.fetchStatus();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TradingBotsApiError);
    const coded = thrown as TradingBotsApiError;
    // The structural contract userFacingApiError and the flow core read.
    expect(coded.code).toBe('trading_bots.rate_limited');
    expect(coded.params.retryAfterMs).toBe(5_400);
    expect(coded.message).toBe('request failed (429)');
  });

  it('a codeless failure body still throws, with an empty code', async () => {
    stubFetch(() => new Response('Bad Gateway', { status: 502 }));
    const hooks = buildTradingBotsHooks(makeDeps());
    let thrown: unknown = null;
    try {
      await hooks.withdraw(OWNER);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TradingBotsApiError);
    expect((thrown as TradingBotsApiError).code).toBe('');
  });
});
