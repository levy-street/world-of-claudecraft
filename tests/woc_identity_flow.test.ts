// Drives src/net/woc_identity.ts (the quote -> pay -> confirm orchestration)
// with fake IO. The real tx builder (src/net/woc_tx.ts) runs inside the flow,
// so the bytes handed to the wallet are the real serialized payment.
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';
import type { WocIdentityPayContext, WocIdentityQuote } from '../src/net/online';
import { payWocIdentityFlow, WocPayError, type WocPayStage } from '../src/net/woc_identity';

const key = (fill: number): string => bs58.encode(new Uint8Array(32).fill(fill));

const QUOTE: WocIdentityQuote = {
  quoteId: 'q-1',
  memo: 'q-1',
  mint: key(3),
  decimals: 6,
  amountBase: '500000000',
  burnBase: '500000000',
  treasuryBase: '0',
  treasury: null,
  burnBps: 10000,
  priceWoc: 500,
  payer: key(1),
  expiresAt: Date.now() + 60_000,
};

const CTX: WocIdentityPayContext = {
  blockhash: key(9),
  payerTokenAccount: key(2),
  treasuryTokenAccount: null,
};

function makeDeps(confirmResults: { ok: boolean; status: number; reason?: string; data: any }[]) {
  const stages: WocPayStage[] = [];
  let confirmCalls = 0;
  const deps = {
    quote: vi.fn(async () => QUOTE),
    payContext: vi.fn(async (quoteId: string) => {
      expect(quoteId).toBe('q-1');
      return CTX;
    }),
    signAndSend: vi.fn(async (tx: Uint8Array) => {
      expect(tx).toBeInstanceOf(Uint8Array);
      // The real serializer ran: the memo rides in the tx verbatim.
      expect(new TextDecoder().decode(tx)).toContain('q-1');
      return 'sig-abc';
    }),
    confirm: vi.fn(async (quoteId: string, signature: string) => {
      expect(quoteId).toBe('q-1');
      expect(signature).toBe('sig-abc');
      const r = confirmResults[Math.min(confirmCalls, confirmResults.length - 1)];
      confirmCalls++;
      return r;
    }),
    onStage: (stage: WocPayStage) => stages.push(stage),
    sleep: vi.fn(async () => {}),
  };
  return { deps, stages };
}

describe('payWocIdentityFlow', () => {
  it('quotes, pays, confirms, and resolves the applied action', async () => {
    const { deps, stages } = makeDeps([{ ok: true, status: 200, data: { name: 'Aragorn' } }]);
    const result = await payWocIdentityFlow(deps);
    expect(result).toEqual({ name: 'Aragorn' });
    expect(stages).toEqual(['quoting', 'approve', 'confirming']);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('retries while the burn is not finalized, then settles', async () => {
    const { deps, stages } = makeDeps([
      { ok: false, status: 409, reason: 'not_finalized', data: {} },
      { ok: false, status: 409, reason: 'not_finalized', data: {} },
      { ok: true, status: 200, data: { name: 'Aragorn' } },
    ]);
    const result = await payWocIdentityFlow(deps);
    expect(result).toEqual({ name: 'Aragorn' });
    expect(deps.confirm).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(stages).toEqual(['quoting', 'approve', 'confirming', 'finalizing', 'finalizing']);
  });

  it('fails fast on a non-retryable confirm rejection, carrying the server error', async () => {
    const { deps } = makeDeps([
      {
        ok: false,
        status: 400,
        reason: 'underpaid',
        data: { error: 'payment not verified (underpaid)' },
      },
    ]);
    const err = await payWocIdentityFlow(deps).catch((e) => e);
    expect(err).toBeInstanceOf(WocPayError);
    expect(err.code).toBe('confirm_failed');
    expect(err.serverError).toBe('payment not verified (underpaid)');
    expect(deps.confirm).toHaveBeenCalledTimes(1);
  });

  it('gives up with finalize_timeout after the attempt budget', async () => {
    const { deps } = makeDeps([{ ok: false, status: 409, reason: 'not_finalized', data: {} }]);
    const err = await payWocIdentityFlow(deps).catch((e) => e);
    expect(err).toBeInstanceOf(WocPayError);
    expect(err.code).toBe('finalize_timeout');
    expect(deps.confirm).toHaveBeenCalledTimes(24);
  });

  it('propagates a wallet rejection unchanged (no confirm attempts)', async () => {
    const { deps } = makeDeps([{ ok: true, status: 200, data: {} }]);
    deps.signAndSend.mockRejectedValue(new Error('user rejected'));
    await expect(payWocIdentityFlow(deps)).rejects.toThrow('user rejected');
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});
