import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClaudiumNativeConfirm,
  confirmNativeSettlement,
  EconomyClient,
  startClaudiumPurchase,
} from '../src/net/economy_sdk';

vi.mock('../src/net/wallet', () => ({
  currentWallet: () => ({ address: 'wallet-owner', isConnected: true }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EconomyClient store snapshot', () => {
  it('marks the snapshot available only when balance and catalog both load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/claudium/balance')) {
          return new Response(JSON.stringify({ balance: 750 }), { status: 200 });
        }
        if (url.endsWith('/api/claudium/store')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  itemId: 'ice_fang_sword',
                  name: 'Ice Fang',
                  kind: 'skin',
                  costClaudium: 3000,
                  owned: false,
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const snapshot = await new EconomyClient({
      token: () => 'token',
      base: 'https://game.example',
    }).storeSnapshot();

    expect(snapshot).toEqual({
      available: true,
      balance: 750,
      items: [
        {
          itemId: 'ice_fang_sword',
          name: 'Ice Fang',
          kind: 'skin',
          costClaudium: 3000,
          owned: false,
        },
      ],
    });
  });

  it('marks a partial refresh unavailable instead of presenting fallback rows as fresh data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/claudium/balance')) {
          return new Response(JSON.stringify({ balance: 250 }), { status: 200 });
        }
        return new Response(null, { status: 503 });
      }),
    );

    const snapshot = await new EconomyClient({
      token: () => 'token',
      base: 'https://game.example',
    }).storeSnapshot();

    expect(snapshot).toEqual({ available: false, balance: 250, items: [] });
  });

  it('preserves the upstream unavailable marker returned through the game proxy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/claudium/balance')) {
          return new Response(JSON.stringify({ balance: 250 }), { status: 200 });
        }
        if (url.endsWith('/api/claudium/store')) {
          return new Response(JSON.stringify({ available: false, items: [] }), { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    );

    const snapshot = await new EconomyClient({
      token: () => 'token',
      base: 'https://game.example',
    }).storeSnapshot();

    expect(snapshot).toEqual({ available: false, balance: 250, items: [] });
  });
});

