import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { buildSplitPaymentTransaction, type SplitPaymentQuote } from '../src/net/wallet';

// Exercises the REAL client purchase-transaction construction (the byte-level
// instruction encoding, ATA derivation, amounts, and memo binding) that the
// browser signs and the server then verifies on-chain. Pure + offline — no
// wallet, no RPC — so the one path that previously had only tsc/build coverage
// is now asserted against the SPL wire format and the server's verify contract.

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BUYER = 'So11111111111111111111111111111111111111112';
const CREATOR = 'Stake11111111111111111111111111111111111111';
const VAULT = 'Vote111111111111111111111111111111111111111';
// 32 zero bytes — a valid base58 blockhash for serialization without a network.
const BLOCKHASH = '11111111111111111111111111111111';

// Independent recomputation of the legacy-SPL ATA (must match the builder).
const ata = (owner: string, mint: string) =>
  PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM,
  )[0];

const quote = (over: Partial<SplitPaymentQuote> = {}): SplitPaymentQuote => ({
  mint: USDC, memo: 'q_deadbeef',
  creator: { owner: CREATOR, amount: '7000000' },
  burn: { owner: VAULT, amount: '3000000' },
  ...over,
});

const build = (q = quote()) => buildSplitPaymentTransaction(q, BUYER, BLOCKHASH, 1234);

