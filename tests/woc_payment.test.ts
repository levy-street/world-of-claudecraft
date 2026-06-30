// Verifies server/woc_payment.ts (the $WOC burn-payment check) and, transitively,
// the real parsing helpers in server/solana_tx.ts. Only the RPC fetch
// (getFinalizedTx) is mocked; everything downstream — balance-delta math, burn
// instruction parsing, memo + Token-2022 detection — runs for real against
// synthetic finalized-transaction fixtures.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FinalizedTx, SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../server/solana_tx';

vi.mock('../server/solana_tx', async (importActual) => {
  const actual = await importActual<typeof import('../server/solana_tx')>();
  return { ...actual, getFinalizedTx: vi.fn() };
});

import { getFinalizedTx } from '../server/solana_tx';
import { verifyWocPayment } from '../server/woc_payment';

const MINT = '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth';
const PAYER = 'Payer1111111111111111111111111111111111111';
const SIG = '5'.repeat(80); // valid base58, length within [32,90]
const mocked = vi.mocked(getFinalizedTx);

interface Opts {
  preBase?: string;
  postBase?: string;
  burnBase?: string | null;
  burnAuthority?: string;
  memo?: string | null;
  err?: unknown;
  programId?: string;
}

// Build a finalized tx where the payer burns (pre - post) $WOC, optionally with a
// burnChecked instruction + memo.
function fixture(o: Opts = {}): FinalizedTx {
  const programId = o.programId ?? SPL_TOKEN_PROGRAM;
  const instructions: any[] = [];
  if (o.burnBase !== null) {
    instructions.push({
      program: 'spl-token',
      parsed: {
        type: 'burnChecked',
        info: {
          mint: MINT,
          authority: o.burnAuthority ?? PAYER,
          tokenAmount: { amount: o.burnBase ?? '500' },
        },
      },
    });
  }
  if (o.memo !== null) instructions.push({ program: 'spl-memo', parsed: o.memo ?? 'quote-123' });
  return {
    signature: SIG,
    err: o.err ?? null,
    preTokenBalances: [
      {
        owner: PAYER,
        mint: MINT,
        programId,
        uiTokenAmount: { amount: o.preBase ?? '1000', decimals: 6 },
      },
    ],
    postTokenBalances: [
      {
        owner: PAYER,
        mint: MINT,
        programId,
        uiTokenAmount: { amount: o.postBase ?? '500', decimals: 6 },
      },
    ],
    instructions,
    // Native-SOL accounting fields (unused by the $WOC burn path).
    accountKeys: [],
    preBalances: [],
    postBalances: [],
    feeLamports: 0n,
  };
}

beforeEach(() => mocked.mockReset());

describe('verifyWocPayment', () => {
  it('accepts a finalized burn of at least the price with a matching memo', async () => {
    mocked.mockResolvedValue(fixture({ memo: 'quote-123', burnBase: '500' }));
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.ok).toBe(true);
    expect(r.spentBase).toBe(500n);
    expect(r.burnedBase).toBe(500n);
  });

  it('rejects an underpaid burn', async () => {
    mocked.mockResolvedValue(fixture({ preBase: '1000', postBase: '700', burnBase: '300' }));
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('underpaid');
  });

  it('rejects a wrong/absent memo', async () => {
    mocked.mockResolvedValue(fixture({ memo: 'someone-elses-quote' }));
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.reason).toBe('memo_mismatch');
  });

  it('rejects when the spend was not actually burned (100% burn config)', async () => {
    // Owner's balance fell by 500 (e.g. transferred away), but no burn instruction.
    mocked.mockResolvedValue(fixture({ burnBase: null }));
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.reason).toBe('burn_missing');
  });

  it('rejects a Token-2022 mint look-alike', async () => {
    mocked.mockResolvedValue(fixture({ programId: TOKEN_2022_PROGRAM }));
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.reason).toBe('token_2022');
  });

  it('rejects a failed transaction', async () => {
    mocked.mockResolvedValue(fixture({ err: { InstructionError: [0, 'Custom'] } }));
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.reason).toBe('tx_failed');
  });

  it('treats an unfinalized/missing tx as retryable', async () => {
    mocked.mockResolvedValue(null);
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    expect(r.reason).toBe('not_finalized');
  });

  it('rejects a malformed signature before hitting the chain', async () => {
    const r = await verifyWocPayment('not a sig!', PAYER, 500n, 'quote-123');
    expect(r.reason).toBe('bad_signature');
    expect(mocked).not.toHaveBeenCalled();
  });

  it('does not credit a burn authorized by a different wallet', async () => {
    mocked.mockResolvedValue(
      fixture({ burnAuthority: 'Other2222222222222222222222222222222222222' }),
    );
    const r = await verifyWocPayment(SIG, PAYER, 500n, 'quote-123');
    // The payer's balance still dropped (they paid), but the burn instruction was
    // not theirs, so the required burn portion is unmet.
    expect(r.reason).toBe('burn_missing');
  });
});
