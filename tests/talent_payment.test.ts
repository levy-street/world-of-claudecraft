// Verifies server/talent_payment.ts (the multi-currency talent checkout check)
// and, transitively, the shared solana_tx helpers it reuses. Only the RPC fetch
// (getFinalizedTx) is mocked; the token/SOL balance-delta math, memo detection,
// and Token-2022 guard run for real against synthetic finalized-tx fixtures.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FinalizedTx, SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../server/solana_tx';

vi.mock('../server/solana_tx', async (importActual) => {
  const actual = await importActual<typeof import('../server/solana_tx')>();
  return { ...actual, getFinalizedTx: vi.fn() };
});

import { getFinalizedTx } from '../server/solana_tx';
import { USDC_MINT } from '../server/talent_config';
import { verifyTalentPayment } from '../server/talent_payment';
import { WOC_MINT } from '../server/woc_config';

const PAYER = 'Payer1111111111111111111111111111111111111';
const TALENT = 'Ta1ent22222222222222222222222222222222222';
const TREASURY = 'Treasury111111111111111111111111111111111';
const SIG = '5'.repeat(80);
const MEMO = 'quote-abc';
const mocked = vi.mocked(getFinalizedTx);

// A token-transfer fixture: payer's mint balance falls by `spent`, talent and
// treasury each gain their leg, plus a memo.
function tokenFixture(opts: {
  mint: string;
  spent: string;
  talentGain: string;
  treasuryGain: string;
  memo?: string | null;
  programId?: string;
  err?: unknown;
}): FinalizedTx {
  const programId = opts.programId ?? SPL_TOKEN_PROGRAM;
  const amt = (owner: string, amount: string) => ({
    owner,
    mint: opts.mint,
    programId,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const instructions: any[] = [];
  if (opts.memo !== null) instructions.push({ program: 'spl-memo', parsed: opts.memo ?? MEMO });
  return {
    signature: SIG,
    err: opts.err ?? null,
    preTokenBalances: [amt(PAYER, opts.spent), amt(TALENT, '0'), amt(TREASURY, '0')],
    postTokenBalances: [
      amt(PAYER, '0'),
      amt(TALENT, opts.talentGain),
      amt(TREASURY, opts.treasuryGain),
    ],
    instructions,
    accountKeys: [],
    preBalances: [],
    postBalances: [],
    feeLamports: 0n,
  };
}

// A native-SOL fixture: payer index loses `spent` lamports, talent/treasury gain
// their legs, plus a memo instruction.
function solFixture(opts: {
  spent: bigint;
  talentGain: bigint;
  treasuryGain: bigint;
  memo?: string | null;
  err?: unknown;
}): FinalizedTx {
  const instructions: any[] = [];
  if (opts.memo !== null) instructions.push({ program: 'spl-memo', parsed: opts.memo ?? MEMO });
  return {
    signature: SIG,
    err: opts.err ?? null,
    preTokenBalances: [],
    postTokenBalances: [],
    instructions,
    accountKeys: [PAYER, TALENT, TREASURY],
    preBalances: [opts.spent, 0n, 0n],
    postBalances: [0n, opts.talentGain, opts.treasuryGain],
    feeLamports: 0n,
  };
}

const baseCheck = {
  signature: SIG,
  payer: PAYER,
  talent: TALENT,
  treasury: TREASURY,
  memo: MEMO,
};

beforeEach(() => mocked.mockReset());

describe('verifyTalentPayment', () => {
  it('accepts a USDC payment with both legs and a matching memo', async () => {
    mocked.mockResolvedValue(
      tokenFixture({ mint: USDC_MINT, spent: '1000', talentGain: '800', treasuryGain: '200' }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.ok).toBe(true);
    expect(r.spentBase).toBe(1000n);
    expect(r.talentCreditedBase).toBe(800n);
    expect(r.treasuryCreditedBase).toBe(200n);
  });

  it('accepts a $WOC payment with both legs', async () => {
    mocked.mockResolvedValue(
      tokenFixture({ mint: WOC_MINT, spent: '5000', talentGain: '4000', treasuryGain: '1000' }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'woc',
      priceBase: 5000n,
      talentBase: 4000n,
      treasuryBase: 1000n,
    });
    expect(r.ok).toBe(true);
    expect(r.talentCreditedBase).toBe(4000n);
  });

  it('accepts a native SOL payment with both lamport legs', async () => {
    mocked.mockResolvedValue(
      solFixture({ spent: 1_000_000_000n, talentGain: 800_000_000n, treasuryGain: 200_000_000n }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'sol',
      priceBase: 1_000_000_000n,
      talentBase: 800_000_000n,
      treasuryBase: 200_000_000n,
    });
    expect(r.ok).toBe(true);
    expect(r.spentBase).toBe(1_000_000_000n);
    expect(r.talentCreditedBase).toBe(800_000_000n);
    expect(r.treasuryCreditedBase).toBe(200_000_000n);
  });

  it('rejects when the talent leg is short', async () => {
    mocked.mockResolvedValue(
      tokenFixture({ mint: USDC_MINT, spent: '1000', talentGain: '700', treasuryGain: '200' }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('talent_short');
  });

  it('rejects when the treasury leg is short', async () => {
    mocked.mockResolvedValue(
      solFixture({ spent: 1_000_000_000n, talentGain: 800_000_000n, treasuryGain: 100_000_000n }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'sol',
      priceBase: 1_000_000_000n,
      talentBase: 800_000_000n,
      treasuryBase: 200_000_000n,
    });
    expect(r.reason).toBe('treasury_short');
  });

  it('rejects a wrong/absent memo', async () => {
    mocked.mockResolvedValue(
      tokenFixture({
        mint: USDC_MINT,
        spent: '1000',
        talentGain: '800',
        treasuryGain: '200',
        memo: 'someone-elses-quote',
      }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.reason).toBe('memo_mismatch');
  });

  it('rejects a Token-2022 mint look-alike', async () => {
    mocked.mockResolvedValue(
      tokenFixture({
        mint: USDC_MINT,
        spent: '1000',
        talentGain: '800',
        treasuryGain: '200',
        programId: TOKEN_2022_PROGRAM,
      }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.reason).toBe('token_2022');
  });

  it('rejects a failed transaction', async () => {
    mocked.mockResolvedValue(
      tokenFixture({
        mint: USDC_MINT,
        spent: '1000',
        talentGain: '800',
        treasuryGain: '200',
        err: { InstructionError: [0, 'Custom'] },
      }),
    );
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.reason).toBe('tx_failed');
  });

  it('treats an unfinalized/missing tx as retryable', async () => {
    mocked.mockResolvedValue(null);
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.reason).toBe('not_finalized');
  });

  it('rejects a malformed signature before hitting the chain', async () => {
    const r = await verifyTalentPayment({
      ...baseCheck,
      signature: 'not a sig!',
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.reason).toBe('bad_signature');
    expect(mocked).not.toHaveBeenCalled();
  });

  it('rejects a split that does not sum to the price', async () => {
    const r = await verifyTalentPayment({
      ...baseCheck,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 100n,
    });
    expect(r.reason).toBe('bad_split');
    expect(mocked).not.toHaveBeenCalled();
  });

  it('rejects a self-payment (payer is the talent or treasury)', async () => {
    const r = await verifyTalentPayment({
      ...baseCheck,
      payer: TALENT,
      currency: 'usdc',
      priceBase: 1000n,
      talentBase: 800n,
      treasuryBase: 200n,
    });
    expect(r.reason).toBe('self_payment');
    expect(mocked).not.toHaveBeenCalled();
  });
});
