// Pins the client-side "buy a realm" split-payment builder (src/net/realm_buy.ts)
// so the instructions it produces match what the server verifies: a SOL purchase
// pays two System transfers (treasury + buyback) plus a memo; a USDC purchase
// creates the recipient ATAs idempotently then TransferChecks the two legs, plus a
// memo. The memo always carries the quoteId.
import { describe, it, expect } from 'vitest';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, ownerTokenAccount } from '../src/net/realm_escrow';
import { buildRealmPurchaseInstructions } from '../src/net/realm_buy';

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const pk = (b: number) => new PublicKey(new Uint8Array(32).fill(b));
const buyer = pk(1);
const treasury = pk(2);
const buyback = pk(3);
const mint = pk(4);

function u64le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}
function readMemo(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

describe('buildRealmPurchaseInstructions (SOL)', () => {
  const ixs = buildRealmPurchaseInstructions({
    buyer,
    native: true,
    currencyMint: pk(9), // ignored when native
    currencyDecimals: 9,
    treasury,
    buybackVault: buyback,
    treasuryBase: 700_000n,
    buybackBase: 300_000n,
    memo: 'quote-sol',
  });

  it('pays two System transfers plus a memo', () => {
    expect(ixs).toHaveLength(3);
    expect(ixs[0].programId.equals(SystemProgram.programId)).toBe(true);
    expect(ixs[1].programId.equals(SystemProgram.programId)).toBe(true);
    expect(ixs[2].programId.toBase58()).toBe(MEMO_PROGRAM);
  });

  it('sends the treasury leg to the treasury for the right lamports', () => {
    const ix = ixs[0];
    expect(ix.keys[0].pubkey.equals(buyer)).toBe(true);
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[1].pubkey.equals(treasury)).toBe(true);
    const data = new Uint8Array(ix.data);
    expect(new DataView(data.buffer, data.byteOffset).getUint32(0, true)).toBe(2); // System transfer
    expect(u64le(data, 4)).toBe(700_000n);
  });

  it('sends the buyback leg to the buyback vault for the right lamports', () => {
    const ix = ixs[1];
    expect(ix.keys[1].pubkey.equals(buyback)).toBe(true);
    expect(u64le(new Uint8Array(ix.data), 4)).toBe(300_000n);
  });

  it('tags the transaction with the quoteId memo', () => {
    expect(readMemo(new Uint8Array(ixs[2].data))).toBe('quote-sol');
  });
});

describe('buildRealmPurchaseInstructions (USDC)', () => {
  const ixs = buildRealmPurchaseInstructions({
    buyer,
    native: false,
    currencyMint: mint,
    currencyDecimals: 6,
    treasury,
    buybackVault: buyback,
    treasuryBase: 700_000n,
    buybackBase: 300_000n,
    memo: 'quote-usdc',
  });

  it('creates both recipient ATAs idempotently, transfers both legs, then memos', () => {
    expect(ixs).toHaveLength(5);
    expect(ixs[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(ixs[1].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(Array.from(new Uint8Array(ixs[0].data))).toEqual([1]); // CreateIdempotent
    expect(ixs[2].programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ixs[3].programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ixs[4].programId.toBase58()).toBe(MEMO_PROGRAM);
  });

  it('transfers the treasury leg from the buyer ATA to the treasury ATA, decimal-checked', () => {
    const ix = ixs[2];
    expect(ix.keys[0].pubkey.equals(ownerTokenAccount(buyer, mint))).toBe(true);
    expect(ix.keys[1].pubkey.equals(mint)).toBe(true);
    expect(ix.keys[2].pubkey.equals(ownerTokenAccount(treasury, mint))).toBe(true);
    expect(ix.keys[3].pubkey.equals(buyer)).toBe(true);
    expect(ix.keys[3].isSigner).toBe(true);
    const data = new Uint8Array(ix.data);
    expect(data[0]).toBe(12); // TransferChecked
    expect(u64le(data, 1)).toBe(700_000n);
    expect(data[9]).toBe(6); // decimals
  });

  it('transfers the buyback leg to the buyback vault ATA', () => {
    const ix = ixs[3];
    expect(ix.keys[2].pubkey.equals(ownerTokenAccount(buyback, mint))).toBe(true);
    expect(u64le(new Uint8Array(ix.data), 1)).toBe(300_000n);
  });

  it('tags the transaction with the quoteId memo', () => {
    expect(readMemo(new Uint8Array(ixs[4].data))).toBe('quote-usdc');
  });
});
