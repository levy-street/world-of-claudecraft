import { describe, expect, it } from 'vitest';
import type { FetchImpl, WocTradeConfig } from '../server/woc_trade';
import { makeReference, solanaPayUri, uiToBaseUnits, verifyWocPayment } from '../server/woc_trade';

const MINT = 'Woc1111111111111111111111111111111111111111';
const PAYER = 'Payer11111111111111111111111111111111111111';
const RECIP = 'Recip11111111111111111111111111111111111111';

function cfg(): WocTradeConfig {
  return {
    rpcUrl: 'http://rpc.test',
    mint: MINT,
    timeoutMs: 180_000,
    pollMs: 5000,
    minConfirm: 'finalized',
  };
}

interface TokenBalance {
  owner: string;
  mint: string;
  uiTokenAmount: { amount: string; decimals: number };
}

function bal(owner: string, mint: string, amount: bigint, decimals = 6): TokenBalance {
  return { owner, mint, uiTokenAmount: { amount: amount.toString(), decimals } };
}

function tx(pre: TokenBalance[], post: TokenBalance[], err: unknown = null): unknown {
  return { meta: { err, preTokenBalances: pre, postTokenBalances: post } };
}

// A fetch stub driven by canned RPC results keyed on method / signature.
function stubFetch(handlers: {
  signatures?: { signature: string; err: unknown }[];
  transactions?: Record<string, unknown>;
}): FetchImpl {
  return (async (_url: unknown, init: unknown) => {
    const body = JSON.parse((init as { body: string }).body) as {
      method: string;
      params: unknown[];
    };
    let result: unknown = null;
    if (body.method === 'getSignaturesForAddress') result = handlers.signatures ?? [];
    else if (body.method === 'getTransaction')
      result = handlers.transactions?.[body.params[0] as string] ?? null;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  }) as unknown as FetchImpl;
}

const input = { reference: 'RefKey', payerPubkey: PAYER, recipientPubkey: RECIP, amountUi: '1.5' };

describe('makeReference', () => {
  it('encodes 32 random bytes as base58 and is single-use random', () => {
    const a = makeReference();
    const b = makeReference();
    expect(a).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(a).not.toBe(b);
  });
});

describe('solanaPayUri', () => {
  it('builds the exact transfer-request string with fixed param order', () => {
    expect(solanaPayUri(RECIP, '1.5', 'RefKey', 'Trade with Bob', MINT)).toBe(
      `solana:${RECIP}?amount=1.5&spl-token=${MINT}&reference=RefKey&label=Trade%20with%20Bob&memo=woc-trade`,
    );
  });

  it('passes the amount string through untouched (no float reformatting)', () => {
    expect(solanaPayUri(RECIP, '10', 'R', 'L', MINT)).toContain('?amount=10&');
    expect(solanaPayUri(RECIP, '0.000000001', 'R', 'L', MINT)).toContain('?amount=0.000000001&');
  });

  it('url-encodes the label', () => {
    expect(solanaPayUri(RECIP, '1', 'R', 'a & b/c', MINT)).toContain('&label=a%20%26%20b%2Fc&');
  });
});

