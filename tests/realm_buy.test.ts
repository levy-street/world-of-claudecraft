// Verifies the "buy a realm" money path (#475): the 70/30 split math
// (server/realm_price.ts splitBuy), the native-SOL lamport-delta parser
// (server/solana_rpc.ts parseNativePayment), and the on-chain purchase verifier
// (server/realm_buy.ts verifyBuyPayment) for both the USDC (SPL token-delta) and
// SOL (native lamport) rails. Only the RPC fetch (fetchFinalizedTransaction) is
// mocked; the real delta/memo/Token-2022 parsing runs against synthetic fixtures.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// verifyBuyPayment lives in realm_buy.ts, which transitively imports server/db.ts
// (it throws at import without DATABASE_URL). Neither db export is used at load on
// the verify path, so a minimal stub lets the module graph import in plain Node.
vi.mock('../server/db', () => ({ pool: {}, resolveReferralAccount: vi.fn() }));

vi.mock('../server/solana_rpc', async (importActual) => {
  const actual = await importActual<typeof import('../server/solana_rpc')>();
  return { ...actual, fetchFinalizedTransaction: vi.fn() };
});

import { fetchFinalizedTransaction, parseNativePayment, type RawConfirmedTransaction } from '../server/solana_rpc';
import { splitBuy } from '../server/realm_price';
import { verifyBuyPayment } from '../server/realm_buy';

const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BUYER = 'Buyer11111111111111111111111111111111111111';
const TREASURY = 'Treasury111111111111111111111111111111111111';
const BUYBACK = 'Buyback111111111111111111111111111111111111';
const SIG = '5'.repeat(80); // valid base58, within [32,90]
const MEMO = 'quote-abc';

const mocked = vi.mocked(fetchFinalizedTransaction);
beforeEach(() => mocked.mockReset());

// ── splitBuy (default 70/30) ─────────────────────────────────────────────────
describe('splitBuy', () => {
  it('splits 70% treasury / 30% buyback and the legs sum to the total', () => {
    const { treasuryBase, buybackBase } = splitBuy(1_000_000n);
    expect(treasuryBase).toBe(700_000n);
    expect(buybackBase).toBe(300_000n);
    expect(treasuryBase + buybackBase).toBe(1_000_000n);
  });

  it('gives the rounding remainder to the buyback leg, never losing dust', () => {
    const total = 1_000_003n; // 70% = 700002.1 -> floor 700002, remainder 300001
    const { treasuryBase, buybackBase } = splitBuy(total);
    expect(treasuryBase).toBe(700_002n);
    expect(buybackBase).toBe(300_001n);
    expect(treasuryBase + buybackBase).toBe(total);
  });
});

// ── parseNativePayment ───────────────────────────────────────────────────────
function nativeTx(opts: {
  keys?: string[];
  pre?: number[];
  post?: number[];
  memo?: string | null;
  err?: unknown;
}): RawConfirmedTransaction {
  const instructions: Array<{ program?: string; parsed?: unknown }> = [];
  if (opts.memo !== null) instructions.push({ program: 'spl-memo', parsed: opts.memo ?? MEMO });
  return {
    meta: { err: opts.err ?? null, preBalances: opts.pre, postBalances: opts.post },
    transaction: { message: { accountKeys: opts.keys ?? [BUYER, TREASURY, BUYBACK], instructions } },
  };
}

describe('parseNativePayment', () => {
  it('computes per-account lamport deltas, fee payer, and memo', () => {
    const p = parseNativePayment(
      nativeTx({ pre: [10_000_000, 0, 0], post: [9_300_000, 700_000, 300_000] }),
    );
    expect(p.succeeded).toBe(true);
    expect(p.feePayer).toBe(BUYER);
    expect(p.memo).toBe(MEMO);
    expect(p.lamportDeltas.get(TREASURY)).toBe(700_000n);
    expect(p.lamportDeltas.get(BUYBACK)).toBe(300_000n);
    expect(p.lamportDeltas.get(BUYER)).toBe(-700_000n);
  });

  it('reports a reverted transaction as not succeeded', () => {
    const p = parseNativePayment(nativeTx({ pre: [1, 0, 0], post: [0, 0, 0], err: { x: 1 } }));
    expect(p.succeeded).toBe(false);
  });
});

// ── verifyBuyPayment: USDC rail ──────────────────────────────────────────────
function usdcRow(owner: string, amount: string, programId = SPL) {
  return { owner, mint: USDC, programId, uiTokenAmount: { amount } };
}