describe('buildSplitPaymentTransaction — the buyer 70/30 split payment', () => {
  it('emits exactly two TransferChecked legs + a memo, paid by the buyer', () => {
    const tx = build();
    expect(tx.feePayer?.toBase58()).toBe(BUYER);
    expect(tx.recentBlockhash).toBe(BLOCKHASH);
    expect(tx.instructions).toHaveLength(3);
    expect(tx.instructions[0].programId.equals(TOKEN_PROGRAM)).toBe(true);
    expect(tx.instructions[1].programId.equals(TOKEN_PROGRAM)).toBe(true);
    expect(tx.instructions[2].programId.equals(MEMO_PROGRAM)).toBe(true);
  });

  it('encodes each TransferChecked per the SPL wire format (tag 12, u64-LE amount, u8 decimals)', () => {
    const [creatorIx, burnIx] = build().instructions;
    for (const [ix, amount] of [[creatorIx, 7_000_000n], [burnIx, 3_000_000n]] as const) {
      expect(ix.data).toHaveLength(10);
      expect(ix.data[0]).toBe(12);                       // TransferChecked tag
      expect(ix.data.readBigUInt64LE(1)).toBe(amount);   // amount in base units
      expect(ix.data[9]).toBe(6);                        // USDC decimals
    }
  });

  it('routes both legs from the buyer ATA to the creator/vault ATAs with the right key roles', () => {
    const [creatorIx, burnIx] = build().instructions;
    const buyerAta = ata(BUYER, USDC).toBase58();
    // keys: [source, mint, dest, owner]
    for (const [ix, destOwner] of [[creatorIx, CREATOR], [burnIx, VAULT]] as const) {
      expect(ix.keys[0].pubkey.toBase58()).toBe(buyerAta);          // source = buyer ATA (both legs)
      expect(ix.keys[0]).toMatchObject({ isSigner: false, isWritable: true });
      expect(ix.keys[1].pubkey.toBase58()).toBe(USDC);              // mint
      expect(ix.keys[1]).toMatchObject({ isSigner: false, isWritable: false });
      expect(ix.keys[2].pubkey.toBase58()).toBe(ata(destOwner, USDC).toBase58()); // dest = recipient ATA
      expect(ix.keys[2]).toMatchObject({ isSigner: false, isWritable: true });
      expect(ix.keys[3].pubkey.toBase58()).toBe(BUYER);             // owner/authority = buyer
      expect(ix.keys[3]).toMatchObject({ isSigner: true, isWritable: false });
    }
  });

  it('binds the quote id as the memo (the server matches it against the issued quote)', () => {
    const memoIx = build().instructions[2];
    expect(memoIx.keys).toHaveLength(0);
    expect(memoIx.data.toString('utf8')).toBe('q_deadbeef');
  });

  it('pays exactly the quoted amounts — the buyer is the sole signer of the legs', () => {
    const tx = build();
    const creatorAmt = tx.instructions[0].data.readBigUInt64LE(1);
    const burnAmt = tx.instructions[1].data.readBigUInt64LE(1);
    // gross = creator + burn, and the only signer across the SPL legs is the buyer.
    expect(creatorAmt + burnAmt).toBe(7_000_000n + 3_000_000n);
    const signers = tx.instructions
      .flatMap((ix) => ix.keys)
      .filter((k) => k.isSigner)
      .map((k) => k.pubkey.toBase58());
    expect(new Set(signers)).toEqual(new Set([BUYER]));
  });

  it('carries arbitrary base-unit amounts faithfully (no float rounding)', () => {
    const tx = build(quote({ creator: { owner: CREATOR, amount: '699999993' }, burn: { owner: VAULT, amount: '300000007' } }));
    expect(tx.instructions[0].data.readBigUInt64LE(1)).toBe(699_999_993n);
    expect(tx.instructions[1].data.readBigUInt64LE(1)).toBe(300_000_007n);
  });

  it('encodes zero-amount legs cleanly (degenerate / free skin) without dropping them', () => {
    const tx = build(quote({ creator: { owner: CREATOR, amount: '0' }, burn: { owner: VAULT, amount: '0' } }));
    expect(tx.instructions).toHaveLength(3);
    expect(tx.instructions[0].data.readBigUInt64LE(1)).toBe(0n);
    expect(tx.instructions[1].data.readBigUInt64LE(1)).toBe(0n);
    expect(tx.instructions[0].data[0]).toBe(12); // still a TransferChecked
  });

  it('carries the full u64 maximum amount with no precision loss', () => {
    const max = (2n ** 64n - 1n).toString();
    const tx = build(quote({ creator: { owner: CREATOR, amount: max }, burn: { owner: VAULT, amount: '1' } }));
    expect(tx.instructions[0].data.readBigUInt64LE(1)).toBe(18_446_744_073_709_551_615n);
  });

  it('threads lastValidBlockHeight onto the transaction (the wallet confirm strategy needs it)', () => {
    expect(buildSplitPaymentTransaction(quote(), BUYER, BLOCKHASH, 9999).lastValidBlockHeight).toBe(9999);
  });

  it('faithfully encodes a multi-byte UTF-8 memo and an empty memo by BYTE length', () => {
    const uni = build(quote({ memo: 'q_✓_💀' })).instructions[2];
    expect(uni.data.toString('utf8')).toBe('q_✓_💀');
    expect(uni.data.length).toBe(Buffer.byteLength('q_✓_💀', 'utf8')); // bytes, not 5 chars
    expect(build(quote({ memo: '' })).instructions[2].data.length).toBe(0);
  });

  it('FAILS LOUDLY on an out-of-range u64 amount rather than truncating', () => {
    expect(() => build(quote({ creator: { owner: CREATOR, amount: (2n ** 64n).toString() }, burn: { owner: VAULT, amount: '1' } }))).toThrow();
  });

  it('rejects a malformed / non-integer amount string (no silent coercion)', () => {
    // BigInt('') is 0n (covered by the zero-amount case); 'abc' and '7.5' must throw.
    for (const bad of ['abc', '7.5', '12.0', '7,000']) {
      expect(() => build(quote({ creator: { owner: CREATOR, amount: bad }, burn: { owner: VAULT, amount: '1' } }))).toThrow();
    }
  });

  it('rejects an invalid base58 pubkey in any field before producing a half-formed tx', () => {
    expect(() => build(quote({ mint: 'not-base58!' }))).toThrow();
    expect(() => build(quote({ creator: { owner: '0OIl', amount: '7000000' } }))).toThrow(); // base58-illegal chars
    expect(() => build(quote({ burn: { owner: '', amount: '3000000' } }))).toThrow();
    expect(() => buildSplitPaymentTransaction(quote(), 'not-a-pubkey!', BLOCKHASH, 1)).toThrow();
  });
});
