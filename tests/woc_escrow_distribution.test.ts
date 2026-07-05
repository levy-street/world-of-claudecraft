// Pins the woc_escrow DISTRIBUTION wire format (open/fund/payout/close) and
// the ATA create-idempotent helper: discriminators, borsh args, and account
// order/flags must match solana/programs/woc_escrow/src/lib.rs, exactly like
// the match-instruction pins in woc_escrow_client.test.ts.
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  closeDistributionIx,
  createAtaIdempotentIx,
  distributionPda,
  fundDistributionIx,
  openDistributionIx,
  payoutIx,
  TOKEN_PROGRAM_ID,
  vaultAta,
} from '../server/woc_escrow_client';

const programId = new PublicKey('Fn4LMsV7akGX9KXwYv4uh2v8nM2uqgaAxhKrsYYbZqcJ');
const mint = new PublicKey('E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx');
const authority = Keypair.generate().publicKey;
const funder = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const seasonId = 424_242n;
const ids = { programId, mint, seasonId };
const disc = (name: string) =>
  createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const flags = (ix: { keys: { isSigner: boolean; isWritable: boolean }[] }) =>
  ix.keys.map((k) => `${k.isSigner ? 's' : '-'}${k.isWritable ? 'w' : '-'}`);

describe('distributionPda', () => {
  it('is deterministic and season-specific', () => {
    expect(distributionPda(programId, 1n).equals(distributionPda(programId, 1n))).toBe(true);
    expect(distributionPda(programId, 1n).equals(distributionPda(programId, 2n))).toBe(false);
  });
});

describe('open_distribution', () => {
  const ix = openDistributionIx({ ...ids, authority });
  it('encodes season_id u64 and the 7 accounts in lib.rs order', () => {
    expect(ix.data.length).toBe(8 + 8);
    expect(ix.data.subarray(0, 8).equals(disc('open_distribution'))).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(seasonId);
    expect(flags(ix)).toEqual(['sw', '-w', '--', '-w', '--', '--', '--']);
    const distribution = distributionPda(programId, seasonId);
    expect(ix.keys[1].pubkey.equals(distribution)).toBe(true);
    expect(ix.keys[3].pubkey.equals(vaultAta(distribution, mint))).toBe(true);
    expect(ix.keys[4].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.keys[5].pubkey.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.keys[6].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});

describe('fund_distribution', () => {
  const ix = fundDistributionIx({ ...ids, funder, amountBase: 9_000_000n });
  it('encodes season_id then amount and the 5 accounts in lib.rs order', () => {
    expect(ix.data.length).toBe(8 + 8 + 8);
    expect(ix.data.subarray(0, 8).equals(disc('fund_distribution'))).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(seasonId);
    expect(ix.data.readBigUInt64LE(16)).toBe(9_000_000n);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '--']);
    expect(ix.keys[3].pubkey.equals(vaultAta(funder, mint))).toBe(true);
  });
});

describe('payout', () => {
  const ix = payoutIx({ ...ids, authority, recipient, amountBase: 1n });
  it('authority signs read-only; recipient token account is the winner ATA', () => {
    expect(ix.data.length).toBe(8 + 8 + 8);
    expect(ix.data.subarray(0, 8).equals(disc('payout'))).toBe(true);
    expect(flags(ix)).toEqual(['s-', '-w', '-w', '-w', '--']);
    expect(ix.keys[3].pubkey.equals(vaultAta(recipient, mint))).toBe(true);
  });
});

describe('close_distribution', () => {
  const ix = closeDistributionIx({ ...ids, authority });
  it('returns dust to the authority ATA and closes', () => {
    expect(ix.data.subarray(0, 8).equals(disc('close_distribution'))).toBe(true);
    expect(flags(ix)).toEqual(['sw', '-w', '-w', '-w', '--']);
    expect(ix.keys[3].pubkey.equals(vaultAta(authority, mint))).toBe(true);
  });
});

describe('createAtaIdempotentIx', () => {
  const ix = createAtaIdempotentIx({ payer: authority, owner: recipient, mint });
  it('targets the ATA program with tag 1 and the canonical 6 accounts', () => {
    expect(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
    expect(ix.data.equals(Buffer.from([1]))).toBe(true);
    expect(flags(ix)).toEqual(['sw', '-w', '--', '--', '--', '--']);
    expect(ix.keys[1].pubkey.equals(vaultAta(recipient, mint))).toBe(true);
    expect(ix.keys[4].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(ix.keys[5].pubkey.equals(TOKEN_PROGRAM_ID)).toBe(true);
  });
});