function usdcTx(opts: {
  treasuryPost?: string;
  buybackPost?: string;
  memo?: string | null;
  feePayer?: string;
  programId?: string;
  err?: unknown;
}): RawConfirmedTransaction {
  const programId = opts.programId ?? SPL;
  const instructions: Array<{ program?: string; parsed?: unknown }> = [];
  if (opts.memo !== null) instructions.push({ program: 'spl-memo', parsed: opts.memo ?? MEMO });
  return {
    meta: {
      err: opts.err ?? null,
      preTokenBalances: [
        usdcRow(BUYER, '100000000', programId),
        usdcRow(TREASURY, '0', programId),
        usdcRow(BUYBACK, '0', programId),
      ],
      postTokenBalances: [
        usdcRow(BUYER, '99000000', programId),
        usdcRow(TREASURY, opts.treasuryPost ?? '700000', programId),
        usdcRow(BUYBACK, opts.buybackPost ?? '300000', programId),
      ],
    },
    transaction: {
      message: { accountKeys: [opts.feePayer ?? BUYER, TREASURY, BUYBACK], instructions },
    },
  };
}

const usdcArgs = {
  paySig: SIG,
  buyerWallet: BUYER,
  currency: 'USDC' as const,
  treasury: TREASURY,
  buybackVault: BUYBACK,
  treasuryBase: 700_000n,
  buybackBase: 300_000n,
  memo: MEMO,
};

describe('verifyBuyPayment (USDC)', () => {
  it('accepts a finalized split crediting both legs', async () => {
    mocked.mockResolvedValue(usdcTx({}));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: true });
  });

  it('rejects a short treasury leg', async () => {
    mocked.mockResolvedValue(usdcTx({ treasuryPost: '699999' }));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'treasury_short' });
  });

  it('rejects a short buyback leg', async () => {
    mocked.mockResolvedValue(usdcTx({ buybackPost: '299999' }));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'buyback_short' });
  });

  it('rejects a wrong / missing memo', async () => {
    mocked.mockResolvedValue(usdcTx({ memo: 'someone-elses-quote' }));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'memo_mismatch' });
  });

  it('binds the payer to the linked wallet (fee payer)', async () => {
    mocked.mockResolvedValue(usdcTx({ feePayer: 'Other1111111111111111111111111111111111111' }));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'wrong_payer' });
  });

  it('rejects a Token-2022 look-alike mint', async () => {
    mocked.mockResolvedValue(usdcTx({ programId: TOKEN_2022 }));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'token_2022' });
  });

  it('rejects a reverted transaction', async () => {
    mocked.mockResolvedValue(usdcTx({ err: { InstructionError: [0, 'Custom'] } }));
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'tx_failed' });
  });

  it('treats an unfinalized/missing tx as retryable', async () => {
    mocked.mockResolvedValue(null);
    expect(await verifyBuyPayment(usdcArgs)).toEqual({ ok: false, reason: 'not_finalized' });
  });

  it('rejects a malformed signature before hitting the chain', async () => {
    const r = await verifyBuyPayment({ ...usdcArgs, paySig: 'not a sig!' });
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
    expect(mocked).not.toHaveBeenCalled();
  });

  it('refuses colliding treasury/buyback addresses (one transfer can not cover both)', async () => {
    const r = await verifyBuyPayment({ ...usdcArgs, buybackVault: TREASURY });
    expect(r).toEqual({ ok: false, reason: 'legs_collide' });
    expect(mocked).not.toHaveBeenCalled();
  });
});

// ── verifyBuyPayment: SOL rail ───────────────────────────────────────────────
const solArgs = { ...usdcArgs, currency: 'SOL' as const };

describe('verifyBuyPayment (SOL)', () => {
  it('accepts a finalized native split crediting both legs', async () => {
    mocked.mockResolvedValue(nativeTx({ pre: [10_000_000, 0, 0], post: [9_000_000, 700_000, 300_000] }));
    expect(await verifyBuyPayment(solArgs)).toEqual({ ok: true });
  });

  it('rejects a short treasury leg', async () => {
    mocked.mockResolvedValue(nativeTx({ pre: [10_000_000, 0, 0], post: [9_000_000, 699_999, 300_000] }));
    expect(await verifyBuyPayment(solArgs)).toEqual({ ok: false, reason: 'treasury_short' });
  });

  it('rejects a short buyback leg', async () => {
    mocked.mockResolvedValue(nativeTx({ pre: [10_000_000, 0, 0], post: [9_000_000, 700_000, 299_999] }));
    expect(await verifyBuyPayment(solArgs)).toEqual({ ok: false, reason: 'buyback_short' });
  });

  it('binds the payer to the linked wallet (fee payer)', async () => {
    mocked.mockResolvedValue(
      nativeTx({ keys: ['Other1111111111111111111111111111111111111', TREASURY, BUYBACK], pre: [10_000_000, 0, 0], post: [9_000_000, 700_000, 300_000] }),
    );
    expect(await verifyBuyPayment(solArgs)).toEqual({ ok: false, reason: 'wrong_payer' });
  });

  it('rejects a wrong / missing memo', async () => {
    mocked.mockResolvedValue(nativeTx({ pre: [10_000_000, 0, 0], post: [9_000_000, 700_000, 300_000], memo: null }));
    expect(await verifyBuyPayment(solArgs)).toEqual({ ok: false, reason: 'memo_mismatch' });
  });
});
