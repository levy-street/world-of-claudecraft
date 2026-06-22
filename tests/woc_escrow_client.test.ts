// Unit-tests the woc_escrow instruction encoders against the program layout in
// solana/programs/woc_escrow/src/lib.rs: Anchor discriminator (sha256("global:
// <ix>")[:8]), borsh args, and the exact account list (order, signer, writable)
// per #[derive(Accounts)]. Pure: no chain, no connection.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  openMatchIx, joinMatchIx, settleMatchIx, cancelMatchIx, refundMatchIx,
  matchPda, vaultAta, loadKeypairFromEnv,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '../server/woc_escrow_client';

const programId = new PublicKey('Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ');
const mint = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');
const creator = new PublicKey('3HTkBFPWnQJiEs4Q7tvdPiesmodQ2ZFWzp82Lg16dYPp');
const opponent = new PublicKey('ADBEVxjxgxJ4ogU2uPpGsKcfwHr2wEMw5aQo25BoAS4c');
const settler = new PublicKey('HSmLQNDr8DSQqaETq4WqVHgDRgithTsm8S9uZxsNJBjc');
const winner = creator;

const disc = (n: string) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const flags = (ix: { keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }) =>
  ix.keys.map((k) => `${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);

describe('PDAs', () => {
  it('match PDA is deterministic and id-specific', () => {
    expect(matchPda(programId, 1n).equals(matchPda(programId, 1n))).toBe(true);
    expect(matchPda(programId, 1n).equals(matchPda(programId, 2n))).toBe(false);
  });
  it('vaultAta is the canonical ATA of its owner', () => {
    const m = matchPda(programId, 7n);
    const expected = PublicKey.findProgramAddressSync(
      [m.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID,
    )[0];
    expect(vaultAta(m, mint).equals(expected)).toBe(true);
  });
});

describe('open_match', () => {
  const ix = openMatchIx({ programId, mint, matchId: 1n, stakeBase: 100_000_000n, rakeBps: 500, creator, settler });
  it('targets the program with the open_match discriminator', () => {
    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.data.subarray(0, 8).equals(disc('open_match'))).toBe(true);
  });
  it('encodes match_id u64, stake u64, rake_bps u16, settler pubkey', () => {
    expect(ix.data.length).toBe(8 + 8 + 8 + 2 + 32);
    expect(ix.data.readBigUInt64LE(8)).toBe(1n);
    expect(ix.data.readBigUInt64LE(16)).toBe(100_000_000n);
    expect(ix.data.readUInt16LE(24)).toBe(500);
    expect(ix.data.subarray(26, 58).equals(settler.toBuffer())).toBe(true);
  });
  it('has the 8 accounts in lib.rs order with correct signer/writable', () => {
    const match = matchPda(programId, 1n);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      creator.toBase58(), match.toBase58(), mint.toBase58(), vaultAta(match, mint).toBase58(),
      vaultAta(creator, mint).toBase58(), TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), SystemProgram.programId.toBase58(),
    ]);
    expect(flags(ix)).toEqual(['sw', '-w', '--', '-w', '-w', '--', '--', '--']);
  });
});

describe('join_match', () => {
  const ix = joinMatchIx({ programId, mint, matchId: 1n, opponent });
  it('discriminator + match_id only', () => {
    expect(ix.data.subarray(0, 8).equals(disc('join_match'))).toBe(true);
    expect(ix.data.length).toBe(16);
    expect(ix.data.readBigUInt64LE(8)).toBe(1n);
  });
  it('5 accounts: opponent signer, vault + opponent_token writable', () => {
    const match = matchPda(programId, 1n);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      opponent.toBase58(), match.toBase58(), vaultAta(match, mint).toBase58(),
      vaultAta(opponent, mint).toBase58(), TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '--']);
  });
});

describe('settle_match', () => {
  const ix = settleMatchIx({ programId, mint, matchId: 1n, settler, creator, winner });
  it('discriminator + match_id', () => {
    expect(ix.data.subarray(0, 8).equals(disc('settle_match'))).toBe(true);
    expect(ix.data.length).toBe(16);
  });
  it('7 accounts: settler signs, creator rent-dest, mint+vault+winner writable', () => {
    const match = matchPda(programId, 1n);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      settler.toBase58(), creator.toBase58(), match.toBase58(), mint.toBase58(),
      vaultAta(match, mint).toBase58(), vaultAta(winner, mint).toBase58(), TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '-w', '-w', '--']);
  });
});

describe('cancel_match', () => {
  it('discriminator + 5 accounts (creator refunded)', () => {
    const ix = cancelMatchIx({ programId, mint, matchId: 3n, creator });
    expect(ix.data.subarray(0, 8).equals(disc('cancel_match'))).toBe(true);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '--']);
  });
});

describe('refund_match', () => {
  const ix = refundMatchIx({ programId, mint, matchId: 1n, settler, creator, opponent });
  it('discriminator + match_id', () => {
    expect(ix.data.subarray(0, 8).equals(disc('refund_match'))).toBe(true);
    expect(ix.data.length).toBe(16);
  });
  it('7 accounts: settler signs, both player tokens writable for the split refund', () => {
    const match = matchPda(programId, 1n);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      settler.toBase58(), creator.toBase58(), match.toBase58(), vaultAta(match, mint).toBase58(),
      vaultAta(creator, mint).toBase58(), vaultAta(opponent, mint).toBase58(), TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '-w', '-w', '--']);
  });
});

describe('loadKeypairFromEnv', () => {
  it('parses a JSON byte-array secret key', () => {
    const kp0 = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    process.env.WOC_TEST_KP = JSON.stringify(Array.from(kp0.secretKey));
    const kp = loadKeypairFromEnv('WOC_TEST_KP');
    expect(kp.publicKey.equals(kp0.publicKey)).toBe(true);
    expect(kp.secretKey).toEqual(kp0.secretKey);
    delete process.env.WOC_TEST_KP;
  });
  it('parses a base58 secret key', () => {
    const kp0 = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));
    process.env.WOC_TEST_KP58 = bs58.encode(kp0.secretKey);
    const kp = loadKeypairFromEnv('WOC_TEST_KP58');
    expect(kp.publicKey.equals(kp0.publicKey)).toBe(true);
    delete process.env.WOC_TEST_KP58;
  });
  it('throws loudly when unset', () => {
    delete process.env.WOC_TEST_KP_MISSING;
    expect(() => loadKeypairFromEnv('WOC_TEST_KP_MISSING')).toThrow('WOC_TEST_KP_MISSING is not set');
  });
});