describe('uiToBaseUnits (BigInt only, no float)', () => {
  it('scales by decimals', () => {
    expect(uiToBaseUnits('1.5', 6)).toBe(1_500_000n);
    expect(uiToBaseUnits('10', 0)).toBe(10n);
    expect(uiToBaseUnits('0.000000001', 9)).toBe(1n);
  });

  it('rejects more fractional digits than the mint supports (precision loss)', () => {
    expect(uiToBaseUnits('1.5', 0)).toBeNull();
    expect(uiToBaseUnits('1.0000001', 6)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(uiToBaseUnits('abc', 6)).toBeNull();
    expect(uiToBaseUnits('', 6)).toBeNull();
    expect(uiToBaseUnits('1.', 6)).toBeNull();
  });

  it('handles a full u64-max style amount exactly', () => {
    // 2^64 - 1 base units at 9 decimals
    expect(uiToBaseUnits('18446744073.709551615', 9)).toBe(18_446_744_073_709_551_615n);
  });
});

describe('verifyWocPayment', () => {
  it('pending when no signatures reference the key', async () => {
    const res = await verifyWocPayment(cfg(), input, stubFetch({ signatures: [] }));
    expect(res).toBe('pending');
  });

  it('success via token-balance deltas (plain transfer)', async () => {
    const fetchImpl = stubFetch({
      signatures: [{ signature: 'sigOk', err: null }],
      transactions: {
        sigOk: tx(
          [bal(PAYER, MINT, 5_000_000n)],
          [bal(PAYER, MINT, 3_500_000n), bal(RECIP, MINT, 1_500_000n)],
        ),
      },
    });
    expect(await verifyWocPayment(cfg(), input, fetchImpl)).toEqual({ signature: 'sigOk' });
  });

  it('success via a transferChecked-shaped balance set (recipient over-credit ok)', async () => {
    const fetchImpl = stubFetch({
      signatures: [{ signature: 'sigChecked', err: null }],
      transactions: {
        sigChecked: tx(
          [bal(PAYER, MINT, 9_000_000n), bal(RECIP, MINT, 1_000_000n)],
          [bal(PAYER, MINT, 7_400_000n), bal(RECIP, MINT, 2_600_000n)],
        ),
      },
    });
    // payer -1_600_000 <= -1_500_000 and recipient +1_600_000 >= 1_500_000
    expect(await verifyWocPayment(cfg(), input, fetchImpl)).toEqual({ signature: 'sigChecked' });
  });

  it('rejects the wrong mint (matched reference, failed validation)', async () => {
    const fetchImpl = stubFetch({
      signatures: [{ signature: 'sigWrong', err: null }],
      transactions: {
        sigWrong: tx(
          [bal(PAYER, 'OtherMint1111111111111111111111111111111111', 5_000_000n)],
          [
            bal(PAYER, 'OtherMint1111111111111111111111111111111111', 3_500_000n),
            bal(RECIP, 'OtherMint1111111111111111111111111111111111', 1_500_000n),
          ],
        ),
      },
    });
    expect(await verifyWocPayment(cfg(), input, fetchImpl)).toEqual({
      error: 'no matching transfer on reference',
    });
  });

  it('rejects an insufficient amount', async () => {
    const fetchImpl = stubFetch({
      signatures: [{ signature: 'sigLow', err: null }],
      transactions: {
        sigLow: tx(
          [bal(PAYER, MINT, 5_000_000n)],
          [bal(PAYER, MINT, 4_000_000n), bal(RECIP, MINT, 1_000_000n)],
        ),
      },
    });
    expect(await verifyWocPayment(cfg(), input, fetchImpl)).toEqual({
      error: 'no matching transfer on reference',
    });
  });

  it('skips a failed transaction (err !== null) and stays pending', async () => {
    const fetchImpl = stubFetch({
      signatures: [{ signature: 'sigFail', err: { InstructionError: [0, 'Custom'] } }],
      transactions: {
        sigFail: tx(
          [bal(PAYER, MINT, 5_000_000n)],
          [bal(PAYER, MINT, 3_500_000n), bal(RECIP, MINT, 1_500_000n)],
        ),
      },
    });
    expect(await verifyWocPayment(cfg(), input, fetchImpl)).toBe('pending');
  });

  it('finds the valid transfer even when a wrong one is newest', async () => {
    const fetchImpl = stubFetch({
      signatures: [
        { signature: 'sigWrong', err: null },
        { signature: 'sigOk', err: null },
      ],
      transactions: {
        sigWrong: tx([bal(PAYER, MINT, 5_000_000n)], [bal(PAYER, MINT, 5_000_000n)]),
        sigOk: tx(
          [bal(PAYER, MINT, 5_000_000n)],
          [bal(PAYER, MINT, 3_500_000n), bal(RECIP, MINT, 1_500_000n)],
        ),
      },
    });
    expect(await verifyWocPayment(cfg(), input, fetchImpl)).toEqual({ signature: 'sigOk' });
  });

  it('validates a large (u64-scale) amount with BigInt', async () => {
    const big = { ...input, amountUi: '18446744073.709551615' };
    const amount = 18_446_744_073_709_551_615n;
    const fetchImpl = stubFetch({
      signatures: [{ signature: 'sigBig', err: null }],
      transactions: {
        sigBig: tx([bal(PAYER, MINT, amount, 9)], [bal(RECIP, MINT, amount, 9)]),
      },
    });
    expect(await verifyWocPayment(cfg(), big, fetchImpl)).toEqual({ signature: 'sigBig' });
  });
});
