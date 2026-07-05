// Drives src/net/woc_subdomain.ts (the quote -> sign -> confirm orchestration
// for the atomic burn + SNS subdomain mint) with fake IO, mirroring
// woc_identity_flow.test.ts. The transaction is server-built, so the flow's
// own on-chain work is just the base64 decode: the bytes handed to the wallet
// must be exactly the quote's txBase64 payload.
import { describe, expect, it, vi } from 'vitest';
import type { WocSubdomainQuote } from '../src/net/online';
import { WocPayError, type WocPayStage } from '../src/net/woc_identity';
import { base64ToBytes, payWocSubdomainMintFlow } from '../src/net/woc_subdomain';

// A recognizable fake serialized transaction (what the server would return).
const TX_BYTES = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);

const QUOTE: WocSubdomainQuote = {
  quoteId: 'q-mint-1',
  txBase64: Buffer.from(TX_BYTES).toString('base64'),
  label: 'aragorn',
  fullDomain: 'aragorn.worldofclaudecraft.sol',
  priceWoc: 1000,
  payer: 'Payer111111111111111111111111111111111111111',
  expiresAt: Date.now() + 60_000,
};

const BOUND = {
  characterId: 7,
  fullDomain: 'aragorn.worldofclaudecraft.sol',
  owner: QUOTE.payer,
};

function makeDeps(confirmResults: { ok: boolean; status: number; reason?: string; data: any }[]) {
  const stages: WocPayStage[] = [];
  let confirmCalls = 0;
  const deps = {
    quote: vi.fn(async () => QUOTE),
    signAndSend: vi.fn(async (tx: Uint8Array) => {
      // The server-built tx reaches the wallet byte-identical after decode.
      expect(tx).toBeInstanceOf(Uint8Array);
      expect(Array.from(tx)).toEqual(Array.from(TX_BYTES));
      return 'sig-mint';
    }),
    confirm: vi.fn(async (quoteId: string, signature: string) => {
      expect(quoteId).toBe('q-mint-1');
      expect(signature).toBe('sig-mint');
      const r = confirmResults[Math.min(confirmCalls, confirmResults.length - 1)];
      confirmCalls++;
      return r;
    }),
    onStage: (stage: WocPayStage) => stages.push(stage),
    sleep: vi.fn(async () => {}),
  };
  return { deps, stages };
}

describe('base64ToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    expect(Array.from(base64ToBytes(Buffer.from(TX_BYTES).toString('base64')))).toEqual(
      Array.from(TX_BYTES),
    );
    expect(base64ToBytes('')).toEqual(new Uint8Array(0));
  });
});

describe('payWocSubdomainMintFlow', () => {
  it('quotes, signs, confirms, and resolves the bound character', async () => {
    const { deps, stages } = makeDeps([{ ok: true, status: 200, data: BOUND }]);
    const result = await payWocSubdomainMintFlow(deps);
    expect(result).toEqual(BOUND);
    expect(stages).toEqual(['quoting', 'approve', 'confirming']);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('retries while the burn is not finalized, then settles', async () => {
    const { deps, stages } = makeDeps([
      { ok: false, status: 409, reason: 'not_finalized', data: {} },
      { ok: true, status: 200, data: BOUND },
    ]);
    const result = await payWocSubdomainMintFlow(deps);
    expect(result).toEqual(BOUND);
    expect(deps.confirm).toHaveBeenCalledTimes(2);
    expect(stages).toEqual(['quoting', 'approve', 'confirming', 'finalizing']);
  });

  it('also retries while the RPC has not caught up with the fresh mint', async () => {
    const { deps } = makeDeps([
      { ok: false, status: 409, reason: 'subdomain_not_minted', data: {} },
      { ok: true, status: 200, data: BOUND },
    ]);
    const result = await payWocSubdomainMintFlow(deps);
    expect(result).toEqual(BOUND);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it('fails fast on a non-retryable confirm rejection, carrying the server error', async () => {
    const { deps } = makeDeps([
      {
        ok: false,
        status: 409,
        reason: 'subdomain_owner_mismatch',
        data: { error: 'subdomain ownership not confirmed (subdomain_owner_mismatch)' },
      },
    ]);
    const err = await payWocSubdomainMintFlow(deps).catch((e) => e);
    expect(err).toBeInstanceOf(WocPayError);
    expect(err.code).toBe('confirm_failed');
    expect(err.serverError).toBe('subdomain ownership not confirmed (subdomain_owner_mismatch)');
    expect(deps.confirm).toHaveBeenCalledTimes(1);
  });

  it('gives up with finalize_timeout after the attempt budget', async () => {
    const { deps } = makeDeps([{ ok: false, status: 409, reason: 'not_finalized', data: {} }]);
    const err = await payWocSubdomainMintFlow(deps).catch((e) => e);
    expect(err).toBeInstanceOf(WocPayError);
    expect(err.code).toBe('finalize_timeout');
    expect(deps.confirm).toHaveBeenCalledTimes(24);
  });

  it('propagates a wallet rejection unchanged (no confirm attempts)', async () => {
    const { deps } = makeDeps([{ ok: true, status: 200, data: BOUND }]);
    deps.signAndSend.mockRejectedValue(new Error('user rejected'));
    await expect(payWocSubdomainMintFlow(deps)).rejects.toThrow('user rejected');
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});
