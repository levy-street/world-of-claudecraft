// Pure tests for server/solana_rpc.ts parseSplitPayment — the confirmed-tx → net
// token-delta reducer the buyback keeper's `wocReceived` depends on to measure the
// $WOC actually received from a Jupiter swap. No I/O. (The network arms —
// solanaRpc / fetchFinalizedTransaction / signatureStatus — are thin RPC wrappers
// exercised on mainnet; the parsing that decides amounts is what matters offline.)
import { describe, it, expect } from 'vitest';
import { parseSplitPayment, SPL_TOKEN_PROGRAM, SPL_TOKEN_2022_PROGRAM, type RawConfirmedTransaction } from '../server/solana_rpc';

const MINT = 'MintUSDC1111111111111111111111111111111111';
const OTHER = 'OtherMint22222222222222222222222222222222';
const PAYER = 'Payer1111111111111111111111111111111111111';
const RECIP = 'Recip2222222222222222222222222222222222222';

interface Bal { owner: string; mint: string; programId?: string; amount: string }
const bal = (b: Bal) => ({ owner: b.owner, mint: b.mint, programId: b.programId ?? SPL_TOKEN_PROGRAM, uiTokenAmount: { amount: b.amount } });

function tx(o: {
  err?: unknown; metaNull?: boolean;
  pre?: Bal[]; post?: Bal[];
  keys?: Array<{ pubkey: string } | string>;
  instructions?: Array<{ program?: string; programId?: string; parsed?: unknown }>;
}): RawConfirmedTransaction {
  return {
    meta: o.metaNull ? null : {
      err: o.err ?? null,
      preTokenBalances: (o.pre ?? []).map(bal),
      postTokenBalances: (o.post ?? []).map(bal),
    },
    transaction: { message: { accountKeys: o.keys ?? [{ pubkey: PAYER }], instructions: o.instructions ?? [] } },
  };
}

describe('parseSplitPayment', () => {
  it('computes net per-owner deltas for the target mint (post − pre), ignoring other mints', () => {
    const r = parseSplitPayment(tx({
      pre: [{ owner: PAYER, mint: MINT, amount: '1000' }, { owner: PAYER, mint: OTHER, amount: '5' }],
      post: [{ owner: PAYER, mint: MINT, amount: '300' }, { owner: RECIP, mint: MINT, amount: '700' }, { owner: PAYER, mint: OTHER, amount: '999' }],
    }), MINT);
    expect(r.tokenDeltas.get(PAYER)).toBe(-700n); // spent 700 of the target mint
    expect(r.tokenDeltas.get(RECIP)).toBe(700n);  // received 700
    expect(r.tokenDeltas.has(OTHER)).toBe(false);  // OTHER-mint movement excluded
  });

  it('treats a freshly-created ATA (absent from preTokenBalances) as starting at zero', () => {
    const r = parseSplitPayment(tx({ pre: [], post: [{ owner: RECIP, mint: MINT, amount: '640' }] }), MINT);
    expect(r.tokenDeltas.get(RECIP)).toBe(640n); // full post counts as received
  });

  it('omits zero-net owners from the delta map', () => {
    const r = parseSplitPayment(tx({
      pre: [{ owner: PAYER, mint: MINT, amount: '100' }],
      post: [{ owner: PAYER, mint: MINT, amount: '100' }],
    }), MINT);
    expect(r.tokenDeltas.size).toBe(0);
  });

  it('reads the fee payer from the first account key in both string and {pubkey} forms', () => {
    expect(parseSplitPayment(tx({ keys: [{ pubkey: PAYER }] }), MINT).feePayer).toBe(PAYER);
    expect(parseSplitPayment(tx({ keys: [PAYER, RECIP] }), MINT).feePayer).toBe(PAYER);
    expect(parseSplitPayment(tx({ keys: [] }), MINT).feePayer).toBeNull();
  });

  it('extracts a memo from spl-memo (by program name and by program id)', () => {
    expect(parseSplitPayment(tx({ instructions: [{ program: 'spl-memo', parsed: 'quote-123' }] }), MINT).memo).toBe('quote-123');
    expect(parseSplitPayment(tx({ instructions: [{ programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: 'quote-xyz' }] }), MINT).memo).toBe('quote-xyz');
    expect(parseSplitPayment(tx({ instructions: [] }), MINT).memo).toBeNull();
  });

  it('flags the target mint held under Token-2022 (rejected upstream as a fee/hook look-alike)', () => {
    const safe = parseSplitPayment(tx({ post: [{ owner: RECIP, mint: MINT, amount: '1' }] }), MINT);
    expect(safe.usesToken2022ForMint).toBe(false);
    const t22 = parseSplitPayment(tx({ post: [{ owner: RECIP, mint: MINT, programId: SPL_TOKEN_2022_PROGRAM, amount: '1' }] }), MINT);
    expect(t22.usesToken2022ForMint).toBe(true);
  });

  it('reports success only when the tx landed without error', () => {
    expect(parseSplitPayment(tx({ err: null }), MINT).succeeded).toBe(true);
    expect(parseSplitPayment(tx({ err: { InstructionError: [0, 'Custom'] } }), MINT).succeeded).toBe(false);
    expect(parseSplitPayment(tx({ metaNull: true }), MINT).succeeded).toBe(false);
  });
});