describe('EconomyClient pack snapshot', () => {
  it('marks the snapshot available when balance, packs, and native rails all load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/claudium/balance')) {
          return new Response(JSON.stringify({ available: true, balance: 250 }), { status: 200 });
        }
        if (url.endsWith('/api/claudium/skus')) {
          return new Response(
            JSON.stringify({
              available: true,
              skus: [{ sku: 'claudium_500', usd: 4.99, claudium: 500 }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/claudium/native/rails')) {
          return new Response(
            JSON.stringify({ available: true, rails: { sol: true, usdc: true, woc: true } }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const snapshot = await new EconomyClient({
      token: () => 'token',
      base: 'https://game.example',
    }).packSnapshot();

    expect(snapshot).toEqual({
      available: true,
      balance: 250,
      skus: [{ sku: 'claudium_500', usd: 4.99, claudium: 500 }],
      nativeRails: { sol: true, usdc: true, woc: true },
    });
  });

  it('marks a partial pack refresh unavailable instead of presenting fallbacks as fresh data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/claudium/balance')) {
          return new Response(JSON.stringify({ available: true, balance: 250 }), { status: 200 });
        }
        if (url.endsWith('/api/claudium/skus')) {
          return new Response(
            JSON.stringify({
              available: true,
              skus: [{ sku: 'claudium_500', usd: 4.99, claudium: 500 }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/claudium/native/rails')) {
          return new Response(
            JSON.stringify({
              available: false,
              rails: { sol: false, usdc: false, woc: false },
            }),
            { status: 200 },
          );
        }
        return new Response(null, { status: 404 });
      }),
    );

    const snapshot = await new EconomyClient({
      token: () => 'token',
      base: 'https://game.example',
    }).packSnapshot();

    expect(snapshot).toEqual({
      available: false,
      balance: 250,
      skus: [{ sku: 'claudium_500', usd: 4.99, claudium: 500 }],
      nativeRails: { sol: false, usdc: false, woc: false },
    });
  });

  it('reads the connected wallet USDC balance through the narrow game proxy', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(JSON.stringify({ owner: 'wallet-owner', amountBase: '12345678' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const balance = await new EconomyClient({
      token: () => 'token',
      base: 'https://game.example',
    }).usdcBalance('wallet-owner');

    expect(balance).toEqual({ owner: 'wallet-owner', amountBase: '12345678' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/claudium/native/balance/usdc/wallet-owner',
    );
  });
});

describe('startClaudiumPurchase', () => {
  it('signs and confirms a service-built USDC transaction through Wallet Standard', async () => {
    const client = new EconomyClient({ token: () => 'token', base: 'https://game.example' });
    const quote = vi.spyOn(client, 'nativeQuote').mockResolvedValue({
      ok: true,
      reference: 'CLM_usdc',
      rail: 'usdc',
      claudium: 500,
      amountBase: '4990000',
      destination: 'usdc-token-account',
      mint: 'usdc-mint',
      memo: 'CLM_usdc',
      quoteExpiryMs: Date.now() + 60_000,
      transactionBase64: 'AQID',
      reason: null,
    });
    const confirm = vi.spyOn(client, 'nativeConfirm').mockResolvedValue({
      settled: true,
      balance: 500,
      reason: null,
    });
    const signer = vi.fn(async () => 'usdc-signature');

    const result = await startClaudiumPurchase(client, 'usdc', 'claudium_500', {
      nativeSignAndSend: signer,
    });

    expect(quote).toHaveBeenCalledWith({
      rail: 'usdc',
      sku: 'claudium_500',
      payer: 'wallet-owner',
    });
    expect(signer).toHaveBeenCalledWith('AQID', 'usdc', 'CLM_usdc');
    expect(confirm).toHaveBeenCalledWith({
      reference: 'CLM_usdc',
      signature: 'usdc-signature',
    });
    expect(result).toEqual({ settled: true, balance: 500, reason: null });
  });

  it('uses a linked-only desktop payer when no wallet is connected in the renderer', async () => {
    const client = new EconomyClient({ token: () => 'token', base: 'https://game.example' });
    const quote = vi.spyOn(client, 'nativeQuote').mockResolvedValue({
      ok: true,
      reference: 'CLM_desktop',
      rail: 'sol',
      claudium: 500,
      amountBase: '123',
      destination: 'treasury',
      mint: null,
      memo: 'CLM_desktop',
      quoteExpiryMs: Date.now() + 60_000,
      transactionBase64: 'AQID',
      reason: null,
    });
    vi.spyOn(client, 'nativeConfirm').mockResolvedValue({
      settled: true,
      balance: 500,
      reason: null,
    });

    await startClaudiumPurchase(client, 'sol', 'claudium_500', {
      nativePayer: 'linked-desktop-wallet',
      nativeSignAndSend: async () => 'signature',
    });

    expect(quote).toHaveBeenCalledWith({
      rail: 'sol',
      sku: 'claudium_500',
      payer: 'linked-desktop-wallet',
    });
  });
});

describe('confirmNativeSettlement', () => {
  it('retries while a native payment is not finalized yet', async () => {
    const results: ClaudiumNativeConfirm[] = [
      { settled: false, balance: null, reason: 'not_found_onchain' },
      { settled: false, balance: null, reason: 'not_finalized' },
      { settled: false, balance: null, reason: 'unavailable' },
      { settled: true, balance: 300, reason: null },
    ];
    const calls: Array<{ reference: string; signature: string }> = [];
    const client = {
      async nativeConfirm(input: { reference: string; signature: string }) {
        calls.push(input);
        return results.shift() ?? { settled: false, balance: null, reason: 'unavailable' };
      },
    };
    const waits: number[] = [];

    const result = await confirmNativeSettlement(client, 'CLM_ref', 'SIG', {
      delayMs: async (ms) => {
        waits.push(ms);
      },
    });

    expect(result).toEqual({ settled: true, balance: 300, reason: null });
    expect(calls).toHaveLength(4);
    expect(waits).toEqual([1000, 1500, 2500]);
  });

  it('does not retry non-final settlement failures', async () => {
    const client = {
      nativeConfirm: async () => ({
        settled: false,
        balance: null,
        reason: 'wrong_destination',
      }),
    };
    const waits: number[] = [];

    const result = await confirmNativeSettlement(client, 'CLM_ref', 'SIG', {
      delayMs: async (ms) => {
        waits.push(ms);
      },
    });

    expect(result.reason).toBe('wrong_destination');
    expect(waits).toEqual([]);
  });

  it('retries settlement work that another service worker can finish', async () => {
    const results: ClaudiumNativeConfirm[] = [
      { settled: false, balance: null, reason: 'processing' },
      { settled: false, balance: null, reason: 'post_verify_failed' },
      { settled: false, balance: null, reason: 'fulfillment_failed' },
      { settled: true, balance: 13_000, reason: null },
    ];
    const waits: number[] = [];
    const result = await confirmNativeSettlement(
      {
        nativeConfirm: async () =>
          results.shift() ?? { settled: false, balance: null, reason: 'unavailable' },
      },
      'CLM_ref',
      'SIG',
      {
        delayMs: async (ms) => {
          waits.push(ms);
        },
      },
    );

    expect(result).toEqual({ settled: true, balance: 13_000, reason: null });
    expect(waits).toEqual([1000, 1500, 2500]);
  });

  it('bounds retry independently after a payment signature has been broadcast', async () => {
    const calls: Array<{ reference: string; signature: string }> = [];
    const waits: number[] = [];
    const result = await confirmNativeSettlement(
      {
        nativeConfirm: async (input) => {
          calls.push(input);
          return { settled: false, balance: null, reason: 'processing' };
        },
      },
      'CLM_ref',
      'SIG',
      {
        delayMs: async (ms) => {
          waits.push(ms);
        },
        maxElapsedMs: 2500,
      },
    );

    expect(result.reason).toBe('processing');
    expect(waits).toEqual([1000, 1500]);
    expect(calls).toHaveLength(3);
  });
});
